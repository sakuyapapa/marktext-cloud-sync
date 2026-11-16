/**
 * Floating sticky-note window.
 *
 * Design constraints (from the user):
 *  - look like the main window (same theme, no menu bar, no system chrome);
 *  - the note can be pinned/unpinned at will and stays where it is put;
 *  - the note itself only supports style and size changes — plain text only.
 *
 * The window is frameless-looking (`titleBarStyle: 'hidden'`) so the OS resize
 * borders remain available, while the visible chrome is our own header.
 */

import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, Menu } from 'electron'
import log from 'electron-log'

interface NoteBounds {
  x?: number
  y?: number
  width: number
  height: number
}

let noteWindow: BrowserWindow | null = null
let noteOwner: BrowserWindow | null = null
let latestDraft = ''
let suppressSubmitOnClose = false
let pinned = true

const BOUNDS_FILE = (): string => path.join(app.getPath('userData'), 'note-window.json')

const loadBounds = (): NoteBounds => {
  try {
    const raw = JSON.parse(fs.readFileSync(BOUNDS_FILE(), 'utf8')) as NoteBounds
    if (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height)) return raw
  } catch {
    // First run or a corrupt file: fall back to the default size.
  }
  return { width: 440, height: 400 }
}

const saveBounds = (win: BrowserWindow): void => {
  try {
    if (win.isDestroyed() || win.isMinimized()) return
    const bounds = win.getBounds()
    fs.writeFileSync(BOUNDS_FILE(), JSON.stringify(bounds), 'utf8')
  } catch (error) {
    log.warn('[note] failed to persist window bounds', error)
  }
}

const staticRoot = (): string =>
  path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'static')

const noteUrl = (theme: string): string => {
  const file = path.join(staticRoot(), 'note.html').replace(/\\/g, '/')
  return `file://${file}?theme=${encodeURIComponent(theme)}`
}

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
  if (noteWindow && !noteWindow.isDestroyed()) {
    saveBounds(noteWindow)
    noteWindow.close()
  }
  noteWindow = null
  noteOwner = null
  latestDraft = ''
}

export const submitNote = (text: string): void => {
  setNoteDraft(text)
  const payload = latestDraft
  deliver(payload)
  finish()
}

export const cancelNote = (): void => {
  latestDraft = ''
  finish()
}

export const openNoteWindow = (owner: BrowserWindow | null, theme = 'light'): BrowserWindow => {
  noteOwner = owner

  if (noteWindow && !noteWindow.isDestroyed()) {
    noteWindow.show()
    noteWindow.focus()
    return noteWindow
  }

  latestDraft = ''
  suppressSubmitOnClose = false
  const bounds = loadBounds()

  noteWindow = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 200,
    title: '便签',
    frame: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: pinned,
    backgroundColor: theme === 'dark' ? '#1f1f1f' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  // No menu bar at all, per the design request.
  noteWindow.setMenu(null)
  noteWindow.setMenuBarVisibility(false)

  noteWindow.on('close', () => {
    if (suppressSubmitOnClose) return
    if (latestDraft.trim()) deliver(latestDraft)
  })

  noteWindow.on('closed', () => {
    noteWindow = null
    noteOwner = null
    latestDraft = ''
  })

  noteWindow.on('resize', () => {
    if (noteWindow) saveBounds(noteWindow)
  })
  noteWindow.on('move', () => {
    if (noteWindow) saveBounds(noteWindow)
  })

  void noteWindow.loadURL(noteUrl(theme))
  return noteWindow
}

export const toggleNotePin = (): boolean => {
  if (!noteWindow || noteWindow.isDestroyed()) return pinned
  pinned = !noteWindow.isAlwaysOnTop()
  noteWindow.setAlwaysOnTop(pinned)
  return pinned
}

export const isNotePinned = (): boolean =>
  !!noteWindow && !noteWindow.isDestroyed() ? noteWindow.isAlwaysOnTop() : pinned

/**
 * Shared entry point for the menu item and the keyboard shortcut: remember the
 * caret, then open the note once focus has moved.
 */
export const openNoteForWindow = (win: BrowserWindow | null, theme: string): void => {
  if (win && !win.isDestroyed()) win.webContents.send('mt::note::prepare')
  setTimeout(() => openNoteWindow(win, theme), 80)
}
