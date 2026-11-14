/**
 * Minimal WebDAV client used by the folder sync engine.
 *
 * Hand-rolled on purpose: the app ships without a WebDAV dependency and only
 * needs PROPFIND/PUT/GET/DELETE/MKCOL/MOVE with Basic auth. Servers in the wild
 * disagree on namespace prefixes and href encoding, so the parser is
 * deliberately namespace-agnostic and the path helper normalises both sides.
 */

import http from 'http'
import https from 'https'
import type { IncomingMessage, ClientRequest } from 'http'
import type { RemoteFileInfo, SyncProvider } from './engine'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5

export interface WebdavOptions {
  url: string
  username: string
  password: string
  remoteDir: string
  allowInsecure?: boolean
}

interface WebdavResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:getetag/>
  </d:prop>
</d:propfind>`

const splitUrl = (raw: string): { secure: boolean; host: string; port: number; basePath: string } => {
  const parsed = new URL(raw)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported WebDAV protocol: ${parsed.protocol}`)
  }
  const secure = parsed.protocol === 'https:'
  const port = parsed.port ? Number(parsed.port) : secure ? 443 : 80
  // `url` may already point inside a collection; keep the path as the base.
  const basePath = parsed.pathname.replace(/\/+$/, '')
  return { secure, host: parsed.hostname, port, basePath }
}

/** Percent-encode every segment but keep the separators, so `a b/c.md` survives. */
const encodePath = (pathname: string): string =>
  pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

