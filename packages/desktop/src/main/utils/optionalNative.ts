/**
 * Loaders for the two native modules that may be absent from a build.
 *
 * `keytar` and `native-keymap` are compiled against Electron's ABI, so a
 * machine without the C++ toolchain cannot build them. Treating them as
 * optional keeps the app runnable there: credentials fall back to a
 * userData file and the keyboard layout reports an empty map.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import log from 'electron-log'

export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

export interface NativeKeymap {
  getCurrentKeyboardLayout(): unknown
  getKeyMap(): Record<string, unknown>
  onDidChangeKeyboardLayout(listener: () => void): void
}

let keytarModule: KeytarLike | null | undefined
let keymapModule: NativeKeymap | null | undefined

const loadKeytar = (): KeytarLike | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarLike
  } catch (error) {
    log.warn('[native] keytar unavailable, falling back to a local secrets file:', error)
    return null
  }
}

export const getNativeKeymap = (): NativeKeymap | null => {
  if (keymapModule !== undefined) return keymapModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    keymapModule = require('native-keymap') as NativeKeymap
  } catch (error) {
    log.warn('[native] native-keymap unavailable, keyboard layout fallback in use:', error)
    keymapModule = null
  }
  return keymapModule
}

interface FallbackSecrets {
  [service: string]: { [account: string]: string }
}

const fallbackPath = (): string => path.join(app.getPath('userData'), 'secrets-fallback.json')

const readFallback = (): FallbackSecrets => {
  try {
    return JSON.parse(fs.readFileSync(fallbackPath(), 'utf8')) as FallbackSecrets
  } catch {
    return {}
  }
}

const writeFallback = (data: FallbackSecrets): void => {
  fs.mkdirSync(path.dirname(fallbackPath()), { recursive: true })
  fs.writeFileSync(fallbackPath(), JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
}

const fileKeytar: KeytarLike = {
  async getPassword(service, account) {
    return readFallback()[service]?.[account] ?? null
  },
  async setPassword(service, account, password) {
    const data = readFallback()
    data[service] = { ...data[service], [account]: password }
    writeFallback(data)
  },
  async deletePassword(service, account) {
    const data = readFallback()
    const existing = data[service]?.[account]
    if (existing === undefined) return false
    delete data[service]?.[account]
    writeFallback(data)
    return true
  }
}

/** OS keyring when the native module loads, plain file store otherwise. */
export const getKeytar = (): KeytarLike => {
  if (keytarModule === undefined) {
    keytarModule = loadKeytar()
  }
  return keytarModule ?? fileKeytar
}
