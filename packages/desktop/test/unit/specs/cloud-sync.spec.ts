import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { MemoryProvider, SyncEngine } from '../../../src/main/sync/engine'
import { parseDavMultistatus, WebdavClient, createWebdavProvider } from '../../../src/main/sync/webdav'

interface Workspace {
  dir: string
  state: string
  trash: string
}

const makeWorkspace = (): Workspace => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-sync-'))
  const dir = path.join(root, 'docs')
  fs.mkdirSync(dir, { recursive: true })
  return {
    dir,
    state: path.join(root, 'state.json'),
    trash: path.join(root, 'trash')
  }
}

const write = (workspace: Workspace, relPath: string, content: string): void => {
  const target = path.join(workspace.dir, relPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

const read = (workspace: Workspace, relPath: string): string =>
  fs.readFileSync(path.join(workspace.dir, relPath), 'utf8')

const engineFor = (
  workspace: Workspace,
  provider: MemoryProvider,
  conflictPolicy: 'keep-both' | 'local-wins' | 'remote-wins' = 'keep-both'
): SyncEngine =>
  new SyncEngine({
    workspaceDir: workspace.dir,
    statePath: workspace.state,
    trashDir: workspace.trash,
    provider,
    conflictPolicy
  })

describe('sync engine', () => {
  let workspace: Workspace

  beforeEach(() => {
    workspace = makeWorkspace()
  })

  afterEach(() => {
    fs.rmSync(path.dirname(workspace.dir), { recursive: true, force: true })
  })

  it('uploads new local files and remembers them', async () => {
    const provider = new MemoryProvider()
    write(workspace, 'a.md', '# A')
    write(workspace, 'nested/b.md', '# B')

    const result = await engineFor(workspace, provider).run()

    expect(result.uploaded).toBe(2)
    expect(result.errors).toEqual([])
    expect(provider.files.get('a.md')?.data.toString()).toBe('# A')
    expect(provider.files.get('nested/b.md')?.data.toString()).toBe('# B')
  })

  it('downloads files that only exist on the remote', async () => {
    const provider = new MemoryProvider()
    await provider.upload('remote.md', Buffer.from('# remote'))

    const result = await engineFor(workspace, provider).run()

    expect(result.downloaded).toBe(1)
    expect(read(workspace, 'remote.md')).toBe('# remote')
  })

  it('pushes a local edit when the remote copy did not change', async () => {
    const provider = new MemoryProvider()
    write(workspace, 'a.md', 'v1')
    const engine = engineFor(workspace, provider)
    await engine.run()

    write(workspace, 'a.md', 'v2 edited')
    // Make the edit unambiguous on filesystems with coarse mtimes.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const result = await engine.run()

    expect(result.uploaded).toBe(1)
    expect(provider.files.get('a.md')?.data.toString()).toBe('v2 edited')
  })

  it('pulls a remote edit without creating a conflict copy', async () => {
    const provider = new MemoryProvider()
    write(workspace, 'a.md', 'v1')
    const engine = engineFor(workspace, provider)
    await engine.run()

    await provider.upload('a.md', Buffer.from('v2 remote'))
    const result = await engine.run()

    expect(result.downloaded).toBe(1)
    expect(result.conflicts).toEqual([])
    expect(read(workspace, 'a.md')).toBe('v2 remote')
  })

  it('keeps both copies when both sides edited the same file', async () => {
    const provider = new MemoryProvider()
    write(workspace, 'note.md', 'base')
    const engine = engineFor(workspace, provider)
    await engine.run()

    write(workspace, 'note.md', 'local edit')
    await provider.upload('note.md', Buffer.from('remote edit'))

    const result = await engine.run()

    expect(result.conflicts).toHaveLength(1)
    const conflict = result.conflicts[0]!
    expect(read(workspace, conflict.path)).toBe('remote edit')
    expect(read(workspace, conflict.backupPath)).toBe('local edit')
  })

  it('propagates a remote delete by moving the local file to the trash', async () => {
    const provider = new MemoryProvider()
    write(workspace, 'gone.md', 'bye')
    const engine = engineFor(workspace, provider)
    await engine.run()

    await provider.remove('gone.md')
    const result = await engine.run()

    expect(result.deleted).toBe(1)
    expect(fs.existsSync(path.join(workspace.dir, 'gone.md'))).toBe(false)
    const trashed = fs.readdirSync(workspace.trash, { recursive: true }) as string[]
    expect(trashed.some((entry) => String(entry).includes('gone.md'))).toBe(true)
  })

  it('resurrects a file edited locally after a remote delete', async () => {
    const provider = new MemoryProvider()
    write(workspace, 'keep.md', 'v1')
    const engine = engineFor(workspace, provider)
    await engine.run()

    write(workspace, 'keep.md', 'v2 local')
    await provider.remove('keep.md')
    await engine.run()

    expect(provider.files.get('keep.md')?.data.toString()).toBe('v2 local')
    expect(read(workspace, 'keep.md')).toBe('v2 local')
  })

  it('skips ignored paths', async () => {
    const provider = new MemoryProvider()
    write(workspace, '.git/config', 'x')
    write(workspace, 'node_modules/pkg/index.js', 'x')
    write(workspace, 'draft.tmp', 'x')
    write(workspace, 'real.md', '# real')

    const result = await engineFor(workspace, provider).run()

    expect(result.uploaded).toBe(1)
    expect([...provider.files.keys()]).toEqual(['real.md'])
  })
})

/** Tiny in-process WebDAV server: just enough verbs for the client under test. */
const startDavServer = (): Promise<{ url: string; files: Map<string, Buffer>; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const files = new Map<string, Buffer>()
    const dirs = new Set<string>(['/'])

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const target = decodeURIComponent(url.pathname)
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        if (req.method === 'MKCOL') {
          if (dirs.has(target)) {
            res.writeHead(405).end()
            return
          }
          dirs.add(target)
          res.writeHead(201).end()
          return
        }
        if (req.method === 'PROPFIND') {
          const depth = req.headers.depth ?? '1'
          const entries: string[] = []
          const addEntry = (entryPath: string, isDir: boolean, data?: Buffer): void => {
            entries.push(
              `<D:response><D:href>${encodeURI(entryPath)}</D:href><D:propstat><D:prop>` +
                (isDir
                  ? '<D:resourcetype><D:collection/></D:resourcetype>'
                  : `<D:resourcetype/><D:getcontentlength>${data?.length ?? 0}</D:getcontentlength><D:getlastmodified>${new Date(1700000000000).toUTCString()}</D:getlastmodified>`) +
                '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
            )
          }
          if (!dirs.has(target) && !files.has(target)) {
            res.writeHead(404).end()
            return
          }
          addEntry(target, dirs.has(target) || target.endsWith('/'))
          if (depth !== '0') {
            const prefix = target.endsWith('/') ? target : `${target}/`
            for (const dir of dirs) {
              if (dir !== target && dir.startsWith(prefix)) addEntry(dir, true)
            }
            for (const [filePath, data] of files) {
              if (filePath.startsWith(prefix)) addEntry(filePath, false, data)
            }
          }
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
          res.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${entries.join('')}</D:multistatus>`)
          return
        }
        if (req.method === 'PUT') {
          // Auto-create collections so the client does not need an MKCOL per file.
          const segments = target.split('/').filter(Boolean)
          segments.pop()
          let dir = ''
          for (const segment of segments) {
            dir += `/${segment}`
            dirs.add(dir)
          }
          files.set(target, body)
          res.writeHead(201, { 'Last-Modified': new Date().toUTCString() }).end()
          return
        }
        if (req.method === 'GET') {
          const data = files.get(target)
          if (!data) {
            res.writeHead(404).end()
            return
          }
          res.writeHead(200, { 'Content-Length': String(data.length) }).end(data)
          return
        }
        if (req.method === 'DELETE') {
          if (!files.delete(target)) {
            res.writeHead(404).end()
            return
          }
          res.writeHead(204).end()
          return
        }
        res.writeHead(405).end()
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}/dav/`,
        files,
        close: () =>
          new Promise<void>((done) => {
            // Keep-alive sockets would otherwise hold `close` open for the
            // agent's 5s idle timeout and trip the test timeout.
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })

describe('webdav client', () => {
  it('parses namespace-agnostic multistatus responses', () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/docs/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/docs/a%20b.md</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength>
      <d:getlastmodified>Tue, 14 Nov 2023 22:13:20 GMT</d:getlastmodified></d:prop></d:propstat>
  </d:response>
</d:multistatus>`

    const entries = parseDavMultistatus(xml)

    expect(entries).toHaveLength(2)
    expect(entries[0]?.isCollection).toBe(true)
    expect(entries[1]?.href).toBe('/dav/docs/a b.md')
    expect(entries[1]?.size).toBe(12)
    expect(entries[1]?.mtimeMs).toBe(Date.parse('Tue, 14 Nov 2023 22:13:20 GMT'))
  })

  it('joins base url, remote dir and file name safely', () => {
    const client = new WebdavClient({
      url: 'https://dav.example.com/dav',
      username: '',
      password: '',
      remoteDir: 'marktext/docs'
    })

    expect(client.urlFor('')).toBe('https://dav.example.com/dav/marktext/docs')
    expect(client.urlFor('a b/中文.md')).toBe(
      'https://dav.example.com/dav/marktext/docs/a%20b/%E4%B8%AD%E6%96%87.md'
    )
  })

  it('round-trips files against a real WebDAV server', async () => {
    const server = await startDavServer()
    try {
      const provider = createWebdavProvider({
        url: server.url,
        username: 'user',
        password: 'pass',
        remoteDir: 'marktext'
      })

      const testResult = await provider.test()
      expect(testResult.ok).toBe(true)

      await provider.upload('notes/hello.md', Buffer.from('# hello'))
      const listed = await provider.list()
      expect(listed.has('notes/hello.md')).toBe(true)

      const content = await provider.download('notes/hello.md')
      expect(content.toString()).toBe('# hello')

      await provider.remove('notes/hello.md')
      expect((await provider.list()).has('notes/hello.md')).toBe(false)
    } finally {
      await server.close()
    }
  })
})
