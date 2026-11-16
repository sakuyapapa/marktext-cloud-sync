/**
 * Shared types for the AI assistant (OpenAI-compatible chat completions).
 */

export type AiAction = 'polish' | 'summarize' | 'continue' | 'translate' | 'chat'

export interface AiConfig {
  enabled: boolean
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface AiRequest {
  requestId: string
  action: AiAction
  /** Selected text (may span several paragraphs). */
  selection: string
  /** Text before/after the selection, used as context. */
  before?: string
  after?: string
  /** Free-form instruction for `chat`. */
  instruction?: string
  /** Target language for `translate`. */
  targetLang?: string
  /** Extra context attached to the conversation as chips. */
  contexts?: string[]
  /** Image data URLs attached to the conversation (vision models). */
  images?: string[]
}

export interface AiChunkEvent {
  requestId: string
  delta: string
}

export interface AiDoneEvent {
  requestId: string
  text: string
  error?: string
}
