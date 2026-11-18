import type { SyncStatus } from '@shared/types/sync'
import { cloudSyncService } from '../sync/service'
import { fetchLarkDocument } from '../lark/client'

/**
 * Tools the assistant may call. Kept in the main process so the model never
 * touches the network or the filesystem directly: it only asks for a named
 * action, which runs with the user's configured sync credentials.
 */
export const AI_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'import_lark_document',
      description:
        'Import a Feishu / Lark document (including wiki links like https://<tenant>.feishu.cn/wiki/<token>) as Markdown into the local sync workspace. ' +
        'Use it whenever the user gives a Feishu or Lark document URL and asks to bring it in, read it or sync it locally. ' +
        'It never modifies the remote document.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full Feishu/Lark document or wiki URL to import.'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'pull_cloud_documents',
      description:
        'Download documents from the cloud sync connection configured in MarkText into the local sync workspace. ' +
        'Use it when the user asks to fetch, pull, refresh or open documents from Feishu Drive, Git or WebDAV. ' +
        'Pass `paths` to download specific files/folders, or omit it to pull the whole workspace. ' +
        'It only downloads: local edits are never uploaded, and a locally modified target is saved as a .conflict backup.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Relative paths inside the sync workspace. A plain file name selects one file, a path ending with "/" selects a folder and "*" works as a wildcard (e.g. notes/*.md). Omit or use [] for the whole workspace.'
          },
          reason: {
            type: 'string',
            description: 'Short explanation of why the documents are being pulled, shown in the result.'
          }
        },
        required: []
      }
    }
  }
]

const describeStatus = (status: SyncStatus, paths: string[]): string => {
  if (status.phase === 'error') {
    return `拉取失败：${status.message || '未知错误'}`
  }
  if (status.phase === 'disabled') {
    return '云同步尚未配置：请先在 偏好设置 → 云同步 里选择服务类型和工作区文件夹。'
  }
  const result = status.lastResult
  if (!result) {
    return '拉取完成，但云端没有返回任何文件。'
  }
  if (result.downloaded === 0 && result.errors.length > 0) {
    return `没有找到匹配的文件：${result.errors.slice(0, 3).join('；')}`
  }

  const target = paths.length ? `指定的 ${paths.length} 个路径` : '整个工作区'
  const parts = [`已从${target}下载 ${result.downloaded} 个文件`]
  if (result.deleted) parts.push(`同步删除 ${result.deleted} 个`)
  if (result.conflicts.length) {
    parts.push(`本地改动已另存 ${result.conflicts.length} 个冲突副本`)
  }
  if (result.errors.length) {
    parts.push(`提示：${result.errors.slice(0, 2).join('；')}`)
  }
  parts.push('本地改动未上传')
  return `拉取完成：${parts.join('，')}。`
}

export const executeAiTool = async (
  name: string,
  args: Record<string, unknown> = {}
): Promise<string> => {
  if (name === 'import_lark_document') {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!url) return '缺少 url 参数：请提供飞书 / Lark 文档链接。'
    const config = cloudSyncService.getConfig()
    if (!config.workspaceDir) {
      return '云同步尚未配置工作区文件夹：请先在 偏好设置 → 云同步 里选择要镜像的文件夹。'
    }
    const result = await fetchLarkDocument(url, config.workspaceDir)
    return result.message
  }

  if (name !== 'pull_cloud_documents') {
    return `未知工具：${name}`
  }
  const config = cloudSyncService.getConfig()
  if (!config.workspaceDir) {
    return '云同步尚未配置工作区文件夹：请先在 偏好设置 → 云同步 里选择要镜像的文件夹。'
  }
  const paths = Array.isArray(args.paths)
    ? (args.paths as unknown[]).filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
    : []
  // Force: pulling is useful even when background sync is switched off.
  const status = await cloudSyncService.pullNow('ai-tool', paths)
  return describeStatus(status, paths)
}
