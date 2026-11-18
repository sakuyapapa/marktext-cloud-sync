/**
 * Feishu / Lark document import through the official `lark-cli`.
 *
 * The CLI owns the OAuth/app credentials, so MarkText never stores a Lark
 * secret: it shells out, asks for Markdown and writes the result into the sync
 * workspace. Bot identity is tried first (works for documents shared with the
 * app), then the signed-in user identity.
 */

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import log from 'electron-log'

const TIMEOUT_MS = 60_000

const bundledCandidates = (): string[] => {
  const roots = [process.resourcesPath, app.getAppPath(), path.dirname(app.getPath('exe'))]
  return roots.map((root) => path.join(root, 'tools', 'lark-cli', 'lark-cli.exe'))
}

export const resolveLarkCli = (): string | null => {
  const configured = process.env.LARK_CLI_PATH?.trim()
  if (configured && fs.existsSync(configured)) return configured
  for (const candidate of bundledCandidates()) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

interface LarkEnvelope {
  ok?: boolean
  data?: {
    document?: {
      content?: string
      document_id?: string
    }
  }
  error?: { message?: string; type?: string; subtype?: string }
}

interface CliOutcome {
  envelope: LarkEnvelope | null
  stderr: string
}

const runCli = (cli: string, args: string[]): Promise<CliOutcome> =>
  new Promise((resolve) => {
    execFile(
      cli,
      args,
      {
        timeout: TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env }
      },
      (_error, stdout, stderr) => {
        const text = (stdout ?? '').trim()
        let envelope: LarkEnvelope | null = null
        if (text) {
          try {
            envelope = JSON.parse(text) as LarkEnvelope
          } catch {
            // Some failures print a plain message instead of JSON.
            envelope = { ok: false, error: { message: text.slice(0, 300) } }
          }
        }
        resolve({ envelope, stderr: (stderr ?? '').trim() })
      }
    )
  })

const TITLE_TAG = /^<title>([\s\S]*?)<\/title>\s*/

/** Turn the DocxXML leftovers the CLI leaves behind into readable Markdown. */
export const normaliseLarkMarkdown = (raw: string): { title: string; markdown: string } => {
  let content = raw.replace(/\r\n/g, '\n')
  let title = ''
  const titleMatch = TITLE_TAG.exec(content)
  if (titleMatch) {
    title = titleMatch[1].trim()
    content = content.slice(titleMatch[0].length)
  }
  content = content.replace(
    /<cite\s+doc-id="([^"]+)"[^>]*?title="([^"]*)"[^>]*><\/cite>/g,
    (_match, id: string, cited: string) => `[${cited || id}](https://feishu.cn/docx/${id})`
  )
  content = content.replace(
    /<whiteboard\s+token="([^"]+)"[^>]*><\/whiteboard>/g,
    (_match, token: string) => `[白板](https://feishu.cn/board/${token})`
  )
  content = content.replace(/<\/?(?:title|cite|whiteboard)[^>]*>/g, '')
  content = content.replace(/\n{4,}/g, '\n\n\n').trim()
  return { title, markdown: content }
}

const safeFileName = (title: string, fallbackId: string): string => {
  const base = (title || `lark-${fallbackId}`).replace(/[\\/:*?"<>|]/g, '_').trim()
  const trimmed = base.length > 80 ? base.slice(0, 80) : base
  return `${trimmed || `lark-${fallbackId}`}.md`
}

export interface LarkImportResult {
  ok: boolean
  message: string
  filePath?: string
  title?: string
  markdown?: string
}

export const fetchLarkDocument = async (
  url: string,
  workspaceDir: string
): Promise<LarkImportResult> => {
  const cli = resolveLarkCli()
  if (!cli) {
    return { ok: false, message: '未找到 lark-cli：请安装 @larksuite/cli 或设置 LARK_CLI_PATH。' }
  }
  if (!workspaceDir || !fs.existsSync(workspaceDir)) {
    return { ok: false, message: '云同步工作区未配置，无法保存导入的文档。' }
  }

  let lastError = ''
  for (const identity of ['bot', 'user'] as const) {
    const { envelope, stderr } = await runCli(cli, [
      'docs',
      '+fetch',
      '--doc',
      url,
      '--doc-format',
      'markdown',
      '--as',
      identity
    ])
    if (envelope?.ok && envelope.data?.document?.content) {
      const { title, markdown } = normaliseLarkMarkdown(envelope.data.document.content)
      const name = safeFileName(title, envelope.data.document.document_id ?? Date.now().toString())
      const filePath = path.join(workspaceDir, name)
      fs.writeFileSync(filePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8')
      log.info(`[lark] imported ${url} as ${identity} -> ${filePath}`)
      return {
        ok: true,
        message: `已导入《${title || name}》到工作区：${name}`,
        filePath,
        title: title || name,
        markdown
      }
    }
    lastError = envelope?.error?.message || stderr || '未知错误'
  }

  return { ok: false, message: `导入失败：${lastError}` }
}
