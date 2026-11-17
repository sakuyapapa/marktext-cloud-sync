/**
 * Folder synchronisation engine.
 *
 * Deliberately Electron-free and provider-agnostic: the main process wires a
 * WebDAV (or Git) provider in, tests drive it with an in-memory one. The engine
 * keeps a state file mapping each relative path to the hash we last agreed on
 * with the remote plus the remote mtime we last saw, which is what lets a run
 * tell "local edit" apart from "remote edit" without downloading everything.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { SyncConflictEntry, SyncConflictPolicy } from '@shared/types/sync'

export interface RemoteFileInfo {
  mtimeMs: number
  size: number
}

export interface SyncProvider {
  describe(): string
  test(): Promise<{ ok: boolean; message: string }>
  list(): Promise<Map<string, RemoteFileInfo>>
  download(relPath: string): Promise<Buffer>
  upload(relPath: string, data: Buffer): Promise<RemoteFileInfo>
  remove(relPath: string): Promise<void>
}

export interface LocalFileInfo {
  hash: string
  size: number
  mtimeMs: number
}

export interface SyncStateEntry {
  hash: string
  remoteMtimeMs: number
}

export interface SyncStateFile {
  version: 1
  files: Record<string, SyncStateEntry>
}

export interface SyncRunResult {
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: SyncConflictEntry[]
  errors: string[]
}

export interface SyncRunOptions {
  /**
   * Direction of the run. `pull` only downloads remote changes and never
   * uploads local edits (deletions follow the remote), `push` is the mirror
   * image and `both` is the normal two-way run.
   */
  direction?: 'both' | 'pull' | 'push'
}

export interface SyncEngineOptions {
  workspaceDir: string
  statePath: string
  /** Receives files removed by a propagated remote delete; keeps them recoverable. */
  trashDir: string
  provider: SyncProvider
  conflictPolicy: SyncConflictPolicy
  /** Relative path fragments that are never synced. */
  ignoreGlobs?: string[]
  maxFileSizeBytes?: number
  log?: (message: string) => void
}

const DEFAULT_IGNORES = [
  '.git/',
  'node_modules/',
  '.obsidian/',
  '.trash/',
  '.marktext-sync/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.tmp',
  '*.temp',
  '*.swp',
  '*.swo',
  '~$*',
  '*.conflict-*'
]

const MB = 1024 * 1024

const toPosix = (value: string): string => value.split(path.sep).join('/')

const hashBuffer = (data: Buffer): string => crypto.createHash('sha256').update(data).digest('hex')

const compactTimestamp = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

/** Glob support is limited to the two forms the ignore list actually uses. */
const matchesIgnore = (relPath: string, pattern: string): boolean => {
  if (pattern.endsWith('/')) {
    const dir = pattern.slice(0, -1)
    return relPath === dir || relPath.startsWith(`${dir}/`) || relPath.includes(`/${dir}/`)
  }
  if (pattern.startsWith('*.')) {
    return relPath.toLowerCase().endsWith(pattern.slice(1).toLowerCase())
  }
  if (pattern.startsWith('~$')) {
    return path.posix.basename(relPath).startsWith(pattern)
  }
  return relPath === pattern || relPath.endsWith(`/${pattern}`)
}

/** Conflict copies sit next to the document so the user cannot miss them. */
export const buildConflictPath = (relPath: string, date: Date, tag: string): string => {
  const dir = path.posix.dirname(relPath)
  const ext = path.posix.extname(relPath)
  const base = path.posix.basename(relPath, ext)
  const filename = `${base}.conflict-${compactTimestamp(date)}-${tag}${ext}`
  return dir === '.' ? filename : path.posix.join(dir, filename)
}

const writeFileAtomic = (target: string, data: Buffer): void => {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, target)
}

export class SyncEngine {
  private readonly options: SyncEngineOptions
  private readonly ignores: string[]

  constructor(options: SyncEngineOptions) {
    this.options = options
    this.ignores = [...DEFAULT_IGNORES, ...(options.ignoreGlobs ?? [])]
  }

  private log(message: string): void {
    this.options.log?.(message)
  }

  private get maxBytes(): number {
    return this.options.maxFileSizeBytes ?? 20 * MB
  }

