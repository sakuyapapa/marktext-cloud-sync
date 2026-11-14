/**
 * AI settings. The API key is encrypted with Electron safeStorage (DPAPI on
 * Windows) and never leaves the main process in plain text.
 */

import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import type { AiConfig } from '@shared/types/ai'

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxTokens: 2048
}

interface StoredAiConfig extends Omit<AiConfig, 'apiKey'> {
  apiKeyCipher?: string
  apiKeyPlain?: string
}

interface AiStoreShape {
  config: StoredAiConfig
}

export class AiConfigStore {
  private readonly store: Store<AiStoreShape>

  constructor() {
    this.store = new Store<AiStoreShape>({
      name: 'ai-config',
      cwd: app.getPath('userData'),
      defaults: { config: DEFAULT_AI_CONFIG as unknown as StoredAiConfig }
    })
  }

  get(): AiConfig {
    const stored = (this.store.get('config') as StoredAiConfig | undefined) ?? ({} as StoredAiConfig)
    const apiKey = this.decrypt(stored)
    return {
      ...DEFAULT_AI_CONFIG,
      ...stored,
      apiKey
    }
  }

  set(partial: Partial<AiConfig>): AiConfig {
    const current = this.get()
    const merged: AiConfig = { ...current, ...partial }
    const { apiKey, ...rest } = merged
    const secret = this.encrypt(apiKey)
    this.store.set('config', { ...rest, ...secret } as StoredAiConfig)
    return merged
  }

  private encrypt(value: string): Pick<StoredAiConfig, 'apiKeyCipher' | 'apiKeyPlain'> {
    if (!value) return {}
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return { apiKeyCipher: safeStorage.encryptString(value).toString('base64') }
      }
    } catch {
      // Fall through to the plain value; documented in the settings panel.
    }
    return { apiKeyPlain: value }
  }

  private decrypt(stored: StoredAiConfig): string {
    if (stored.apiKeyCipher) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.apiKeyCipher, 'base64'))
      } catch {
        return ''
      }
    }
    return stored.apiKeyPlain ?? ''
  }
}

export const aiConfigStore = new AiConfigStore()
