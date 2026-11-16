import { BrowserWindow, nativeTheme } from 'electron'
import { openNoteForWindow } from '../noteWindow'

/**
 * Window-local shortcuts for the fork features.
 *
 * `before-input-event` is used instead of the menu/accelerator route because the
 * editor disables menu shortcuts and the renderer keeps focus (MarkText already
 * routes its own keybindings through the same event).
 */
export const registerWindowShortcuts = (win: BrowserWindow): void => {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const withCtrl = input.control || input.meta
    if (!withCtrl || !input.alt) return

    const key = (input.key || '').toLowerCase()

    if (key === 'n') {
      event.preventDefault()
      const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      openNoteForWindow(win, theme)
      return
    }

    if (key === 'a') {
      event.preventDefault()
      if (!win.isDestroyed()) win.webContents.send('mt::ai::add-context')
    }
  })
}
