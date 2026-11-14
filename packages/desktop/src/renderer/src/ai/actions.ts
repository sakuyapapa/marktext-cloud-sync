/**
 * Glue between the editor, the drawer and the main-process AI proxy.
 */

import type { AiAction } from '@shared/types/ai'
import { assistant, armWatchdog, resetResult } from './assistant'
import { captureAiContext } from './context'

export const actionLabel = (action: AiAction): string => {
  switch (action) {
    case 'polish':
      return '润色'
    case 'summarize':
      return '总结'
    case 'continue':
      return '续写'
    case 'translate':
      return '翻译'
    default:
      return '对话'
  }
}

const start = (action: AiAction, instruction?: string): void => {
  const context = captureAiContext()
  if (action !== 'chat' && !context.selection.trim()) {
    assistant.open = true
    assistant.tab = 'result'
    assistant.segments = []
    assistant.text = ''
    assistant.error = '请先在文档里选中一段文字'
    return
  }

  resetResult(action)
  assistant.open = true
  assistant.tab = action === 'chat' ? 'chat' : 'result'
  assistant.error = ''
  armWatchdog()

  window.electron.ipcRenderer.send('mt::ai::start', {
    requestId: assistant.requestId,
    action,
    selection: context.selection,
    before: context.before,
    after: context.after,
    instruction,
    targetLang: '英文'
  })
}

export const runAction = (action: AiAction): void => {
  if (action === 'chat') {
    assistant.open = true
    assistant.tab = 'chat'
    return
  }
  start(action)
}

export const runChat = (instruction: string, withSelection: boolean): void => {
  if (!instruction.trim()) return
  assistant.messages.push({ role: 'user', text: instruction })
  assistant.text = ''

  if (!withSelection) {
    resetResult('chat')
    assistant.streaming = true
    armWatchdog()
    window.electron.ipcRenderer.send('mt::ai::start', {
      requestId: assistant.requestId,
      action: 'chat',
      selection: '',
      instruction
    })
    return
  }

  start('chat', instruction)
}
