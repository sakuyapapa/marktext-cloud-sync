/**
 * Feishu (Lark) Drive sync provider.
 *
 * Maps the workspace folder onto a Feishu Drive folder: files are uploaded with
 * `upload_all` (鈮?0 MB, which the engine's default size cap already enforces),
 * folders are created on demand, and listing walks the folder tree.
 *
 * Auth uses a tenant_access_token derived from the app credentials; the target
 * folder must be shared with the app so the token can see it.
 */

import crypto from 'crypto'
import type { RemoteFileInfo, SyncProvider } from './engine'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const PAGE_SIZE = 200

export interface FeishuOptions {
  appId: string
  appSecret: string
  /** Token of the Drive folder that mirrors the workspace. */
  folderToken: string
  /** open.feishu.cn (China) or open.larksuite.com. */
  baseUrl?: string
}

interface FeishuFile {
  token: string
  name: string
  type: 'file' | 'folder' | string
  parent_token?: string
  modified_time?: string
  size?: number
}

interface FeishuListResponse {
  code: number
  msg: string
  data?: {
    files?: FeishuFile[]
    has_more?: boolean
    next_page_token?: string
  }
}

interface TokenResponse {
  code: number
  msg: string
  tenant_access_token?: string
  expire?: number
}

const trimBase = (value: string): string => value.replace(/\/+$/, '')

export class FeishuClient {
  private readonly options: FeishuOptions
  private token: string | null = null
  private tokenExpiry = 0

  constructor(options: FeishuOptions) {
    this.options = options
  }

  private get base(): string {
    return trimBase(this.options.baseUrl || 'https://open.feishu.cn')
  }

  private async request(
    path: string,
    init: RequestInit & { auth?: boolean } = {}
  ): Promise<Response> {
    const { auth = true, ...rest } = init
    const headers = new Headers(rest.headers)
    if (auth) headers.set('Authorization', `Bearer ${await this.getToken()}`)
    return fetch(`${this.base}${path}`, { ...rest, headers })
  }

