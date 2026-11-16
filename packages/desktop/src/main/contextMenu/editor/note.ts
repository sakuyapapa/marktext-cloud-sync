import { BrowserWindow, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import { openNoteForWindow } from '../../noteWindow'

/**
 * Sticky note: the renderer captures the caret first (`mt::note::prepare`),
 * then the always-on-top note window opens. Closing it sends the text back.
 */
export const getOpenNote = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.openNote'),
  id: 'openNoteMenuItem',
  // Displayed as a hint; the binding itself is registered per window in
  // `keyboard/appShortcuts.ts`.
  accelerator: 'CmdOrCtrl+Alt+N',
  click(_menuItem, targetWindow) {
    const win =
      (targetWindow as BrowserWindow | undefined) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0]
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    openNoteForWindow(win ?? null, theme)
  }
})
