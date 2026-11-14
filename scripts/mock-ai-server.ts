/**
 * Mock OpenAI-compatible streaming endpoint for local verification.
 * Streams three Markdown lines so the drawer can be checked end to end.
 */

import http from 'node:http'

const LINES = ['润色后的第一段：表达更通顺。', '润色后的第二段：保留了原有结构。', '润色后的第三段：语气不变。']

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.includes('chat/completions')) {
    res.writeHead(404).end()
    return
  }
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    let index = 0
    const payload = LINES.join('\n')
    const timer = setInterval(() => {
      if (index >= payload.length) {
        res.write('data: [DONE]\n\n')
        clearInterval(timer)
        res.end()
        return
      }
      const delta = payload.slice(index, index + 6)
      index += 6
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
    }, 40)
  })
})

server.listen(8787, '127.0.0.1', () => {
  console.log('mock AI server on http://127.0.0.1:8787/v1')
})
