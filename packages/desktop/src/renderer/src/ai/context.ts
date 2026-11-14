/**
 * Editor helpers for the AI actions: capture the current selection together with
 * a little surrounding context, and put AI text back into the document.
 */

export interface AiEditorContext {
  selection: string
  before: string
  after: string
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

/** Text before/after the caret inside its block, capped to keep prompts small. */
const surroundFromRange = (range: Range): { before: string; after: string } => {
  const block = blockFromNode(range.startContainer)
  if (!block) return { before: '', after: '' }
  const text = block.textContent ?? ''
  const selected = range.toString()
  const index = text.indexOf(selected)
  if (index < 0) {
    return { before: text.slice(0, 400), after: '' }
  }
  return {
    before: text.slice(Math.max(0, index - 400), index),
    after: text.slice(index + selected.length, index + selected.length + 400)
  }
}

export const captureAiContext = (): AiEditorContext => {
  const selection = window.getSelection()
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  if (range) {
    savedRange = range
    savedEditor = editorFromNode(range.startContainer) ?? editorFromNode(document.activeElement)
    const { before, after } = surroundFromRange(range)
    return { selection: range.toString(), before, after }
  }
  return { selection: '', before: '', after: '' }
}

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

/**
 * Muya turns a real Enter keydown into a new paragraph; `insertText` alone drops
 * the newline characters, so multi-line results are inserted line by line with a
 * synthetic Enter between them.
 */
const typeMultiline = (text: string): void => {
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line) document.execCommand('insertText', false, line)
    if (index === lines.length - 1) return
    const target = savedEditor ?? (document.activeElement as HTMLElement | null)
    if (!target) return
    for (const type of ['keydown', 'keyup'] as const) {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      )
    }
  })
}

/** Replace the captured selection with the accepted AI text. */
export const applyAiText = (text: string): void => {
  if (!text.trim()) return
  if (!restore()) return
  try {
    typeMultiline(text)
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
    typeMultiline(text)
  } catch (error) {
    console.warn('[ai] failed to insert text', error)
  }
}
