import { ipcMain } from 'electron'
import log from 'electron-log'

/**
 * Diagnostics for the tag popover: the menu action happens in the main process,
 * the card is rendered by the renderer, and without a round-trip the log cannot
 * tell "event never arrived" apart from "card failed to open".
 */
export const registerTagHandlers = (): void => {
  ipcMain.on('mt::tag::opened', () => {
    log.info('[tag] popover opened in renderer')
  })
  ipcMain.on('mt::tag::log', (_event, message: string) => {
    log.warn(`[tag] renderer: ${message}`)
  })
}
