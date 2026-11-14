/**
 * AI assistant state shared by the drawer component and the editor wiring.
 * Streaming chunks come from the main process over `mt::ai::chunk`.
 */

import { reactive } from 'vue'
import type { AiAction } from '@shared/types/ai'

export interface AiSegment {
  text: string
  accepted: boolean
}

export interface AiMessage {
  role: 'user' | 'assistant'
  text: string
}

export const assistant = reactive({
  open: false,
  tab: 'result' as 'result' | 'chat',
  action: 'polish' as AiAction,
  streaming: false,
  error: '',
  text: '',
  requestId: '',
  segments: [] as AiSegment[],
  messages: [] as AiMessage[]
})

let abortTimeout: ReturnType<typeof setTimeout> | null = null

export const splitSegments = (text: string): AiSegment[] =>
  text
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((text) => ({ text, accepted: true }))

export const acceptedText = (): string =>
  assistant.segments
    .filter((segment) => segment.accepted)
    .map((segment) => segment.text)
    .join('\n')

export const resetResult = (action: AiAction): void => {
  assistant.action = action
  assistant.error = ''
  assistant.text = ''
  assistant.requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  assistant.segments = []
  assistant.streaming = true
}

export const applyChunk = (text: string): void => {
  assistant.text += text
}

export const finishStream = (full: string, error?: string): void => {
  assistant.streaming = false
  assistant.error = error ?? ''
  const value = full || assistant.text
  if (value) {
    assistant.segments = splitSegments(value)
    if (assistant.tab === 'chat') {
      assistant.messages.push({ role: 'assistant', text: value })
    }
  }
  if (abortTimeout) {
    clearTimeout(abortTimeout)
    abortTimeout = null
  }
}

export const abort = (): void => {
  if (!assistant.requestId) return
  window.electron.ipcRenderer.send('mt::ai::abort', assistant.requestId)
  assistant.streaming = false
}

// The main process only reports completion, so a stalled request must not spin
// forever in the UI.
export const armWatchdog = (): void => {
  if (abortTimeout) clearTimeout(abortTimeout)
  abortTimeout = setTimeout(() => {
    if (assistant.streaming) assistant.streaming = false
  }, 180_000)
}
