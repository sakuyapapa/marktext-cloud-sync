import { expect, test } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { SyncStatus } from '../../src/shared/types/sync'
import { launchElectron } from './helpers'

interface DavServer {
  url: string
  files: Map<string, Buffer>
  stop: () => Promise<void>
}

/** Same protocol surface as the unit-test server: PROPFIND/PUT/GET/DELETE/MKCOL. */
const startDavServer = async (): Promise<DavServer> => {
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
        if (dirs.has(target)) return void res.writeHead(405).end()
        dirs.add(target)
        return void res.writeHead(201).end()
      }
      if (req.method === 'PROPFIND') {
        const isDir = dirs.has(target)
        const data = files.get(target)
        if (!isDir && !data) return void res.writeHead(404).end()
        const entries: string[] = []
        const push = (entryPath: string, dir: boolean, payload?: Buffer): void => {
          entries.push(
            `<D:response><D:href>${encodeURI(entryPath)}</D:href><D:propstat><D:prop>` +
              (dir
                ? '<D:resourcetype><D:collection/></D:resourcetype>'
                : `<D:resourcetype/><D:getcontentlength>${payload?.length ?? 0}</D:getcontentlength>` +
                  `<D:getlastmodified>${new Date(1700000000000).toUTCString()}</D:getlastmodified>`) +
              '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
          )
        }
        push(target, isDir)
        if ((req.headers.depth ?? '1') !== '0') {
          const prefix = target.endsWith('/') ? target : `${target}/`
          for (const dir of dirs) {
            if (dir !== target && dir.startsWith(prefix)) push(dir, true)
          }
          for (const [filePath, data] of files) {
            if (filePath.startsWith(prefix)) push(filePath, false, data)
          }
        }
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        return void res.end(
          `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${entries.join('')}</D:multistatus>`
        )
      }
      if (req.method === 'PUT') {
        const segments = target.split('/').filter(Boolean)
        segments.pop()
        let dir = ''
        for (const segment of segments) {
          dir += `/${segment}`
          dirs.add(dir)
        }
        files.set(target, body)
        return void res.writeHead(201, { 'Last-Modified': new Date().toUTCString() }).end()
      }
      if (req.method === 'GET') {
        const data = files.get(target)
        if (!data) return void res.writeHead(404).end()
        return void res.end(data)
      }
      if (req.method === 'DELETE') {
        if (!files.delete(target)) return void res.writeHead(404).end()
        return void res.writeHead(204).end()
      }
      res.writeHead(405).end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/dav/`,
    files,
    stop: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

test('cloud sync mirrors a folder to WebDAV through the renderer bridge', async () => {
  const server = await startDavServer()
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sync-e2e-'))
  fs.writeFileSync(path.join(workspace, 'welcome.md'), '# hello sync', 'utf8')
  fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'notes', 'deep.md'), '# nested', 'utf8')

  const { app, page } = await launchElectron()
  try {
    const status = (await page.evaluate(
      async ([dir, url]) => {
        await window.cloudSync.setConfig({
          enabled: true,
          provider: 'webdav',
          workspaceDir: dir,
          intervalMinutes: 0,
          webdav: {
            url,
            username: 'user',
            password: 'pass',
            remoteDir: 'marktext',
            allowInsecure: false
          }
        })
        return window.cloudSync.run()
      },
      [workspace, server.url] as const
    )) as SyncStatus

    expect(status.phase).toBe('done')
    expect(status.lastResult?.uploaded).toBe(2)
    expect(status.lastResult?.errors).toEqual([])
    expect(server.files.has('/dav/marktext/welcome.md')).toBe(true)
    expect(server.files.get('/dav/marktext/notes/deep.md')?.toString()).toBe('# nested')

    // A remote edit is pulled on the next run.
    server.files.set('/dav/marktext/welcome.md', Buffer.from('# edited remotely'))
    const second = (await page.evaluate(() => window.cloudSync.run())) as SyncStatus
    expect(second.lastResult?.downloaded).toBe(1)
    expect(fs.readFileSync(path.join(workspace, 'welcome.md'), 'utf8')).toBe('# edited remotely')
  } finally {
    await app.close()
    await server.stop()
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('cloud sync panel renders in settings', async () => {
  const { app } = await launchElectron()
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.emit('mt::open-setting-window')
    })
    const settings = await app.waitForEvent('window')
    await settings.waitForLoadState('domcontentloaded')
    // The settings window listens for `settings::change-tab` to switch categories.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('preference')
      )
      win?.webContents.send('settings::change-tab', 'sync')
    })
    await settings.waitForTimeout(1500)
    await settings.screenshot({
      path: path.join(process.env.MT_ARTIFACT_DIR ?? os.tmpdir(), 'cloud-sync-panel.png')
    })
  } finally {
    await app.close()
  }
})
