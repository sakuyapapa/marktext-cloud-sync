/**
 * Insert plain text at the current caret, preserving line breaks as paragraphs.
 *
 * Muya turns a real Enter keydown into a new paragraph, while
 * `execCommand('insertText', '\n')` drops the newlines — so multi-line text is
 * typed line by line with a synthetic Enter between lines.
 */

const pressEnter = (target: HTMLElement): void => {
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
}

export const insertPlainText = (text: string, editor?: HTMLElement | null): void => {
  if (!text) return
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line) document.execCommand('insertText', false, line)
    if (index === lines.length - 1) return
    const target = editor ?? (document.activeElement as HTMLElement | null)
    if (target) pressEnter(target)
  })
}
