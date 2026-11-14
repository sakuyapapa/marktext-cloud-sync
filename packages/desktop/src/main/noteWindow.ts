/**
 * Floating "sticky note" window.
 *
 * A real always-on-top BrowserWindow (not an in-page overlay) so the note stays
 * visible above other applications while the user reads the document. The page
 * is `static/note.html` and talks to the main process through the shared
 * preload bridge.
 *
 * Closing the window returns the draft to the document, per the feature spec;
 * only the explicit cancel path drops it.
 */

import path from 'path'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log'

let noteWindow: BrowserWindow | null = null
let noteOwner: BrowserWindow | null = null
let latestDraft = ''
let suppressSubmitOnClose = false

const staticRoot = (): string =>
  path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'static')

const noteUrl = (): string => `file://${path.join(staticRoot(), 'note.html').replace(/\\/g, '/')}`

export const getNoteWindow = (): BrowserWindow | null => noteWindow

export const setNoteDraft = (text: string): void => {
  latestDraft = typeof text === 'string' ? text : ''
}

const ownerWindow = (): BrowserWindow | null => {
  if (noteOwner && !noteOwner.isDestroyed()) return noteOwner
  return (
    BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('type=editor')) ??
    null
  )
}

const deliver = (text: string): void => {
  const owner = ownerWindow()
  if (!owner) return
  owner.webContents.send('mt::note::insert', text)
  owner.focus()
}

const finish = (): void => {
  suppressSubmitOnClose = true
  if (noteWindow && !noteWindow.isDestroyed()) noteWindow.close()
  noteWindow = null
  noteOwner = null
  latestDraft = ''
}

/** Explicit "插入到文档": send the text and close. */
export const submitNote = (text: string): void => {
  setNoteDraft(text)
  const payload = latestDraft
  deliver(payload)
  finish()
}

/** Cancel: drop the draft. */
export const cancelNote = (): void => {
  latestDraft = ''
  finish()
}

export const openNoteWindow = (owner: BrowserWindow | null): BrowserWindow => {
  noteOwner = owner

  if (noteWindow && !noteWindow.isDestroyed()) {
    noteWindow.show()
    noteWindow.focus()
    return noteWindow
  }

  latestDraft = ''
  suppressSubmitOnClose = false

  noteWindow = new BrowserWindow({
    width: 440,
    height: 400,
    minWidth: 320,
    minHeight: 220,
    title: '便签',
    frame: true,
    alwaysOnTop: true,
    backgroundColor: '#fffbe6',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  // The window manager close button behaves like "插入到文档": the spec says
  // closing the note returns its content to the document.
  noteWindow.on('close', () => {
    if (suppressSubmitOnClose) return
    if (latestDraft.trim()) deliver(latestDraft)
  })

  noteWindow.on('closed', () => {
    noteWindow = null
    noteOwner = null
    latestDraft = ''
  })
  noteWindow.on('unresponsive', () => log.warn('[note] window unresponsive'))

  void noteWindow.loadURL(noteUrl())
  return noteWindow
}

export const toggleNotePin = (): boolean => {
  if (!noteWindow || noteWindow.isDestroyed()) return false
  const next = !noteWindow.isAlwaysOnTop()
  noteWindow.setAlwaysOnTop(next)
  return next
}

export const isNotePinned = (): boolean =>
  !!noteWindow && !noteWindow.isDestroyed() && noteWindow.isAlwaysOnTop()
