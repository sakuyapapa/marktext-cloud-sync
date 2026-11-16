/**
 * Sticky-note windows.
 *
 * Each note is its own small always-on-top BrowserWindow, so several notes can be
 * open at once. Window chrome is hidden; the page draws a drag bar with the note
 * name, its bound tag, a style switch and the close button.
 */

import path from 'path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import log from 'electron-log'
import {
  createNote,
  getNote,
  mostRecentNote,
  updateNote,
  type NoteRecord
} from './notes/store'

const windows = new Map<string, BrowserWindow>()
let noteOwner: BrowserWindow | null = null
const drafts = new Map<string, string>()

const staticRoot = (): string =>
  path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'static')

const noteUrl = (id: string, theme: string): string => {
  const file = path.join(staticRoot(), 'note.html').replace(/\\/g, '/')
  return `file://${file}?id=${encodeURIComponent(id)}&theme=${encodeURIComponent(theme)}`
}

export const getNoteWindows = (): BrowserWindow[] =>
  [...windows.values()].filter((win) => !win.isDestroyed())

export const getNoteWindowById = (id: string): BrowserWindow | null => {
  const win = windows.get(id)
  return win && !win.isDestroyed() ? win : null
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
  if (!owner || owner.isDestroyed() || !text.trim()) return
  owner.webContents.send('mt::note::insert', text)
  owner.focus()
}

/** Insert a note's text (prefixed with its bound tag) into the document. */
export const insertNoteIntoDocument = (id: string): void => {
  const note = getNote(id)
  if (!note) return
  const draft = drafts.get(id)
  const body = (draft ?? note.content ?? '').trim()
  if (!body) return
  const tag = note.tag.trim()
  deliver(tag ? `${tag}\n${body}` : body)
}

export const setNoteDraft = (id: string, text: string): void => {
  drafts.set(id, typeof text === 'string' ? text : '')
  updateNote(id, { content: drafts.get(id) ?? '' })
}

export const saveNoteBounds = (id: string, win: BrowserWindow): void => {
  if (win.isDestroyed() || win.isMinimized()) return
  updateNote(id, { bounds: win.getBounds() })
}

export const closeNoteWindow = (id: string): void => {
  const win = windows.get(id)
  windows.delete(id)
  if (win && !win.isDestroyed()) {
    win.removeAllListeners('close')
    win.close()
  }
  drafts.delete(id)
}

export const toggleNotePin = (id: string): boolean => {
  const win = getNoteWindowById(id)
  if (!win) return false
  const next = !win.isAlwaysOnTop()
  win.setAlwaysOnTop(next)
  updateNote(id, { pinned: next })
  return next
}

export const isNotePinned = (id: string): boolean => {
  const win = getNoteWindowById(id)
  return win ? win.isAlwaysOnTop() : (getNote(id)?.pinned ?? true)
}

export const openNoteWindow = (
  id: string,
  owner: BrowserWindow | null,
  theme = 'light'
): BrowserWindow | null => {
  const note = getNote(id)
  if (!note) return null
  noteOwner = owner

  const existing = getNoteWindowById(id)
  if (existing) {
    existing.show()
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    ...(note.bounds ?? { width: 380, height: 320 }),
    minWidth: 280,
    minHeight: 180,
    title: note.name,
    frame: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    alwaysOnTop: note.pinned,
    backgroundColor: theme === 'dark' ? '#1f1f1f' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  win.setMenu(null)
  win.setMenuBarVisibility(false)
  windows.set(id, win)

  win.on('resize', () => saveNoteBounds(id, win))
  win.on('move', () => saveNoteBounds(id, win))
  win.on('closed', () => {
    windows.delete(id)
    drafts.delete(id)
  })
  win.on('unresponsive', () => log.warn(`[note] window unresponsive: ${id}`))

  void win.loadURL(noteUrl(id, theme))
  return win
}

/**
 * Open a note by id, or the most recent one, or create a new note.
 * Returns the window so the caller can focus it.
 */
export const openOrCreateNote = (
  owner: BrowserWindow | null,
  theme = 'light'
): BrowserWindow | null => {
  if (owner && !owner.isDestroyed()) owner.webContents.send('mt::note::prepare')
  const record: NoteRecord = mostRecentNote() ?? createNote()
  setTimeout(() => openNoteWindow(record.id, owner, theme), 60)
  return getNoteWindowById(record.id)
}

export const createAndOpenNote = (owner: BrowserWindow | null, theme = 'light'): BrowserWindow | null => {
  if (owner && !owner.isDestroyed()) owner.webContents.send('mt::note::prepare')
  const record = createNote()
  setTimeout(() => openNoteWindow(record.id, owner, theme), 60)
  return getNoteWindowById(record.id)
}

export const currentTheme = (): string => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

