/**
 * Insertion bridge for sticky-note windows.
 *
 * The note window takes focus, so the caret is captured before it opens
 * (`mt::note::prepare`) and replayed when the note sends its text back
 * (`mt::note::insert`).
 */

import { insertPlainText } from '@/util/insertText'

let savedEditor: HTMLElement | null = null
let savedRange: Range | null = null

const editorFromNode = (node: Node | null): HTMLElement | null => {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return (element?.closest('.mu-editor') as HTMLElement | null) ?? null
}

export const prepareNoteInsert = (): void => {
  try {
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    const editor =
      editorFromNode(range?.startContainer ?? null) ?? editorFromNode(document.activeElement)
    if (editor) savedEditor = editor
    if (range) savedRange = range
  } catch {
    // Keep the previously captured caret when the current selection is unusable.
  }
}

export const insertNoteText = (text: string): void => {
  const payload = typeof text === 'string' ? text : ''
  if (!payload.trim()) return

  const editor = savedEditor
  if (editor && editor.isConnected) {
    editor.focus()
    const selection = window.getSelection()
    if (selection && savedRange) {
      try {
        selection.removeAllRanges()
        selection.addRange(savedRange)
      } catch {
        // The block was re-rendered; fall through to the native caret.
      }
    }
  }

  try {
    insertPlainText(payload, savedEditor)
  } catch (error) {
    console.error('[note] failed to insert note content', error)
  }
}