const decodeHref = (href: string): string => {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

const stripTags = (fragment: string): string => fragment.replace(/<[^>]*>/g, '').trim()

const parseHttpDate = (value: string): number => {
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

interface DavEntry {
  href: string
  isCollection: boolean
  size: number
  mtimeMs: number
}

export const parseDavMultistatus = (xml: string): DavEntry[] => {
  const entries: DavEntry[] = []
  const responseRe = /<(?:[A-Za-z0-9_.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?response>/gi
  let match: RegExpExecArray | null
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1] ?? ''
    const hrefMatch = block.match(/<(?:[A-Za-z0-9_.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?href>/i)
    if (!hrefMatch) continue
    const href = decodeHref(stripTags(hrefMatch[1] ?? ''))
    const isCollection = /<(?:[A-Za-z0-9_.-]+:)?collection\b/i.test(block)
    const sizeMatch = block.match(
      /<(?:[A-Za-z0-9_.-]+:)?getcontentlength\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?getcontentlength>/i
    )
    const mtimeMatch = block.match(
      /<(?:[A-Za-z0-9_.-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?getlastmodified>/i
    )
    const size = sizeMatch ? Number(stripTags(sizeMatch[1] ?? '')) : 0
    entries.push({
      href,
      isCollection,
      size: Number.isFinite(size) ? size : 0,
      mtimeMs: mtimeMatch ? parseHttpDate(stripTags(mtimeMatch[1] ?? '')) : 0
    })
  }
  return entries
}

export class WebdavClient {
  private readonly options: WebdavOptions
  private readonly base: ReturnType<typeof splitUrl>

  constructor(options: WebdavOptions) {
    this.options = options
    this.base = splitUrl(options.url)
  }

  private get authHeader(): string | undefined {
    const { username, password } = this.options
    if (!username && !password) return undefined
    return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
  }

  /** Absolute URL for a workspace-relative path (`''` is the mirrored root). */
  urlFor(relPath: string): string {
    const dir = this.options.remoteDir.replace(/^\/+|\/+$/g, '')
    const segments = [this.base.basePath.replace(/^\/+|\/+$/g, ''), dir].filter(
      (part) => part.length > 0
    )
    const basePath = `/${segments.join('/')}`
    const suffix = relPath ? `/${relPath}` : ''
    const pathname = encodePath(`${basePath}${suffix}`)
    const scheme = this.base.secure ? 'https' : 'http'
    const port = (this.base.secure && this.base.port === 443) || (!this.base.secure && this.base.port === 80)
      ? ''
      : `:${this.base.port}`
    return `${scheme}://${this.base.host}${port}${pathname}`
  }

  request(
    method: string,
    relPath: string,
    body?: Buffer | string,
    extraHeaders: Record<string, string> = {},
    redirects = 0
  ): Promise<WebdavResponse> {
    const target = this.urlFor(relPath)
    const parsed = new URL(target)
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
    const headers: Record<string, string> = {
      ...extraHeaders,
      ...(this.authHeader ? { Authorization: this.authHeader } : {})
    }
    if (payload) {
      headers['Content-Length'] = String(payload.length)
    }

    return new Promise<WebdavResponse>((resolve, reject) => {
      const transport = parsed.protocol === 'https:' ? https : http
      const reqOptions: https.RequestOptions = {
        method,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        ...(parsed.protocol === 'https:' && this.options.allowInsecure
          ? { rejectUnauthorized: false }
          : {})
      }
      const req: ClientRequest = transport.request(reqOptions, (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const response: WebdavResponse = {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          }
          const location = res.headers.location
          if (
            location &&
            [301, 302, 303, 307, 308].includes(response.status) &&
            redirects < MAX_REDIRECTS
          ) {
            // Same-host redirects only: replaying Basic auth elsewhere would
            // hand the password to whatever host the header names.
            const next = new URL(location, target)
            if (next.hostname !== parsed.hostname) {
              resolve(response)
              return
            }
            this.request(
              method === 'PROPFIND' || method === 'PUT' ? method : 'GET',
              relPath,
              payload,
              extraHeaders,
              redirects + 1
            ).then(resolve, reject)
            return
          }
          resolve(response)
        })
      })
      req.on('timeout', () => req.destroy(new Error(`WebDAV request timed out: ${method} ${target}`)))
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }

  private async ensureOk(response: WebdavResponse, action: string): Promise<void> {
    if (response.status >= 200 && response.status < 300) return
    if (response.status === 401 || response.status === 403) {
      throw new Error(`WebDAV ${action} rejected (${response.status}): check user name and password`)
    }
    throw new Error(`WebDAV ${action} failed with status ${response.status}`)
  }

  async mkcol(relPath: string): Promise<void> {
    const response = await this.request('MKCOL', relPath)
    // 405 means the collection already exists on every server we care about.
    if (response.status === 405) return
    await this.ensureOk(response, `MKCOL ${relPath || '/'}`)
  }

  /** Create every missing segment of `relDir`, including the mirrored root. */
  async ensureDir(relDir: string): Promise<void> {
    await this.mkcol('')
    const parts = relDir.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      await this.mkcol(current)
    }
  }

  async propfind(relPath: string, depth: 0 | 1): Promise<DavEntry[]> {
    const response = await this.request('PROPFIND', relPath, PROPFIND_BODY, {
      Depth: String(depth),
      'Content-Type': 'application/xml; charset=utf-8'
    })
    await this.ensureOk(response, `PROPFIND ${relPath || '/'}`)
    return parseDavMultistatus(response.body.toString('utf8'))
  }

  async listRecursive(): Promise<Map<string, RemoteFileInfo>> {
    const result = new Map<string, RemoteFileInfo>()
    const rootUrl = this.urlFor('')
    const rootPath = decodeHref(new URL(rootUrl).pathname)

    const walk = async (relDir: string): Promise<void> => {
      const entries = await this.propfind(relDir, 1)
      for (const entry of entries) {
        const entryPath = decodeHref(new URL(entry.href, rootUrl).pathname)
        let relative = entryPath.startsWith(rootPath) ? entryPath.slice(rootPath.length) : entryPath
        relative = relative.replace(/^\/+/, '').replace(/\/+$/, '')
        // The self entry of every PROPFIND must not be walked again.
        if (!relative || relative === relDir) continue
        if (entry.isCollection) {
          await walk(relative)
          continue
        }
        result.set(relative, { mtimeMs: entry.mtimeMs, size: entry.size })
      }
    }

    await walk('')
    return result
  }

  async get(relPath: string): Promise<Buffer> {
    const response = await this.request('GET', relPath)
    await this.ensureOk(response, `GET ${relPath}`)
    return response.body
  }

  async put(relPath: string, data: Buffer): Promise<RemoteFileInfo> {
    const response = await this.request('PUT', relPath, data, {
      'Content-Type': 'application/octet-stream'
    })
    await this.ensureOk(response, `PUT ${relPath}`)
    // Serve-provided mtimes are what the next PROPFIND will report, so reading
    // them back keeps the sync state from looking "changed" right after a push.
    try {
      const entries = await this.propfind(relPath, 0)
      const self = entries.find((entry) => !entry.isCollection)
      if (self && self.mtimeMs > 0) return { mtimeMs: self.mtimeMs, size: data.length }
    } catch {
      // A server that refuses PROPFIND on files still gets a usable timestamp.
    }
    const lastModified = response.headers['last-modified']
    return {
      mtimeMs: typeof lastModified === 'string' ? parseHttpDate(lastModified) : Date.now(),
      size: data.length
    }
  }

  async remove(relPath: string): Promise<void> {
    const response = await this.request('DELETE', relPath)
    if (response.status === 404) return
    await this.ensureOk(response, `DELETE ${relPath}`)
  }
}

/** Adapter that turns the client into a provider the engine can drive. */
export const createWebdavProvider = (options: WebdavOptions): SyncProvider => {
  const client = new WebdavClient(options)
  const readyDirs = new Set<string>()

  return {
    describe: () => `WebDAV ${options.url}`,
    test: async () => {
      try {
        await client.ensureDir('')
        const entries = await client.propfind('', 0)
        if (entries.length === 0) {
          return { ok: false, message: 'Connected, but the server returned no collection entry' }
        }
        return { ok: true, message: `Connected to ${options.url}` }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
    list: () => client.listRecursive(),
    download: (relPath) => client.get(relPath),
    upload: async (relPath, data) => {
      const segments = relPath.split('/')
      segments.pop()
      const parent = segments.join('/')
      if (!readyDirs.has(parent)) {
        await client.ensureDir(parent)
        readyDirs.add(parent)
      }
      return client.put(relPath, data)
    },
    remove: (relPath) => client.remove(relPath)
  }
}
