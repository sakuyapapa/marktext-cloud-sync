import { BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import { openNoteWindow } from '../../noteWindow'

/**
 * Sticky note: the renderer captures the caret first (`mt::note::prepare`),
 * then the always-on-top note window opens. Closing it sends the text back.
 */
export const getOpenNote = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.openNote'),
  id: 'openNoteMenuItem',
  click(_menuItem, targetWindow) {
    const win =
      (targetWindow as BrowserWindow | undefined) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('mt::note::prepare')
    // Give the renderer a tick to record the caret before focus moves.
    setTimeout(() => openNoteWindow(win ?? null), 80)
  }
})
