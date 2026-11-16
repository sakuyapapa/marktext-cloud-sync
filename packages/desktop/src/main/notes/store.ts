/**
 * Sticky-note records. Notes live in `userData/notes.json` so they survive
 * restarts, keep their name/tag, and can be reopened from the context menu.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import log from 'electron-log'

export interface NoteBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface NoteRecord {
  id: string
  name: string
  /** Bound tag, e.g. `#会议`; inserted before the content when sent to the doc. */
  tag: string
  content: string
  pinned: boolean
  bounds?: NoteBounds
  updatedAt: number
}

interface NotesFile {
  version: 1
  notes: NoteRecord[]
}

const filePath = (): string => path.join(app.getPath('userData'), 'notes.json')

const read = (): NotesFile => {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as NotesFile
    if (raw && Array.isArray(raw.notes)) return raw
  } catch {
    // First run or a corrupt file: start empty.
  }
  return { version: 1, notes: [] }
}

const write = (data: NotesFile): void => {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true })
    fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8')
  } catch (error) {
    log.warn('[note] failed to persist notes', error)
  }
}

export const listNotes = (): NoteRecord[] =>
  read()
    .notes.slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)

export const getNote = (id: string): NoteRecord | null =>
  read().notes.find((note) => note.id === id) ?? null

export const createNote = (): NoteRecord => {
  const data = read()
  const note: NoteRecord = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `便签 ${data.notes.length + 1}`,
    tag: '',
    content: '',
    pinned: true,
    updatedAt: Date.now()
  }
  data.notes.push(note)
  write(data)
  return note
}

export const updateNote = (id: string, patch: Partial<Omit<NoteRecord, 'id'>>): NoteRecord | null => {
  const data = read()
  const note = data.notes.find((entry) => entry.id === id)
  if (!note) return null
  Object.assign(note, patch, { updatedAt: Date.now() })
  write(data)
  return note
}

export const deleteNote = (id: string): void => {
  const data = read()
  data.notes = data.notes.filter((note) => note.id !== id)
  write(data)
}

export const mostRecentNote = (): NoteRecord | null => listNotes()[0] ?? null
