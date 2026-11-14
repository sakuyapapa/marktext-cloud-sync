/**
 * Prompt construction for the AI actions. Kept in the main process so the
 * renderer never has to know how the context is assembled.
 */

import type { AiAction, AiRequest } from '@shared/types/ai'

const SYSTEM = [
  '你是一个嵌入在 Markdown 编辑器里的写作助手。',
  '只输出结果本身，不要解释、不要加引号、不要使用代码块包裹。',
  '保持原文的语言；如果是 Markdown，保留其结构（标题、列表、链接等）。'
].join('\n')

const contextBlock = (request: AiRequest): string => {
  const parts: string[] = []
  if (request.before?.trim()) parts.push(`【前文】\n${request.before.trim()}`)
  if (request.after?.trim()) parts.push(`【后文】\n${request.after.trim()}`)
  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
}

export const buildMessages = (
  request: AiRequest
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> => {
  const selection = request.selection ?? ''
  const context = contextBlock(request)

  const instruction = ((): string => {
    switch (request.action as AiAction) {
      case 'polish':
        return `润色下面这段文字：让表达更通顺、准确，保持作者语气和 Markdown 结构，长度不要明显变化。\n\n【原文】\n${selection}${context}`
      case 'summarize':
        return `把下面的内容总结成要点：用简洁的 Markdown 无序列表，每条一句话，不要遗漏关键结论。\n\n【内容】\n${selection}${context}`
      case 'continue':
        return `根据前文继续写下去，衔接自然，只输出新增的内容。\n\n【已有的内容】\n${selection}${context}`
      case 'translate':
        return `把下面的内容翻译成${request.targetLang || '英文'}，保留 Markdown 结构。\n\n【原文】\n${selection}${context}`
      case 'chat':
      default:
        return `${request.instruction || '请根据以下内容给出建议。'}\n\n【选中的内容】\n${selection}${context}`
    }
  })()

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: instruction }
  ]
}
