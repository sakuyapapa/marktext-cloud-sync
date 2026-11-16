import { BrowserWindow, ipcMain } from 'electron'
import {
  closeNoteWindow,
  createAndOpenNote,
  currentTheme,
  insertNoteIntoDocument,
  isNotePinned,
  openNoteWindow,
  openOrCreateNote,
  setNoteDraft,
  toggleNotePin
} from '../noteWindow'
import { createNote, deleteNote, getNote, listNotes, updateNote } from '../notes/store'

export const registerNoteHandlers = (): void => {
  ipcMain.handle('mt::note::list', () =>
    listNotes().map((note) => ({
      id: note.id,
      name: note.name,
      tag: note.tag,
      updatedAt: note.updatedAt
    }))
  )

  ipcMain.handle('mt::note::get', (_event, id: string) => getNote(id))

  ipcMain.handle('mt::note::create', () => createNote())

  ipcMain.handle('mt::note::open', (event, id?: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (id) {
      const win = openNoteWindow(id, owner, currentTheme())
      return !!win
    }
    openOrCreateNote(owner, currentTheme())
    return true
  })

  ipcMain.handle('mt::note::create-and-open', (event) => {
    const win = createAndOpenNote(BrowserWindow.fromWebContents(event.sender), currentTheme())
    return !!win
  })

  ipcMain.handle('mt::note::toggle-pin', (_event, id: string) => toggleNotePin(id))
  ipcMain.handle('mt::note::is-pinned', (_event, id: string) => isNotePinned(id))

  ipcMain.on('mt::note::update', (_event, id: string, patch: Record<string, unknown>) => {
    updateNote(id, patch as never)
  })

  ipcMain.on('mt::note::draft', (_event, id: string, text: string) => setNoteDraft(id, text))

  ipcMain.on('mt::note::submit', (_event, id: string) => {
    insertNoteIntoDocument(id)
    closeNoteWindow(id)
  })

  // Save without inserting into the document.
  ipcMain.on('mt::note::close', (_event, id: string) => closeNoteWindow(id))

  ipcMain.on('mt::note::delete', (_event, id: string) => {
    deleteNote(id)
    closeNoteWindow(id)
  })
}
