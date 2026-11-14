/**
 * OpenAI-compatible streaming client.
 *
 * Deliberately SDK-free: fetch + SSE parsing keeps the dependency surface small
 * and works with DeepSeek, OpenAI, OneAPI, Ollama and anything else speaking the
 * same protocol. Requests run in the main process so the API key never reaches
 * the sandboxed renderer.
 */

import type { AiConfig, AiRequest } from '@shared/types/ai'
import { buildMessages } from './prompt'

export interface StreamHandlers {
  onDelta: (delta: string) => void
  signal: AbortSignal
}

const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

const endpoint = (baseUrl: string): string => {
  const base = trimBase(baseUrl)
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

const parseSseLine = (line: string): string | null => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>
    }
    return json.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}

export const streamCompletion = async (
  config: AiConfig,
  request: AiRequest,
  handlers: StreamHandlers
): Promise<string> => {
  if (!config.baseUrl) throw new Error('AI base URL is empty')
  if (!config.model) throw new Error('AI model is empty')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const response = await fetch(endpoint(config.baseUrl), {
    method: 'POST',
    headers,
    signal: handlers.signal,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: buildMessages(request)
    })
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`AI request failed (${response.status}): ${body.slice(0, 300)}`)
  }
  if (!response.body) throw new Error('AI response has no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const delta = parseSseLine(line)
      if (!delta) continue
      text += delta
      handlers.onDelta(delta)
    }
  }

  // Some servers omit the trailing newline.
  const tail = parseSseLine(buffer)
  if (tail) {
    text += tail
    handlers.onDelta(tail)
  }

  return text
}