  scanLocal(): Map<string, LocalFileInfo> {
    const root = this.options.workspaceDir
    const result = new Map<string, LocalFileInfo>()

    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch (error) {
        this.log(`skip unreadable directory ${dir}: ${String(error)}`)
        return
      }
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name)
        const relative = toPosix(path.relative(root, absolute))
        if (this.ignores.some((pattern) => matchesIgnore(relative, pattern))) continue
        if (entry.isDirectory()) {
          walk(absolute)
          continue
        }
        if (!entry.isFile()) continue
        let stat: fs.Stats
        try {
          stat = fs.statSync(absolute)
        } catch {
          continue
        }
        if (stat.size > this.maxBytes) {
          this.log(`skip oversized file ${relative} (${stat.size} bytes)`)
          continue
        }
        const data = fs.readFileSync(absolute)
        result.set(relative, {
          hash: hashBuffer(data),
          size: data.length,
          mtimeMs: stat.mtimeMs
        })
      }
    }

    walk(root)
    return result
  }

  private loadState(): SyncStateFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.options.statePath, 'utf8')) as SyncStateFile
      if (raw && raw.version === 1 && raw.files) return raw
    } catch {
      // A missing or corrupt state file means "first run": everything is
      // compared by content instead of by remembered hashes.
    }
    return { version: 1, files: {} }
  }

  private saveState(state: SyncStateFile): void {
    writeFileAtomic(this.options.statePath, Buffer.from(JSON.stringify(state, null, 2), 'utf8'))
  }

  private backupLocal(relPath: string, tag: string): string | null {
    const absolute = path.join(this.options.workspaceDir, relPath)
    if (!fs.existsSync(absolute)) return null
    const backupRel = buildConflictPath(relPath, new Date(), tag)
    const backupAbs = path.join(this.options.workspaceDir, backupRel)
    fs.mkdirSync(path.dirname(backupAbs), { recursive: true })
    fs.copyFileSync(absolute, backupAbs)
    return backupRel
  }

  private trashLocal(relPath: string): void {
    const absolute = path.join(this.options.workspaceDir, relPath)
    if (!fs.existsSync(absolute)) return
    const target = path.join(this.options.trashDir, compactTimestamp(new Date()), relPath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fs.renameSync(absolute, target)
    } catch {
      fs.copyFileSync(absolute, target)
      fs.unlinkSync(absolute)
    }
  }

  /** Writes the remote bytes over the local copy and returns their hash. */
  private async pullOne(relPath: string): Promise<string> {
    const data = await this.options.provider.download(relPath)
    writeFileAtomic(path.join(this.options.workspaceDir, relPath), data)
    return hashBuffer(data)
  }

  /**
   * Pull used when no earlier state tells us who is right (first sync of an
   * existing folder): a differing local copy is preserved as a conflict file
   * instead of being treated as a stale duplicate.
   */
  private async pullKeepingLocal(relPath: string, tag: string): Promise<string> {
    const data = await this.options.provider.download(relPath)
    const absolute = path.join(this.options.workspaceDir, relPath)
    if (fs.existsSync(absolute)) {
      const existing = fs.readFileSync(absolute)
      if (hashBuffer(existing) !== hashBuffer(data)) {
        this.backupLocal(relPath, tag)
      }
    }
    writeFileAtomic(absolute, data)
    return hashBuffer(data)
  }

  async run(options: SyncRunOptions = {}): Promise<SyncRunResult> {
    const direction = options.direction ?? 'both'
    const canPush = direction !== 'pull'
    const canPull = direction !== 'push'
    const result: SyncRunResult = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: [], errors: [] }
    const state = this.loadState()
    const local = this.scanLocal()
    const remote = await this.options.provider.list()
    const nextFiles: Record<string, SyncStateEntry> = {}

    const record = (relPath: string, hash: string, remoteMtimeMs: number): void => {
      nextFiles[relPath] = { hash, remoteMtimeMs }
    }

    const conflict = (relPath: string, tag: string): void => {
      const backupRel = this.backupLocal(relPath, tag)
      if (backupRel) result.conflicts.push({ path: relPath, backupPath: backupRel })
    }

    const push = async (relPath: string, info: LocalFileInfo): Promise<void> => {
      if (!canPush) return
      const data = fs.readFileSync(path.join(this.options.workspaceDir, relPath))
      const remoteInfo = await this.options.provider.upload(relPath, data)
      result.uploaded += 1
      record(relPath, info.hash, remoteInfo.mtimeMs)
    }

    const pull = async (relPath: string): Promise<void> => {
      if (!canPull) return
      const hash = await this.pullOne(relPath)
      result.downloaded += 1
      record(relPath, hash, remote.get(relPath)?.mtimeMs ?? Date.now())
    }

    for (const [relPath, info] of local) {
      try {
        const remoteInfo = remote.get(relPath)
        const previous = state.files[relPath]
        const localChanged = !previous || previous.hash !== info.hash

        if (!remoteInfo) {
          if (!previous) {
            await push(relPath, info)
            continue
          }
          if (!localChanged) {
            // Delete happened remotely while the local copy stayed untouched.
            this.trashLocal(relPath)
            result.deleted += 1
            continue
          }
          // Edited locally and deleted remotely: resurrect the local copy.
          await push(relPath, info)
          continue
        }

        const remoteChanged = !previous || remoteInfo.mtimeMs !== previous.remoteMtimeMs

        if (!previous) {
          // First encounter of this path on either side: newest wins, and the
          // loser is preserved as a conflict copy instead of being dropped.
          const remoteIsNewer = remoteInfo.mtimeMs > info.mtimeMs
          if (remoteIsNewer) {
            const hash = await this.pullKeepingLocal(relPath, 'local')
            result.downloaded += 1
            record(relPath, hash, remoteInfo.mtimeMs)
          } else {
            await push(relPath, info)
          }
          continue
        }

        if (!localChanged && !remoteChanged) {
          record(relPath, info.hash, remoteInfo.mtimeMs)
          continue
        }

        if (localChanged && !remoteChanged) {
          await push(relPath, info)
          continue
        }

        if (!localChanged && remoteChanged) {
          await pull(relPath)
          continue
        }

        // Both sides changed: compare real bytes before declaring a conflict.
        const remoteData = await this.options.provider.download(relPath)
        const remoteHash = hashBuffer(remoteData)
        if (remoteHash === info.hash) {
          record(relPath, info.hash, remoteInfo.mtimeMs)
          continue
        }
        if (this.options.conflictPolicy === 'local-wins' && canPush) {
          conflict(relPath, 'remote')
          await push(relPath, info)
          continue
        }
        if (this.options.conflictPolicy === 'remote-wins') {
          conflict(relPath, 'local')
          writeFileAtomic(path.join(this.options.workspaceDir, relPath), remoteData)
          result.downloaded += 1
          record(relPath, remoteHash, remoteInfo.mtimeMs)
          continue
        }
        // keep-both: the local edit becomes a sibling file, the remote copy wins.
        conflict(relPath, 'local')
        writeFileAtomic(path.join(this.options.workspaceDir, relPath), remoteData)
        result.downloaded += 1
        record(relPath, remoteHash, remoteInfo.mtimeMs)
      } catch (error) {
        result.errors.push(`${relPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    for (const [relPath, remoteInfo] of remote) {
      if (local.has(relPath)) continue
      const previous = state.files[relPath]
      try {
        if (previous && remoteInfo.mtimeMs === previous.remoteMtimeMs && canPush) {
          // Deleted locally, untouched remotely -> propagate the delete.
          await this.options.provider.remove(relPath)
          result.deleted += 1
          continue
        }
        if (!canPull) continue
        const hash = await this.pullOne(relPath)
        result.downloaded += 1
        record(relPath, hash, remoteInfo.mtimeMs)
      } catch (error) {
        result.errors.push(`${relPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Keep state entries for files that still exist on both sides but were
    // skipped above (e.g. oversized files are excluded from the scan).
    for (const [relPath, entry] of Object.entries(state.files)) {
      if (nextFiles[relPath]) continue
      if (local.has(relPath) || remote.has(relPath)) {
        nextFiles[relPath] = entry
      }
    }

    this.saveState({ version: 1, files: nextFiles })
    return result
  }
}

/** In-memory provider used by unit tests. */
export class MemoryProvider implements SyncProvider {
  public readonly files = new Map<string, { data: Buffer; mtimeMs: number }>()

  describe(): string {
    return 'memory'
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'memory provider' }
  }

  async list(): Promise<Map<string, RemoteFileInfo>> {
    const out = new Map<string, RemoteFileInfo>()
    for (const [relPath, entry] of this.files) {
      out.set(relPath, { mtimeMs: entry.mtimeMs, size: entry.data.length })
    }
    return out
  }

  async download(relPath: string): Promise<Buffer> {
    const entry = this.files.get(relPath)
    if (!entry) throw new Error(`missing remote file: ${relPath}`)
    return entry.data
  }

  async upload(relPath: string, data: Buffer): Promise<RemoteFileInfo> {
    const mtimeMs = Date.now()
    this.files.set(relPath, { data: Buffer.from(data), mtimeMs })
    return { mtimeMs, size: data.length }
  }

  async remove(relPath: string): Promise<void> {
    this.files.delete(relPath)
  }
}
