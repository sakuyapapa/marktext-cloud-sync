/**
 * Editor helpers for the AI actions: capture the current selection together with
 * a little surrounding context, and put AI text back into the document.
 *
 * The selection is cached continuously: clicking into the chat input moves focus
 * away from the editor (and Muya may drop the DOM selection), so the last
 * non-empty editor selection is kept for later chips / replacement.
 */

import { insertPlainText } from '@/util/insertText'

export interface AiEditorContext {
  selection: string
  before: string
  after: string
  label: string
}

interface CachedSelection {
  text: string
  before: string
  after: string
  label: string
  range: Range | null
  editor: HTMLElement | null
}

let cache: CachedSelection = {
  text: '',
  before: '',
  after: '',
  label: '',
  range: null,
  editor: null
}
let savedRange: Range | null = null
let savedEditor: HTMLElement | null = null

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th'

const blockFromNode = (node: Node | null): HTMLElement | null => {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return (element?.closest(BLOCK_SELECTOR) as HTMLElement | null) ?? null
}

const editorFromNode = (node: Node | null): HTMLElement | null => {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return (element?.closest('.mu-editor') as HTMLElement | null) ?? null
}

const surroundFromRange = (range: Range): { before: string; after: string; label: string } => {
  const block = blockFromNode(range.startContainer)
  if (!block) return { before: '', after: '', label: '' }
  const text = block.textContent ?? ''
  const selected = range.toString()
  const index = text.indexOf(selected)
  if (index < 0) {
    return { before: text.slice(0, 400), after: '', label: `${selected.length} 字` }
  }
  return {
    before: text.slice(Math.max(0, index - 400), index),
    after: text.slice(index + selected.length, index + selected.length + 400),
    label: `${selected.length} 字`
  }
}

/** Remember the caret while the editor still owns it. */
export const rememberSelection = (): void => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  const editor = editorFromNode(range.startContainer)
  if (!editor) return
  const text = range.toString()
  if (!text.trim()) return
  const { before, after, label } = surroundFromRange(range)
  cache = { text, before, after, label, range: range.cloneRange(), editor }
}

if (typeof document !== 'undefined') {
  document.addEventListener('selectionchange', rememberSelection)
  document.addEventListener('contextmenu', rememberSelection, true)
}

export const captureAiContext = (): AiEditorContext => {
  const selection = window.getSelection()
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  const liveEditor = editorFromNode(range?.startContainer ?? null)

  if (range && liveEditor) {
    savedRange = range
    savedEditor = liveEditor
    const { before, after, label } = surroundFromRange(range)
    return { selection: range.toString(), before, after, label }
  }

  // Focus already moved (chat input, drawer): fall back to the cached selection.
  if (cache.range && cache.editor) {
    savedRange = cache.range
    savedEditor = cache.editor
    return { selection: cache.text, before: cache.before, after: cache.after, label: cache.label }
  }

  return { selection: '', before: '', after: '', label: '' }
}

/** Chip helper: the last selection even if focus is currently elsewhere. */
export const lastSelection = (): { text: string; label: string } => ({
  text: cache.text,
  label: cache.label
})

const restore = (): boolean => {
  const editor = savedEditor
  if (!editor || !editor.isConnected) return false
  editor.focus()
  const selection = window.getSelection()
  if (!selection || !savedRange) return false
  try {
    selection.removeAllRanges()
    selection.addRange(savedRange)
    return true
  } catch {
    return false
  }
}

/** Replace the captured selection with the accepted AI text. */
export const applyAiText = (text: string): void => {
  if (!text.trim()) return
  if (!restore()) return
  try {
    insertPlainText(text, savedEditor)
  } catch (error) {
    console.warn('[ai] failed to apply text', error)
  }
}

/** Append the AI text after the captured selection instead of replacing it. */
export const insertAiText = (text: string): void => {
  if (!text.trim()) return
  if (!restore()) return
  try {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    insertPlainText(text, savedEditor)
  } catch (error) {
    console.warn('[ai] failed to insert text', error)
  }
}
