import { BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { AiAction } from '@shared/types/ai'
import { t } from '../../i18n'

const sendAction = (action: AiAction | 'add-context') => (): void => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (action === 'add-context') {
    win.webContents.send('mt::ai::add-context')
    return
  }
  win.webContents.send('mt::ai::action', action)
}

/** Submenu entry: the renderer owns the selection, so main only forwards. */
export const getAiMenu = (): MenuItemConstructorOptions => ({
  label: 'AI',
  id: 'aiMenuItem',
  submenu: [
    { label: t('contextMenu.aiPolish'), click: sendAction('polish') },
    { label: t('contextMenu.aiSummarize'), click: sendAction('summarize') },
    { label: t('contextMenu.aiContinue'), click: sendAction('continue') },
    { label: t('contextMenu.aiTranslate'), click: sendAction('translate') },
    { type: 'separator' },
    {
      label: t('contextMenu.aiAddContext'),
      accelerator: 'CmdOrCtrl+Alt+A',
      click: sendAction('add-context')
    },
    { label: t('contextMenu.aiChat'), click: sendAction('chat') }
  ]
})
