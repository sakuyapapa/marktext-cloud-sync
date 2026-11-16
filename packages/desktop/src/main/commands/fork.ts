import { BrowserWindow } from 'electron'
import COMMAND_CONSTANTS from 'common/commands/constants'

const COMMANDS = COMMAND_CONSTANTS
import { openNoteShortcut } from '../contextMenu/editor/note'

const targetWindow = (win?: BrowserWindow | null): BrowserWindow | null => {
  if (win && !win.isDestroyed()) return win
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/**
 * Commands for the fork features. They are registered so the keybinding editor
 * lists them and users can rebind / unbind them like any built-in shortcut.
 */
export const loadForkCommands = (commandManager: {
  add: (id: string, callback: (...args: unknown[]) => unknown) => void
}): void => {
  commandManager.add(COMMANDS.MT_OPEN_NOTE, (...args: unknown[]) => {
    const win = targetWindow(args[0] as BrowserWindow | undefined)
    if (!win) return
    openNoteShortcut(win)
  })

  commandManager.add(COMMANDS.MT_AI_ADD_CONTEXT, (...args: unknown[]) => {
    const win = targetWindow(args[0] as BrowserWindow | undefined)
    if (!win) return
    win.webContents.send('mt::ai::add-context')
  })
}



