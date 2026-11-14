import { ipcMain } from 'electron'
import type { AiChunkEvent, AiConfig, AiDoneEvent, AiRequest } from '@shared/types/ai'
import { aiConfigStore } from '../ai/store'
import { streamCompletion } from '../ai/client'
import log from 'electron-log'

const controllers = new Map<string, AbortController>()

export const registerAiHandlers = (): void => {
  ipcMain.handle('mt::ai::get-config', () => aiConfigStore.get())
  ipcMain.handle('mt::ai::set-config', (_event, partial: Partial<AiConfig>) => {
    const next = { ...partial }
    // An empty key from the form means "keep the stored one".
    if (next.apiKey === '') delete next.apiKey
    return aiConfigStore.set(next)
  })

  ipcMain.handle('mt::ai::test', async () => {
    const config = aiConfigStore.get()
    if (!config.baseUrl || !config.model) {
      return { ok: false, message: '请先填写 Base URL 和模型名' }
    }
    try {
      const text = await streamCompletion(
        { ...config, maxTokens: 16 },
        {
          requestId: 'test',
          action: 'chat',
          selection: 'ping',
          instruction: '只回复 pong 两个字符'
        },
        { onDelta: () => {}, signal: new AbortController().signal }
      )
      return { ok: true, message: `连接成功，模型回复：${text.trim().slice(0, 40) || '(空)'}` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.on('mt::ai::start', async (event, request: AiRequest) => {
    const config = aiConfigStore.get()
    const controller = new AbortController()
    controllers.set(request.requestId, controller)

    const sender = event.sender
    try {
      const text = await streamCompletion(config, request, {
        signal: controller.signal,
        onDelta: (delta) => {
          if (sender.isDestroyed()) return
          const payload: AiChunkEvent = { requestId: request.requestId, delta }
          sender.send('mt::ai::chunk', payload)
        }
      })
      if (!sender.isDestroyed()) {
        const payload: AiDoneEvent = { requestId: request.requestId, text }
        sender.send('mt::ai::done', payload)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[ai] request failed: ${message}`)
      if (!sender.isDestroyed()) {
        const payload: AiDoneEvent = { requestId: request.requestId, text: '', error: message }
        sender.send('mt::ai::done', payload)
      }
    } finally {
      controllers.delete(request.requestId)
    }
  })

  ipcMain.on('mt::ai::abort', (_event, requestId: string) => {
    controllers.get(requestId)?.abort()
  })
}
