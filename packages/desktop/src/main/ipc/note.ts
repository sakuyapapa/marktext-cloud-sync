import { BrowserWindow, ipcMain } from 'electron'
import {
  cancelNote,
  isNotePinned,
  openNoteWindow,
  setNoteDraft,
  submitNote,
  toggleNotePin
} from '../noteWindow'

export const registerNoteHandlers = (): void => {
  ipcMain.handle('mt::note::open', (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    openNoteWindow(owner)
    return true
  })

  ipcMain.on('mt::note::draft', (_event, text: string) => setNoteDraft(text))
  ipcMain.on('mt::note::submit', (_event, text: string) => submitNote(text))
  ipcMain.on('mt::note::cancel', () => cancelNote())

  ipcMain.handle('mt::note::toggle-pin', () => toggleNotePin())
  ipcMain.handle('mt::note::is-pinned', () => isNotePinned())
}
