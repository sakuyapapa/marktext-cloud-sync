/**
 * Main-process glue: owns the configured workspace, the watcher, the interval
 * timer and the status that the renderer shows. The actual file comparison is
 * delegated to `SyncEngine` (WebDAV) or `GitSync` (Git) so both stay testable
 * without Electron.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log'
import chokidar, { type FSWatcher } from 'chokidar'
import { SyncEngine, type SyncProvider } from './engine'
import { createWebdavProvider } from './webdav'
import { createFeishuProvider } from './feishu'
import { GitSync } from './git'
import { SyncConfigStore } from './store'
import type { SyncConfig, SyncStatus, SyncTestResult } from '@shared/types/sync'

const STATUS_CHANNEL = 'mt::sync::status'

const emptyStatus = (): SyncStatus => ({
  phase: 'idle',
  message: '',
  lastSyncAt: null,
  lastResult: null,
  running: false
})

const shortHash = (value: string): string =>
  crypto.createHash('sha1').update(value).digest('hex').slice(0, 12)

export class CloudSyncService {
  private storeInstance: SyncConfigStore | null = null
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private running: Promise<SyncStatus> | null = null
  private status: SyncStatus = emptyStatus()

  /** Created on first use: `app.getPath('userData')` is only meaningful once Electron is ready. */
  private get store(): SyncConfigStore {
    if (!this.storeInstance) this.storeInstance = new SyncConfigStore()
    return this.storeInstance
  }

  getConfig(): SyncConfig {
    return this.store.get()
  }

  getStatus(): SyncStatus {
    return { ...this.status, running: this.running !== null }
  }

  private broadcast(): void {
    const payload = this.getStatus()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(STATUS_CHANNEL, payload)
    }
  }

  private patchStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    this.broadcast()
  }

  private statePath(workspaceDir: string): string {
    return path.join(app.getPath('userData'), 'sync-state', `${shortHash(workspaceDir)}.json`)
  }

  private trashDir(workspaceDir: string): string {
    return path.join(app.getPath('userData'), 'sync-trash', shortHash(workspaceDir))
  }

  private buildProvider(config: SyncConfig): SyncProvider {
    if (config.provider === 'feishu') {
      return createFeishuProvider({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        folderToken: config.feishu.folderToken,
        baseUrl: config.feishu.baseUrl
      })
    }
    return createWebdavProvider({
      url: config.webdav.url,
      username: config.webdav.username,
      password: config.webdav.password,
      remoteDir: config.webdav.remoteDir,
      allowInsecure: config.webdav.allowInsecure
    })
  }

  async setConfig(partial: Partial<SyncConfig>): Promise<SyncConfig> {
    const config = this.store.set(partial)
    this.restartBackgroundWork(config)
    this.patchStatus({ phase: config.enabled ? this.status.phase : 'disabled' })
    return config
  }

  async test(config: SyncConfig): Promise<SyncTestResult> {
    try {
      if (config.provider === 'git') {
        const git = new GitSync(config.workspaceDir, config.git)
        return await git.test()
      }
      if (config.provider === 'webdav' && !config.webdav.url) {
        return { ok: false, message: 'WebDAV URL is empty' }
      }
      const provider = this.buildProvider(config)
      return await provider.test()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private restartBackgroundWork(config: SyncConfig): void {
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (!config.enabled || !config.workspaceDir || !fs.existsSync(config.workspaceDir)) {
      if (config.enabled) {
        log.warn(`[sync] workspace does not exist: ${config.workspaceDir}`)
      }
      return
    }

    this.watcher = chokidar.watch(config.workspaceDir, {
      ignoreInitial: true,
      depth: 32,
      ignored: (target: string) =>
        /(^|[\\/])(\.git|node_modules|\.obsidian|\.trash)([\\/]|$)/.test(target)
    })
    const onLocalChange = (): void => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        void this.runNow('change')
      }, config.debounceMs)
    }
    this.watcher.on('add', onLocalChange)
    this.watcher.on('change', onLocalChange)
    this.watcher.on('unlink', onLocalChange)

    if (config.intervalMinutes > 0) {
      this.timer = setInterval(
        () => {
          void this.runNow('interval')
        },
        config.intervalMinutes * 60_000
      )
    }
  }

  /** Menu action: switch the active provider and sync immediately. */
  async syncWith(provider: SyncConfig['provider']): Promise<SyncStatus> {
    const config = this.store.set({ provider, enabled: true })
    this.restartBackgroundWork(config)
    return this.runNow(`provider:${provider}`)
  }

  async start(): Promise<void> {
    const config = this.getConfig()
    this.patchStatus({ phase: config.enabled ? 'idle' : 'disabled' })
    this.restartBackgroundWork(config)
    if (config.enabled && config.workspaceDir) {
      void this.runNow('startup')
    }
  }

  stop(): void {
    if (this.watcher) void this.watcher.close()
    if (this.timer) clearInterval(this.timer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.watcher = null
    this.timer = null
    this.debounceTimer = null
  }

  /** Serialised: a second call joins the run already in flight. */
  async runNow(reason: string = 'manual'): Promise<SyncStatus> {
    if (this.running) return this.running

    const config = this.getConfig()
    if (!config.enabled) {
      this.patchStatus({ phase: 'disabled', message: '' })
      return this.getStatus()
    }
    if (!config.workspaceDir || !fs.existsSync(config.workspaceDir)) {
      this.patchStatus({ phase: 'error', message: 'Workspace folder is missing' })
      return this.getStatus()
    }

    this.running = this.execute(config, reason)
    try {
      return await this.running
    } finally {
      this.running = null
    }
  }

  private async execute(config: SyncConfig, reason: string): Promise<SyncStatus> {
    this.patchStatus({ phase: 'scanning', message: `sync started (${reason})`, running: true })
    try {
      const result =
        config.provider === 'git'
          ? await this.runGit(config)
          : await this.runWebdav(config)

      const status: SyncStatus = {
        phase: 'done',
        message: '',
        lastSyncAt: Date.now(),
        lastResult: result,
        running: false
      }
      this.status = status
      this.broadcast()
      log.info(
        `[sync] ${config.provider} done: +${result.uploaded} -${result.downloaded} x${result.deleted} conflicts=${result.conflicts.length}`
      )
      return this.getStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[sync] failed: ${message}`)
      this.patchStatus({ phase: 'error', message, running: false })
      return this.getStatus()
    }
  }

  private async runWebdav(config: SyncConfig): Promise<NonNullable<SyncStatus['lastResult']>> {
    const engine = new SyncEngine({
      workspaceDir: config.workspaceDir,
      statePath: this.statePath(config.workspaceDir),
      trashDir: this.trashDir(config.workspaceDir),
      provider: this.buildProvider(config),
      conflictPolicy: config.conflictPolicy,
      log: (message) => log.info(`[sync] ${message}`)
    })
    this.patchStatus({ phase: 'uploading' })
    const result = await engine.run()
    return result
  }

  private async runGit(config: SyncConfig): Promise<NonNullable<SyncStatus['lastResult']>> {
    const git = new GitSync(config.workspaceDir, config.git)
    const result = await git.syncNow()
    this.patchStatus({ phase: 'uploading' })
    return {
      uploaded: result.committed ? 1 : 0,
      downloaded: result.pushed ? 1 : 0,
      deleted: 0,
      conflicts: result.conflicts.map((entry) => ({ path: entry, backupPath: '' })),
      errors: result.conflicts.length > 0 ? [result.message] : []
    }
  }
}

export const cloudSyncService = new CloudSyncService()


