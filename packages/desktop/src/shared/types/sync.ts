/**
 * Types shared by the main process sync service, the preload bridge and the
 * preferences UI. Kept free of Electron imports so unit tests and the pure
 * Node engine can consume them directly.
 */

export type SyncProviderKind = 'webdav' | 'git' | 'feishu'

export type SyncConflictPolicy = 'keep-both' | 'local-wins' | 'remote-wins'

export interface WebdavSyncConfig {
  /** Collection URL, e.g. `https://dav.jianguoyun.com/dav/` */
  url: string
  username: string
  password: string
  /** Sub-directory of the collection that mirrors the workspace. */
  remoteDir: string
  /** Skip TLS verification (self-signed NAS certificates). */
  allowInsecure: boolean
}

export interface FeishuSyncConfig {
  /** Feishu app credentials (open.feishu.cn → 开发者后台). */
  appId: string
  appSecret: string
  /** Token of the Drive folder shared with the app. */
  folderToken: string
  /** open.feishu.cn (China) or open.larksuite.com. */
  baseUrl: string
}

export interface GitSyncConfig {
  /** Repository the workspace is pushed to, e.g. `http://gitlab.local/team/docs.git`. */
  remoteUrl: string
  branch: string
  userName: string
  userEmail: string
}

export interface SyncConfig {
  enabled: boolean
  provider: SyncProviderKind
  /** Absolute path of the local folder that is mirrored. */
  workspaceDir: string
  /** Background pull interval; 0 disables the timer. */
  intervalMinutes: number
  conflictPolicy: SyncConflictPolicy
  /** Debounce after a local file change before pushing, in milliseconds. */
  debounceMs: number
  webdav: WebdavSyncConfig
  git: GitSyncConfig
  feishu: FeishuSyncConfig
}

export type SyncPhase =
  | 'idle'
  | 'scanning'
  | 'uploading'
  | 'downloading'
  | 'done'
  | 'error'
  | 'disabled'

export interface SyncConflictEntry {
  path: string
  /** Where the losing copy was written, relative to the workspace. */
  backupPath: string
}

export interface SyncStatus {
  phase: SyncPhase
  message: string
  lastSyncAt: number | null
  lastResult: {
    uploaded: number
    downloaded: number
    deleted: number
    conflicts: SyncConflictEntry[]
    errors: string[]
  } | null
  /** Set while a run is in flight. */
  running: boolean
}

export interface SyncTestResult {
  ok: boolean
  message: string
}

export interface GitSyncResult {
  committed: boolean
  pushed: boolean
  conflicts: string[]
  message: string
}

