import { statsOf } from './state'
import { snifferStates } from './runtime'
import { registerSnifferIpc } from './ipc'
import { resetInterception, startInterception, stopInterception } from './interception'
import { addDownloadedResourceToLibrary, downloadRemoteResource, mergeSelectedTasks } from './download'
import { broadcastDownloadProgress } from './broadcast'
import type { SnifferDownloadProgressPayload } from '../../types/sniffer-types'
import type {
  SnifferDownloadResourceInput,
  SnifferMergeTaskInput,
  SnifferStatsPayload
} from '../../types/sniffer-types'

export { registerSnifferIpc, startInterception, stopInterception, resetInterception }

export function getSnifferStats(partition: string): SnifferStatsPayload {
  return statsOf(snifferStates.get(partition), partition)
}

export async function downloadToLibrary(resource: SnifferDownloadResourceInput): Promise<{
  success: true
  filePath: string
  finalUrl: string
  libraryItem: any
}> {
  const emitProgress = (partial: Partial<SnifferDownloadProgressPayload>) => {
    broadcastDownloadProgress({
      type: 'download',
      id: resource.id,
      phase: partial.phase ?? 'download',
      progress: partial.progress ?? 0,
      message: partial.message
    })
  }

  emitProgress({ phase: 'download', progress: 15, message: '开始下载' })

  const { filePath, finalUrl } = await downloadRemoteResource(resource)
  emitProgress({ phase: 'download', progress: 50, message: '下载完成，开始分析' })

  const libraryItem = await addDownloadedResourceToLibrary(resource, filePath, finalUrl)
  emitProgress({ phase: 'library', progress: 100, message: '已添加到素材库' })
  return { success: true, filePath, finalUrl, libraryItem }
}

export async function mergeSelectedToLibrary(tasks: SnifferMergeTaskInput[]): Promise<{
  success: true
  mergedCount: number
  items: Array<
    | { id: string; success: true; filePath: string; libraryItem: any }
    | { id: string; success: false; errorMessage: string }
  >
}> {
  return mergeSelectedTasks(tasks)
}
