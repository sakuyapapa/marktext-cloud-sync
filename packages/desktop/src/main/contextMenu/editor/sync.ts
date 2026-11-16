import { BrowserWindow, ipcMain, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import { cloudSyncService } from '../../sync/service'

type QuickProvider = 'feishu' | 'git' | 'webdav'
type NoticeType = 'primary' | 'info' | 'warning' | 'error'

const PROVIDER_LABEL: Record<QuickProvider, string> = {
  feishu: '飞书云文档',
  git: 'Git',
  webdav: 'WebDAV'
}

/**
 * Notifications must land in the editor window: after a menu action focus may
 * sit on the (hidden) settings window, and a toast sent there is never seen.
 */
const editorWindow = (): BrowserWindow | null => {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && focused.webContents.getURL().includes('type=editor')) {
    return focused
  }
  return (
    BrowserWindow.getAllWindows().find(
      (win) => !win.isDestroyed() && win.webContents.getURL().includes('type=editor')
    ) ?? null
  )
}

const notify = (message: string, type: NoticeType = 'primary', time = 8000, title = '同步'): void => {
  const target = editorWindow()
  if (!target) return
  target.webContents.send('mt::show-notification', { title, message, type, time })
}

const describeResult = (
  uploaded: number,
  downloaded: number,
  deleted: number,
  conflicts: number
): string => {
  const parts: string[] = []
  if (uploaded) parts.push(`上传 ${uploaded}`)
  if (downloaded) parts.push(`下载 ${downloaded}`)
  if (deleted) parts.push(`删除 ${deleted}`)
  if (conflicts) parts.push(`冲突 ${conflicts}（已另存副本）`)
  return parts.length ? parts.join('，') : '没有需要同步的改动'
}

const quickSync = (provider: QuickProvider) => (): void => {
  const config = cloudSyncService.getConfig()
  if (!config.workspaceDir) {
    ipcMain.emit('mt::open-setting-window')
    return
  }

  const label = PROVIDER_LABEL[provider]
  notify(`正在同步到 ${label}…`, 'info', 6000)

  cloudSyncService
    .syncWith(provider)
    .then((status) => {
      if (status.phase === 'error') {
        notify(`同步失败：${status.message || '未知错误'}`, 'error', 12000)
        return
      }
      const result = status.lastResult
      if (!result) {
        notify('同步完成', 'info', 8000)
        return
      }
      if (result.errors.length > 0) {
        notify(`同步完成，但有 ${result.errors.length} 个文件失败：${result.errors[0]}`, 'warning', 12000)
        return
      }
      const summary = describeResult(
        result.uploaded,
        result.downloaded,
        result.deleted,
        result.conflicts.length
      )
      notify(`已同步到 ${label}：${summary}`, 'info', 15000)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      notify(`同步失败：${message}`, 'error', 12000)
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