  async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.tokenExpiry) return this.token
    const response = await this.request('/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      auth: false,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret })
    })
    const json = (await response.json()) as TokenResponse
    if (!response.ok || json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`Feishu auth failed (${json.code ?? response.status}): ${json.msg ?? ''}`)
    }
    this.token = json.tenant_access_token
    // Refresh a minute before the server-side expiry.
    this.tokenExpiry = Date.now() + Math.max(60, (json.expire ?? 7200) - 60) * 1000
    return this.token
  }

  async listChildren(folderToken: string): Promise<FeishuFile[]> {
    const files: FeishuFile[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({ folder_token: folderToken, page_size: String(PAGE_SIZE) })
      if (pageToken) query.set('page_token', pageToken)
      const response = await this.request(`/open-apis/drive/v1/files?${query.toString()}`)
      const json = (await response.json()) as FeishuListResponse
      if (!response.ok || json.code !== 0) {
        throw new Error(`Feishu list failed (${json.code ?? response.status}): ${json.msg ?? ''}`)
      }
      files.push(...(json.data?.files ?? []))
      pageToken = json.data?.has_more ? json.data?.next_page_token : undefined
    } while (pageToken)
    return files
  }

  async createFolder(name: string, parentToken: string): Promise<string> {
    const response = await this.request('/open-apis/drive/v1/files/create_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name, folder_token: parentToken })
    })
    const json = (await response.json()) as { code: number; msg: string; data?: { token: string } }
    if (!response.ok || json.code !== 0 || !json.data?.token) {
      throw new Error(`Feishu create_folder failed (${json.code}): ${json.msg}`)
    }
    return json.data.token
  }

  async upload(name: string, parentToken: string, data: Buffer): Promise<string> {
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new Error(`File is larger than Feishu's 20 MB single-upload limit: ${name}`)
    }
    const form = new FormData()
    form.append('file_name', name)
    form.append('parent_type', 'explorer')
    form.append('parent_node', parentToken)
    form.append('size', String(data.length))
    form.append('checksum', crypto.createHash('md5').update(data).digest('hex'))
    form.append('file', new Blob([new Uint8Array(data)]), name)

    const response = await this.request('/open-apis/drive/v1/files/upload_all', {
      method: 'POST',
      body: form
    })
    const json = (await response.json()) as { code: number; msg: string; data?: { file_token: string } }
    if (!response.ok || json.code !== 0 || !json.data?.file_token) {
      throw new Error(`Feishu upload failed (${json.code}): ${json.msg}`)
    }
    return json.data.file_token
  }

  async download(fileToken: string): Promise<Buffer> {
    const response = await this.request(`/open-apis/drive/v1/files/${fileToken}/download`)
    if (!response.ok) {
      throw new Error(`Feishu download failed (${response.status})`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  async remove(fileToken: string): Promise<void> {
    const response = await this.request(
      `/open-apis/drive/v1/files/${fileToken}?type=file`,
      { method: 'DELETE' }
    )
    if (response.status === 404) return
    const json = (await response.json().catch(() => ({ code: 0, msg: '' }))) as {
      code: number
      msg: string
    }
    if (!response.ok || json.code !== 0) {
      throw new Error(`Feishu delete failed (${json.code}): ${json.msg}`)
    }
  }
}

interface DirIndex {
  /** Relative path ('' for root) 鈫?folder token. */
  dirs: Map<string, string>
  /** Relative file path 鈫?file token. */
  files: Map<string, string>
  /** Relative file path 鈫?metadata reported by the API. */
  info: Map<string, RemoteFileInfo>
}

const parseMtime = (value?: string): number => {
  if (!value) return 0
  const numeric = Number(value)
  // Feishu returns seconds for `modified_time`.
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const createFeishuProvider = (options: FeishuOptions): SyncProvider => {
  const client = new FeishuClient(options)
  let index: DirIndex = { dirs: new Map(), files: new Map(), info: new Map() }

  const walk = async (folderToken: string, prefix: string, into: DirIndex): Promise<void> => {
    const children = await client.listChildren(folderToken)
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name
      if (child.type === 'folder') {
        into.dirs.set(relative, child.token)
        await walk(child.token, relative, into)
      } else {
        into.files.set(relative, child.token)
        into.info.set(relative, {
          mtimeMs: parseMtime(child.modified_time),
          size: child.size ?? 0
        })
      }
    }
  }

  const ensureParent = async (relPath: string, into: DirIndex): Promise<string> => {
    const segments = relPath.split('/')
    segments.pop()
    let current = ''
    let parentToken = options.folderToken
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      const existing = into.dirs.get(current)
      if (existing) {
        parentToken = existing
        continue
      }
      const token = await client.createFolder(segment, parentToken)
      into.dirs.set(current, token)
      parentToken = token
    }
    return parentToken
  }

  return {
    describe: () => 'Feishu Drive',

    test: async () => {
      try {
        await client.getToken(true)
        const children = await client.listChildren(options.folderToken)
        return { ok: true, message: `Connected to Feishu folder (${children.length} entries)` }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },

    list: async () => {
      index = { dirs: new Map(), files: new Map(), info: new Map() }
      await walk(options.folderToken, '', index)
      return index.info
    },

    download: async (relPath) => {
      const token = index.files.get(relPath)
      if (!token) throw new Error(`Feishu file not indexed: ${relPath}`)
      return client.download(token)
    },

    upload: async (relPath, data) => {
      const name = relPath.split('/').pop() ?? relPath
      const parentToken = await ensureParent(relPath, index)
      const token = await client.upload(name, parentToken, data)
      index.files.set(relPath, token)
      const info: RemoteFileInfo = { mtimeMs: Date.now(), size: data.length }
      index.info.set(relPath, info)
      return info
    },

    remove: async (relPath) => {
      const token = index.files.get(relPath)
      if (!token) return
      await client.remove(token)
      index.files.delete(relPath)
      index.info.delete(relPath)
    }
  }
}


