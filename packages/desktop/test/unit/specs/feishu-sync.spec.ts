import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFeishuProvider } from '../../../src/main/sync/feishu'

interface StoredFile {
  token: string
  name: string
  type: 'file' | 'folder'
  parent: string
  data?: Buffer
  modified_time?: string
}

const parseMultipart = (
  body: Buffer,
  contentType: string
): { fields: Record<string, string>; file?: { name: string; data: Buffer } } => {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1]
  if (!boundary) return { fields: {} }
  const delimiter = Buffer.from(`--${boundary}`)
  const fields: Record<string, string> = {}
  let file: { name: string; data: Buffer } | undefined

  let index = body.indexOf(delimiter)
  while (index !== -1) {
    const next = body.indexOf(delimiter, index + delimiter.length)
    if (next === -1) break
    const part = body.subarray(index + delimiter.length, next)
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd !== -1) {
      const header = part.subarray(0, headerEnd).toString('utf8')
      const content = part.subarray(headerEnd + 4, part.length - 2)
      const name = /name="([^"]+)"/.exec(header)?.[1]
      const filename = /filename="([^"]*)"/.exec(header)?.[1]
      if (name && filename) {
        file = { name: filename, data: Buffer.from(content) }
      } else if (name) {
        fields[name] = content.toString('utf8')
      }
    }
    index = next
  }
  return { fields, file }
}

const startFeishu = async (): Promise<{ url: string; files: Map<string, StoredFile>; close: () => Promise<void> }> => {
  const files = new Map<string, StoredFile>()
  const root = 'root-folder'
  files.set(root, { token: root, name: '', type: 'folder', parent: '' })
  let seq = 0
  const newToken = (prefix: string): string => `${prefix}-${++seq}`

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const json = (payload: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
      }

      if (url.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
        json({ code: 0, msg: 'ok', tenant_access_token: 'test-token', expire: 7200 })
        return
      }

      if (url.pathname === '/open-apis/drive/v1/files' && req.method === 'GET') {
        const parent = url.searchParams.get('folder_token') ?? ''
        const children = [...files.values()].filter((file) => file.parent === parent)
        json({
          code: 0,
          msg: 'ok',
          data: {
            files: children.map((file) => ({
              token: file.token,
              name: file.name,
              type: file.type,
              parent_token: file.parent,
              modified_time: file.modified_time ?? '1700000000',
              size: file.data?.length ?? 0
            })),
            has_more: false
          }
        })
        return
      }

      if (url.pathname === '/open-apis/drive/v1/files/create_folder') {
        const payload = JSON.parse(body.toString('utf8')) as { name: string; folder_token: string }
        const token = newToken('folder')
        files.set(token, { token, name: payload.name, type: 'folder', parent: payload.folder_token })
        json({ code: 0, msg: 'ok', data: { token } })
        return
      }

      if (url.pathname === '/open-apis/drive/v1/files/upload_all') {
        const { fields, file } = parseMultipart(body, req.headers['content-type'] ?? '')
        if (!file) {
          json({ code: 1, msg: 'no file' })
          return
        }
        const token = newToken('file')
        files.set(token, {
          token,
          name: fields.file_name ?? file.name,
          type: 'file',
          parent: fields.parent_node ?? '',
          data: file.data,
          modified_time: String(Math.floor(Date.now() / 1000))
        })
        json({ code: 0, msg: 'ok', data: { file_token: token } })
        return
      }

      const download = /^\/open-apis\/drive\/v1\/files\/([^/]+)\/download$/.exec(url.pathname)
      if (download) {
        const entry = files.get(download[1] ?? '')
        if (!entry?.data) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200).end(entry.data)
        return
      }

      const remove = /^\/open-apis\/drive\/v1\/files\/([^/]+)$/.exec(url.pathname)
      if (remove && req.method === 'DELETE') {
        files.delete(remove[1] ?? '')
        json({ code: 0, msg: 'ok' })
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 404, msg: 'not found' }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    files,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

describe('feishu provider', () => {
  let server: Awaited<ReturnType<typeof startFeishu>>

  beforeEach(async () => {
    server = await startFeishu()
  })

  afterEach(async () => {
    await server.close()
  })

  const provider = (url: string) =>
    createFeishuProvider({
      appId: 'app',
      appSecret: 'secret',
      folderToken: 'root-folder',
      baseUrl: url
    })

  it('connects and lists the folder tree', async () => {
    const remote = provider(server.url)
    const result = await remote.test()
    expect(result.ok).toBe(true)

    server.files.set('sub', { token: 'sub', name: 'notes', type: 'folder', parent: 'root-folder' })
    server.files.set('f1', {
      token: 'f1',
      name: 'a.md',
      type: 'file',
      parent: 'sub',
      data: Buffer.from('# a'),
      modified_time: '1700000000'
    })

    const listed = await remote.list()
    expect(listed.has('notes/a.md')).toBe(true)
    expect(listed.get('notes/a.md')?.size).toBe(3)
  })

  it('creates folders on upload and can download the file back', async () => {
    const remote = provider(server.url)
    await remote.list()

    const data = Buffer.from('# hello feishu')
    await remote.upload('docs/deep/b.md', data)

    const folders = [...server.files.values()].filter((entry) => entry.type === 'folder').map((entry) => entry.name)
    expect(folders).toContain('docs')
    expect(folders).toContain('deep')

    const listed = await remote.list()
    expect(listed.has('docs/deep/b.md')).toBe(true)

    const downloaded = await remote.download('docs/deep/b.md')
    expect(downloaded.toString()).toBe('# hello feishu')
  })

  it('removes files by token', async () => {
    const remote = provider(server.url)
    await remote.list()
    await remote.upload('gone.md', Buffer.from('bye'))

    expect((await remote.list()).has('gone.md')).toBe(true)
    await remote.remove('gone.md')
    expect((await remote.list()).has('gone.md')).toBe(false)
  })
})
