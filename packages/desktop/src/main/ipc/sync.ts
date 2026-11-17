import { BrowserWindow, dialog, ipcMain } from 'electron'
import { cloudSyncService } from '../sync/service'
import type { SyncConfig } from '@shared/types/sync'

/** Renderer-side config sends carry the password field; an empty value means "keep the stored one". */
const withStoredPassword = (partial: Partial<SyncConfig>): Partial<SyncConfig> => {
  const stored = cloudSyncService.getConfig()
  const next: Partial<SyncConfig> = { ...partial }
  if (partial.webdav && partial.webdav.password === '') {
    next.webdav = { ...partial.webdav, password: stored.webdav.password }
  }
  if (partial.feishu && partial.feishu.appSecret === '') {
    next.feishu = { ...partial.feishu, appSecret: stored.feishu.appSecret }
  }
  return next
}

export const registerSyncHandlers = (): void => {
  ipcMain.handle('mt::sync::get-config', () => cloudSyncService.getConfig())
  ipcMain.handle('mt::sync::set-config', (_event, partial: Partial<SyncConfig>) =>
    cloudSyncService.setConfig(withStoredPassword(partial ?? {}))
  )
  ipcMain.handle('mt::sync::test', (_event, config?: SyncConfig) =>
    cloudSyncService.test({ ...cloudSyncService.getConfig(), ...(config ?? {}) })
  )
  ipcMain.handle('mt::sync::run', () => cloudSyncService.runNow('manual'))
  ipcMain.handle('mt::sync::status', () => cloudSyncService.getStatus())
  ipcMain.handle('mt::sync::choose-workspace', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Select the folder to sync',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })
}

