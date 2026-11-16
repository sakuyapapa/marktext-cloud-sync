/**
 * Fallback key handling for the fork commands.
 *
 * The keybinding UI lists `note.open` / `ai.add-context` and users can rebind
 * them, but `electron-localshortcut` maps physical keys through `native-keymap`,
 * which a build without the native toolchain cannot load. This listener matches
 * the *bound* accelerator against the raw key event so the shortcuts keep
 * working (and keep following rebinds) either way.
 */

import type { BrowserWindow, Input } from 'electron'
import type Accessor from '../app/accessor'

const FORK_COMMANDS = ['note.open', 'ai.add-context'] as const

interface ParsedAccelerator {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

const parse = (accelerator: string): ParsedAccelerator | null => {
  if (!accelerator) return null
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase())
  const parsed: ParsedAccelerator = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control' || part === 'commandorcontrol' || part === 'cmdorctrl') {
      if (part === 'cmdorctrl' || part === 'commandorcontrol') {
        if (process.platform === 'darwin') parsed.meta = true
        else parsed.ctrl = true
      } else {
        parsed.ctrl = true
      }
    } else if (part === 'alt' || part === 'option') {
      parsed.alt = true
    } else if (part === 'shift') {
      parsed.shift = true
    } else if (part === 'command' || part === 'cmd' || part === 'super' || part === 'meta') {
      parsed.meta = true
    } else {
      parsed.key = part
    }
  }
  return parsed.key ? parsed : null
}

const matches = (input: Input, parsed: ParsedAccelerator): boolean => {
  const key = (input.key || '').toLowerCase()
  const code = (input.code || '').toLowerCase()
  const wanted = parsed.key
  const keyMatches =
    key === wanted ||
    code === `key${wanted}` ||
    code === wanted ||
    (wanted.length === 1 && key === wanted.toUpperCase().toLowerCase())

  return (
    keyMatches &&
    input.control === parsed.ctrl &&
    input.alt === parsed.alt &&
    input.shift === parsed.shift &&
    input.meta === parsed.meta
  )
}

export const registerForkShortcutFallback = (win: BrowserWindow, accessor: Accessor): void => {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return

    for (const id of FORK_COMMANDS) {
      const accelerator = accessor.keybindings.getAccelerator(id)
      const parsed = accelerator ? parse(accelerator) : null
      if (!parsed || !matches(input, parsed)) continue
      event.preventDefault()
      try {
        accessor.commandManager.execute(id, win)
      } catch {
        // A missing command must not break typing.
      }
      return
    }
  })
}
