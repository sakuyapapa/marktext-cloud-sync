import type { SyncStatus } from '@shared/types/sync'
import { cloudSyncService } from '../sync/service'

/**
 * Tools the assistant may call. Kept in the main process so the model never
 * touches the network or the filesystem directly: it only asks for a named
 * action, which runs with the user's configured sync credentials.
 */
export const AI_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'pull_cloud_documents',
      description:
        'Download the latest documents from the cloud sync connection configured in MarkText into the local sync workspace. ' +
        'Use this when the user asks to fetch, pull or refresh documents from Feishu Drive, Git or WebDAV. ' +
        'It only downloads: local edits are never uploaded and existing local files are kept as conflict copies when both sides changed.',
      parameters: {
        type: 'object',
        properties: {
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

const describeStatus = (status: SyncStatus): string => {
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
  const parts = [`下载 ${result.downloaded} 个文件`]
  if (result.deleted) parts.push(`同步删除 ${result.deleted} 个`)
  if (result.conflicts.length) {
    parts.push(`冲突 ${result.conflicts.length} 个（本地副本已另存为 .conflict 文件）`)
  }
  if (result.errors.length) {
    parts.push(`失败 ${result.errors.length} 个：${result.errors[0]}`)
  }
  parts.push('（本地改动未上传）')
  return `拉取完成：${parts.join('，')}。`
}

export const executeAiTool = async (
  name: string,
  _args: Record<string, unknown> = {}
): Promise<string> => {
  if (name !== 'pull_cloud_documents') {
    return `未知工具：${name}`
  }
  const config = cloudSyncService.getConfig()
  if (!config.workspaceDir) {
    return '云同步尚未配置工作区文件夹：请先在 偏好设置 → 云同步 里选择要镜像的文件夹。'
  }
  // Force: pulling is useful even when background sync is switched off.
  const status = await cloudSyncService.pullNow('ai-tool')
  return describeStatus(status)
}
