import { BrowserWindow, ipcMain, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import { cloudSyncService } from '../../sync/service'

const quickSync = (provider: 'feishu' | 'git' | 'webdav') => (): void => {
  const config = cloudSyncService.getConfig()
  if (!config.workspaceDir) {
    // Nothing to mirror yet: take the user to the settings panel instead.
    ipcMain.emit('mt::open-setting-window')
    return
  }
  void cloudSyncService.syncWith(provider).then((status) => {
    const message =
      status.phase === 'error'
        ? `鍚屾澶辫触锛?{status.message}`
        : status.lastResult
          ? `鍚屾瀹屾垚锛氣啈${status.lastResult.uploaded} 鈫?{status.lastResult.downloaded}`
          : '鍚屾瀹屾垚'
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (target && !target.isDestroyed()) {
      target.webContents.send('mt::show-notification', { message, type: 'info' })
    }
  })
}

export const getSyncMenu = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.syncTitle'),
  id: 'syncMenuItem',
  submenu: [
    { label: t('contextMenu.syncFeishu'), click: quickSync('feishu') },
    { label: t('contextMenu.syncGit'), click: quickSync('git') },
    { label: t('contextMenu.syncWebdav'), click: quickSync('webdav') },
    { type: 'separator' },
    {
      label: t('contextMenu.syncSettings'),
      click: () => ipcMain.emit('mt::open-setting-window')
    }
  ]
})

