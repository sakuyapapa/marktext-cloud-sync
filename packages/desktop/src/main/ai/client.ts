/**
 * OpenAI-compatible streaming client.
 *
 * Deliberately SDK-free: fetch + SSE parsing keeps the dependency surface small
 * and works with DeepSeek, OpenAI, OneAPI, Ollama and anything else speaking the
 * same protocol. Requests run in the main process so the API key never reaches
 * the sandboxed renderer.
 *
 * The loop also drives function calling: when the model asks for a tool the
 * call is executed locally (see `tools.ts`) and its result is fed back as a
 * `tool` message, up to a small number of rounds.
 */

import type { AiConfig, AiRequest } from '@shared/types/ai'
import { buildMessages, type ChatMessage } from './prompt'
import { AI_TOOL_DEFINITIONS, executeAiTool } from './tools'

export interface StreamHandlers {
  onDelta: (delta: string) => void
  signal: AbortSignal
}

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Chat message plus the tool-call extensions used on the wire. */
type WireMessage =
  | ChatMessage
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: WireToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

const MAX_TOOL_ROUNDS = 3

const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

const endpoint = (baseUrl: string): string => {
  const base = trimBase(baseUrl)
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

interface SseDelta {
  content?: string
  toolCalls?: Array<{
    index: number
    id?: string
    name?: string
    argumentsDelta?: string
  }>
}

const parseSseLine = (line: string): SseDelta | null => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{
        delta?: {
          content?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    const delta = json.choices?.[0]?.delta
    if (!delta) return null
    const toolCalls = delta.tool_calls?.map((call, index) => ({
      index: call.index ?? index,
      id: call.id,
      name: call.function?.name,
      argumentsDelta: call.function?.arguments
    }))
    if (!delta.content && !toolCalls?.length) return null
    return { content: delta.content, toolCalls }
  } catch {
    return null
  }
}

const streamOnce = async (
  config: AiConfig,
  messages: WireMessage[],
  handlers: StreamHandlers,
  useTools: boolean
): Promise<{ text: string; toolCalls: WireToolCall[] }> => {
  if (!config.baseUrl) throw new Error('AI base URL is empty')
  if (!config.model) throw new Error('AI model is empty')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const body: Record<string, unknown> = {
    model: config.model,
    stream: true,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages
  }
  if (useTools) {
    body.tools = AI_TOOL_DEFINITIONS
    body.tool_choice = 'auto'
  }

  const response = await fetch(endpoint(config.baseUrl), {
    method: 'POST',
    headers,
    signal: handlers.signal,
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`AI request failed (${response.status}): ${text.slice(0, 300)}`)
  }
  if (!response.body) throw new Error('AI response has no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const partial = new Map<number, { id: string; name: string; arguments: string }>()

  const applyDelta = (delta: SseDelta | null): void => {
    if (!delta) return
    if (delta.content) {
      text += delta.content
      handlers.onDelta(delta.content)
    }
    for (const call of delta.toolCalls ?? []) {
      const current = partial.get(call.index) ?? { id: '', name: '', arguments: '' }
      if (call.id) current.id = call.id
      if (call.name) current.name = call.name
      if (call.argumentsDelta) current.arguments += call.argumentsDelta
      partial.set(call.index, current)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) applyDelta(parseSseLine(line))
  }
  // Some servers omit the trailing newline.
  applyDelta(parseSseLine(buffer))

  const toolCalls: WireToolCall[] = [...partial.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id || `call-${index}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' }
    }))
    .filter((call) => !!call.function.name)

  return { text, toolCalls }
}

export const streamCompletion = async (
  config: AiConfig,
  request: AiRequest,
  handlers: StreamHandlers
): Promise<string> => {
  let messages = buildMessages(request) as WireMessage[]
  // Only the chat surface may act on the workspace; polish/summarize stay pure.
  let useTools = request.action === 'chat'
  let text = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = await streamOnce(config, messages, handlers, useTools)
    text = result.text || text
    if (result.toolCalls.length === 0) {
      return result.text || text
    }

    const calls = result.toolCalls
    messages = [
      ...messages,
      {
        role: 'assistant',
        content: result.text || null,
        tool_calls: calls
      }
    ]

    for (const call of calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
      } catch {
        args = {}
      }
      let outcome: string
      try {
        outcome = await executeAiTool(call.function.name, args)
      } catch (error) {
        outcome = `工具执行失败：${error instanceof Error ? error.message : String(error)}`
      }
      handlers.onDelta(outcome ? `\n\n${outcome}\n\n` : '')
      messages = [
        ...messages,
        { role: 'tool', tool_call_id: call.id, content: outcome || 'ok' }
      ]
    }

    // A second round without tools keeps the final answer focused on the result
    // even if the server does not support parallel calls.
    useTools = false
  }

  return text
}
