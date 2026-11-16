/**
 * Insert plain text at the current caret, keeping line breaks.
 *
 * A plain (synthetic) Enter goes through Muya's `ScrollPage.insertAfter`, which
 * throws when the block's DOM node has just been replaced by the preceding
 * `insertText` call. Shift+Enter takes Muya's soft-break path instead: it only
 * mutates the current block, so it is safe right after an edit and preserves the
 * line structure inside one paragraph.
 */

const pressSoftBreak = (target: HTMLElement): void => {
  for (const type of ['keydown', 'keyup'] as const) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  }
}

export const insertPlainText = (text: string, editor?: HTMLElement | null): void => {
  if (!text) return
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line) document.execCommand('insertText', false, line)
    if (index === lines.length - 1) return
    const target = editor ?? (document.activeElement as HTMLElement | null)
    if (target) pressSoftBreak(target)
  })
}
