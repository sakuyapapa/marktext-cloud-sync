/**
 * Reproduces the exact menu path: asks the main process (over the Node
 * inspector) to broadcast `mt::cm-insert-tag`, then checks the renderer card
 * over the Chromium CDP endpoint.
 */

import { chromium } from 'playwright'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const connectMainInspector = async (): Promise<{
  evaluate: (expression: string) => Promise<unknown>
  close: () => void
}> => {
  const list = (await (await fetch('http://127.0.0.1:9229/json/list')).json()) as Array<{
    webSocketDebuggerUrl: string
  }>
  const target = list[0]
  if (!target) throw new Error('no inspector target')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('inspector socket error')), { once: true })
  })

  let nextId = 1
  const evaluate = async (expression: string): Promise<unknown> => {
    const id = nextId++
    const reply = await new Promise<{ result?: { result?: { value?: unknown } }; error?: unknown }>(
      (resolve) => {
        const onMessage = (event: MessageEvent): void => {
          const payload = JSON.parse(String(event.data)) as { id?: number }
          if (payload.id !== id) return
          socket.removeEventListener('message', onMessage)
          resolve(payload as never)
        }
        socket.addEventListener('message', onMessage)
        socket.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, includeCommandLineAPI: true, awaitPromise: true }
          })
        )
      }
    )
    return reply.result?.result?.value
  }

  return { evaluate, close: () => socket.close() }
}

const main = async (): Promise<void> => {
  const inspector = await connectMainInspector()
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
  try {
    const context = browser.contexts()[0]
    const page = context.pages().find((candidate) => candidate.url().includes('index.html')) ?? context.pages()[0]
    if (!page) throw new Error('no renderer page')

    await page.waitForTimeout(800)
    const result = await inspector.evaluate(
      "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('mt::cm-insert-tag'); 'sent'"
    )
    console.log('main broadcast result:', result)
    await sleep(900)

    const visible = await page.isVisible('.mt-tag-card')
    console.log('card visible via menu path:', visible)
    await page.screenshot({ path: 'C:\\MarkText\\menu-path.png' })
  } finally {
    await browser.close()
    inspector.close()
  }
}

void main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
