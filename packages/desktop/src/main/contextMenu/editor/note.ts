import { BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import { createAndOpenNote, currentTheme, openNoteWindow, openOrCreateNote } from '../../noteWindow'
import { listNotes } from '../../notes/store'

const ownerWindow = (targetWindow?: unknown): BrowserWindow | null =>
  (targetWindow as BrowserWindow | undefined) ??
  BrowserWindow.getFocusedWindow() ??
  BrowserWindow.getAllWindows()[0] ??
  null

/**
 * Sticky notes are independent windows, so the menu lists the saved notes and
 * offers "new note" at the top.
 */
export const getNoteMenu = (): MenuItemConstructorOptions => {
  const notes = listNotes().slice(0, 12)
  const items: MenuItemConstructorOptions[] = [
    {
      label: t('contextMenu.noteNew'),
      accelerator: 'CmdOrCtrl+Alt+N',
      click: (_item, targetWindow) => createAndOpenNote(ownerWindow(targetWindow), currentTheme())
    }
  ]

  if (notes.length > 0) {
    items.push({ type: 'separator' })
    for (const note of notes) {
      const label = note.tag ? `${note.name}  ${note.tag}` : note.name
      items.push({
        label,
        click: (_item, targetWindow) =>
          openNoteWindow(note.id, ownerWindow(targetWindow), currentTheme())
      })
    }
  }

  return {
    label: t('contextMenu.openNote'),
    id: 'openNoteMenuItem',
    submenu: items
  }
}

/** Shortcut target: most recent note, or a new one. */
export const openNoteShortcut = (win: BrowserWindow | null): void => {
  openOrCreateNote(win, currentTheme())
}
