/**
 * Persistence for the sync settings. Secrets use Electron's safeStorage
 * (DPAPI on Windows) when available and fall back to plain text only on
 * platforms where the OS keyring is not reachable — the same trade-off the app
 * already makes for other optional integrations.
 */

import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import type { SyncConfig } from '@shared/types/sync'

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  provider: 'webdav',
  workspaceDir: '',
  intervalMinutes: 10,
  conflictPolicy: 'keep-both',
  debounceMs: 3000,
  webdav: {
    url: '',
    username: '',
    password: '',
    remoteDir: 'marktext',
    allowInsecure: false
  },
  git: {
    remoteUrl: '',
    branch: 'main',
    userName: '',
    userEmail: ''
  },
  feishu: {
    appId: '',
    appSecret: '',
    folderToken: '',
    baseUrl: 'https://open.feishu.cn'
  }
}

interface SyncStoreShape {
  config: Omit<SyncConfig, 'webdav' | 'feishu'> & {
    webdav: Omit<SyncConfig['webdav'], 'password'> & { passwordCipher?: string; passwordPlain?: string }
    feishu: Omit<SyncConfig['feishu'], 'appSecret'> & {
      appSecretCipher?: string
      appSecretPlain?: string
    }
  }
}

const STORE_NAME = 'cloud-sync'

const encryptSecret = (value: string): { passwordCipher?: string; passwordPlain?: string } => {
  if (!value) return {}
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { passwordCipher: safeStorage.encryptString(value).toString('base64') }
    }
  } catch {
    // Fall through to the plain-text path below.
  }
  return { passwordPlain: value }
}

const decryptSecret = (entry: { passwordCipher?: string; passwordPlain?: string }): string => {
  if (entry.passwordCipher) {
    try {
      return safeStorage.decryptString(Buffer.from(entry.passwordCipher, 'base64'))
    } catch {
      return ''
    }
  }
  return entry.passwordPlain ?? ''
}

const normalise = (partial: Partial<SyncConfig>): Partial<SyncConfig> => {
  const next: Partial<SyncConfig> = { ...partial }
  if (next.intervalMinutes !== undefined) {
    next.intervalMinutes = Math.max(0, Math.min(24 * 60, Math.round(next.intervalMinutes)))
  }
  if (next.debounceMs !== undefined) {
    next.debounceMs = Math.max(500, Math.min(60_000, Math.round(next.debounceMs)))
  }
  if (next.workspaceDir) {
    next.workspaceDir = next.workspaceDir.trim()
  }
  return next
}

export class SyncConfigStore {
  private readonly store: Store<SyncStoreShape>

  constructor() {
    this.store = new Store<SyncStoreShape>({
      name: STORE_NAME,
      cwd: app.getPath('userData'),
      defaults: { config: DEFAULT_SYNC_CONFIG as unknown as SyncStoreShape['config'] }
    })
  }

  get(): SyncConfig {
    const raw = this.store.get('config') as SyncStoreShape['config'] | undefined
    if (!raw) return structuredClone(DEFAULT_SYNC_CONFIG)
    const { passwordCipher, passwordPlain, ...webdav } = raw.webdav ?? {}
    const { appSecretCipher, appSecretPlain, ...feishu } = raw.feishu ?? {}
    return {
      ...structuredClone(DEFAULT_SYNC_CONFIG),
      ...raw,
      webdav: {
        ...DEFAULT_SYNC_CONFIG.webdav,
        ...webdav,
        password: decryptSecret({ passwordCipher, passwordPlain })
      },
      feishu: {
        ...DEFAULT_SYNC_CONFIG.feishu,
        ...feishu,
        appSecret: decryptSecret({ passwordCipher: appSecretCipher, passwordPlain: appSecretPlain })
      }
    }
  }

  set(partial: Partial<SyncConfig>): SyncConfig {
    const current = this.get()
    const merged: SyncConfig = {
      ...current,
      ...normalise(partial),
      webdav: { ...current.webdav, ...(partial.webdav ?? {}) },
      git: { ...current.git, ...(partial.git ?? {}) },
      feishu: { ...current.feishu, ...(partial.feishu ?? {}) }
    }
    const { password, ...webdavRest } = merged.webdav
    const { appSecret, ...feishuRest } = merged.feishu
    this.store.set('config', {
      ...merged,
      webdav: { ...webdavRest, ...encryptSecret(password) },
      feishu: { ...feishuRest, ...{ appSecretCipher: encryptSecret(appSecret).passwordCipher, appSecretPlain: encryptSecret(appSecret).passwordPlain } }
    } as unknown as SyncStoreShape['config'])
    return merged
  }
}


