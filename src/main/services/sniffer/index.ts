import { statsOf } from './state'
import { snifferStates } from './runtime'
import { registerSnifferIpc } from './ipc'
import { resetInterception, startInterception, stopInterception } from './interception'
import { addDownloadedResourceToLibrary, downloadRemoteResource, mergeSelectedTasks } from './download'
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
  const { filePath, finalUrl } = await downloadRemoteResource(resource)
  const libraryItem = await addDownloadedResourceToLibrary(resource, filePath, finalUrl)
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
