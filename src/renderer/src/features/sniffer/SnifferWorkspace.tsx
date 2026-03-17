import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, message } from 'antd'
import SnifferPanel, { DEFAULT_ADVANCED_FILTERS } from '../../components/SnifferPanel'
import type { AdvancedSearchFilters, SnifferStats } from '../../components/SnifferPanel'
import PreviewModal from '../../components/PreviewModal'
import type { MediaResource } from '../../components/SnifferPanel/MediaCard'
import type { BatchActionItem, BatchActionItemStatus } from '../../components/SnifferPanel/BatchActionModal'
import type { Tab } from '../browser/types'
import { isWebviewTab } from '../browser/utils'
import { trpc } from '../../lib/trpc'

const RESOURCE_LIBRARY_REFRESH_EVENT = 'resource-library:refresh'

interface MergeTask extends BatchActionItem {
  video: MediaResource
  audio: MediaResource
}

interface DownloadTask extends BatchActionItem {
  resource: MediaResource
}

type ResourceDownloadState = Pick<MediaResource, 'downloadProgress' | 'downloadStatus' | 'downloadStatusText'>

interface SnifferWorkspaceProps {
  activeTab?: Tab
  getActivePartition: () => string
  scanPageResources: () => void
  onResourceCountChange?: (count: number) => void
  onActiveStateChange?: (active: boolean) => void
}

function parseDurationText(value?: string): number {
  if (!value) return 0
  const parts = value
    .split(':')
    .map((part) => Number(part.trim()))
    .filter((part) => !Number.isNaN(part))
  if (parts.length === 0) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function parseSizeToKB(sizeStr?: string): number {
  if (!sizeStr) return 0
  const match = sizeStr.match(/^([\d.]+)\s*(KB|MB|GB|TB)?$/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = (match[2] || 'KB').toUpperCase()
  const multipliers: Record<string, number> = { KB: 1, MB: 1024, GB: 1024 * 1024, TB: 1024 * 1024 * 1024 }
  return value * (multipliers[unit] || 1)
}

function parseResolution(resStr?: string): { width: number; height: number } {
  if (!resStr) return { width: 0, height: 0 }
  const match = resStr.match(/^(\d+)\s*[×xX]\s*(\d+)$/)
  if (!match) return { width: 0, height: 0 }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) }
}

function parseDuration(durationStr?: string): number {
  if (!durationStr) return 0
  const match = durationStr.match(/^(\d+):(\d{2})(?::(\d{2}))?$/)
  if (!match) return 0
  const hours = match[3] ? parseInt(match[1], 10) : 0
  const minutes = match[3] ? parseInt(match[2], 10) : parseInt(match[1], 10)
  const seconds = match[3] ? parseInt(match[3], 10) : parseInt(match[2], 10)
  return hours * 3600 + minutes * 60 + seconds
}

function pairMergeResources(items: MediaResource[]): Array<{ video: MediaResource; audio: MediaResource }> {
  const videos = items.filter((item) => item.type === 'video')
  const audios = items.filter((item) => item.type === 'audio')
  const usedAudioIds = new Set<string>()
  const pairs: Array<{ video: MediaResource; audio: MediaResource }> = []

  for (const video of videos) {
    const videoDuration = parseDurationText(video.duration)
    const videoCapturedAt = video.capturedAt ?? 0
    const candidates = audios
      .filter((audio) => !usedAudioIds.has(audio.id))
      .map((audio) => ({
        audio,
        durationDiff: Math.abs(videoDuration - parseDurationText(audio.duration)),
        tsDiff: Math.abs(videoCapturedAt - (audio.capturedAt ?? 0))
      }))
      .filter((item) => item.durationDiff <= 1)
      .sort((a, b) => a.durationDiff - b.durationDiff || a.tsDiff - b.tsDiff)

    const matched = candidates[0]
    if (!matched) continue

    usedAudioIds.add(matched.audio.id)
    pairs.push({ video, audio: matched.audio })
  }

  return pairs
}

function createMergeTask(pair: { video: MediaResource; audio: MediaResource }, index: number): MergeTask {
  return {
    id: `${pair.video.id}-${pair.audio.id}-${index}`,
    title: pair.video.title,
    coverUrl: pair.video.thumbnailUrl || pair.video.url,
    metrics: [
      pair.video.duration ? `时长 ${pair.video.duration}` : '',
      pair.video.size ? `视频 ${pair.video.size}` : '',
      pair.audio.size ? `音频 ${pair.audio.size}` : ''
    ].filter(Boolean),
    progress: 0,
    status: 'pending',
    statusText: '待合并',
    video: pair.video,
    audio: pair.audio
  }
}

function createDownloadTask(resource: MediaResource, index: number): DownloadTask {
  return {
    id: `${resource.id}-${index}`,
    title: resource.title,
    type: resource.type,
    coverUrl: resource.thumbnailUrl || (resource.type === 'image' ? resource.url : undefined),
    metrics: [resource.size, resource.resolution, resource.duration].filter(Boolean) as string[],
    progress: 0,
    status: 'pending',
    statusText: '待下载',
    resource
  }
}

function buildRedownloadPrompt(resource: MediaResource): { title: string; content: string } | null {
  if (resource.downloaded && resource.merged) {
    return {
      title: '资源已下载且已参与合并',
      content: '继续下载可能生成重复文件。确认仍要重新下载吗？'
    }
  }
  if (resource.downloaded) {
    return {
      title: '资源已下载',
      content: '继续下载可能生成重复文件。确认仍要重新下载吗？'
    }
  }
  if (resource.merged) {
    return {
      title: '资源已参与合并',
      content: '该资源已用于合并并已入库。确认仍要单独下载吗？'
    }
  }
  return null
}

export default function SnifferWorkspace({
  activeTab,
  getActivePartition,
  scanPageResources,
  onResourceCountChange,
  onActiveStateChange
}: SnifferWorkspaceProps): React.JSX.Element | null {
  const [resources, setResources] = useState<MediaResource[]>([])
  const [snifferCollapsed, setSnifferCollapsed] = useState(true)
  const [snifferSearch, setSnifferSearch] = useState('')
  const [snifferActive, setSnifferActive] = useState(false)
  const [snifferStats, setSnifferStats] = useState<SnifferStats>({
    active: false,
    sniffedCount: 0,
    identifiedCount: 0,
    discardedCount: 0
  })
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedSearchFilters>(DEFAULT_ADVANCED_FILTERS)
  const [mergeModalVisible, setMergeModalVisible] = useState(false)
  const [mergeSubmitting, setMergeSubmitting] = useState(false)
  const [mergeTasks, setMergeTasks] = useState<MergeTask[]>([])
  const [downloadModalVisible, setDownloadModalVisible] = useState(false)
  const [downloadSubmitting, setDownloadSubmitting] = useState(false)
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([])
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewResource, setPreviewResource] = useState<MediaResource | null>(null)

  const updateResourcesDownloadState = useCallback((ids: string[], patch: ResourceDownloadState) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    setResources((prev) => prev.map((item) => (idSet.has(item.id) ? { ...item, ...patch } : item)))
  }, [])

  useEffect(() => {
    onResourceCountChange?.(resources.length)
  }, [onResourceCountChange, resources.length])

  useEffect(() => {
    onActiveStateChange?.(snifferActive)
  }, [onActiveStateChange, snifferActive])

  useEffect(() => {
    const bridge = window.snifferBridge
    if (!bridge) return

    const unsubResource = bridge.onResource((data: any) => {
      const { resource } = data
      if (!resource) return

      setResources((prev) => {
        const existingIndex = prev.findIndex((item) => item.url === resource.url)
        if (existingIndex === -1) return [resource, ...prev]

        const existing = prev[existingIndex]
        const next = [...prev]
        next[existingIndex] = {
          ...existing,
          ...resource,
          id: existing.id,
          selected: existing.selected,
          merged: existing.merged,
          downloaded: existing.downloaded,
          downloadProgress: existing.downloadProgress,
          downloadStatus: existing.downloadStatus,
          downloadStatusText: existing.downloadStatusText
        }
        return next
      })
      setSnifferCollapsed(false)
    })

    const unsubStats = bridge.onStats((data: any) => {
      const partition = getActivePartition()
      if (data.partition !== partition) return
      setSnifferStats({
        active: data.active,
        sniffedCount: data.sniffedCount,
        identifiedCount: data.identifiedCount,
        discardedCount: data.discardedCount,
        analyzingCount: data.analyzingCount,
        discardedUrls: data.discardedUrls
      })
    })

    const unsubDownloadProgress = bridge.onDownloadProgress((payload: any) => {
      if (!payload || typeof payload !== 'object') return

      const { type, id, progress, phase, message: progressMessage } = payload
      const safeProgress = typeof progress === 'number' ? Math.max(0, Math.min(100, Math.round(progress))) : 0

      if (type === 'merge' && id) {
        setMergeTasks((prev) =>
          prev.map((task) =>
            task.id === id
              ? {
                  ...task,
                  progress: safeProgress > task.progress ? safeProgress : task.progress,
                  statusText:
                    progressMessage ||
                    (phase === 'video'
                      ? '视频下载中'
                      : phase === 'audio'
                        ? '音频下载中'
                        : phase === 'merge'
                          ? '合并中'
                          : phase === 'analyze'
                            ? '分析中'
                            : phase === 'library'
                              ? '写入素材库'
                              : task.statusText)
                }
              : task
          )
        )
        return
      }

      if (type === 'download' && id) {
        setResources((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  downloadProgress:
                    safeProgress > (item.downloadProgress ?? 0) ? safeProgress : (item.downloadProgress ?? 0),
                  downloadStatus: phase === 'library' && safeProgress >= 100 ? 'success' : 'processing',
                  downloadStatusText:
                    progressMessage ||
                    (phase === 'download'
                      ? '下载中'
                      : phase === 'analyze'
                        ? '分析中'
                        : phase === 'library'
                          ? '写入素材库'
                          : item.downloadStatusText)
                }
              : item
          )
        )
        setDownloadTasks((prev) =>
          prev.map((task) =>
            task.resource.id === id
              ? {
                  ...task,
                  progress: safeProgress > task.progress ? safeProgress : task.progress,
                  statusText:
                    progressMessage ||
                    (phase === 'download'
                      ? '下载中'
                      : phase === 'analyze'
                        ? '分析中'
                        : phase === 'library'
                          ? '写入素材库'
                          : task.statusText)
                }
              : task
          )
        )
      }
    })

    return () => {
      unsubResource()
      unsubStats()
      unsubDownloadProgress()
    }
  }, [getActivePartition])

  useEffect(() => {
    if (activeTab && isWebviewTab(activeTab) && activeTab.url) {
      setSnifferCollapsed(false)
    }
  }, [activeTab])

  const filteredResources = useMemo(() => {
    let result = resources

    if (snifferSearch) {
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(snifferSearch.toLowerCase()) ||
          item.type.includes(snifferSearch.toLowerCase())
      )
    }

    result = result.filter((item) => {
      if (
        advancedFilters.type.length > 0 &&
        !advancedFilters.type.includes('all') &&
        !advancedFilters.type.includes(item.type)
      ) {
        return false
      }

      if (item.type === 'image' || item.type === 'video') {
        const { width, height } = parseResolution(item.resolution)
        if (width < advancedFilters.minWidth || height < advancedFilters.minHeight) return false
      }

      if (parseSizeToKB(item.size) < advancedFilters.minSize) return false

      if (
        (item.type === 'video' || item.type === 'audio') &&
        parseDuration(item.duration) < advancedFilters.minDuration
      ) {
        return false
      }

      return true
    })

    return result
  }, [advancedFilters, resources, snifferSearch])

  const handleSnifferStart = useCallback(async () => {
    try {
      await trpc.sniffer.start.mutate({ partition: getActivePartition() })
      setSnifferActive(true)
      setSnifferCollapsed(false)
      setResources([])
      setSnifferStats({ active: true, sniffedCount: 0, identifiedCount: 0, discardedCount: 0, analyzingCount: 0 })
      window.setTimeout(scanPageResources, 300)
    } catch (error) {
      console.error('Sniffer start failed', error)
    }
  }, [getActivePartition, scanPageResources])

  const handleSnifferStop = useCallback(async () => {
    try {
      await trpc.sniffer.stop.mutate({ partition: getActivePartition() })
      setSnifferActive(false)
      setSnifferStats((prev) => ({ ...prev, active: false }))
    } catch (error) {
      console.error('Sniffer stop failed', error)
    }
  }, [getActivePartition])

  const handleResourceSelect = useCallback((id: string, selected: boolean) => {
    setResources((prev) => prev.map((item) => (item.id === id ? { ...item, selected } : item)))
  }, [])

  const handleSelectAll = useCallback(() => {
    const visibleIds = new Set(filteredResources.map((item) => item.id))
    setResources((prev) => prev.map((item) => (visibleIds.has(item.id) ? { ...item, selected: true } : item)))
  }, [filteredResources])

  const handleClearSelection = useCallback(() => {
    setResources((prev) => prev.map((item) => (item.selected ? { ...item, selected: false } : item)))
  }, [])

  const handleClearAll = useCallback(() => {
    setResources([])
    setMergeTasks([])
    setMergeModalVisible(false)
    setMergeSubmitting(false)
    trpc.sniffer.reset.mutate({ partition: getActivePartition() }).catch(() => {})
    setSnifferStats({
      active: snifferActive,
      sniffedCount: 0,
      identifiedCount: 0,
      discardedCount: 0,
      analyzingCount: 0
    })
  }, [getActivePartition, snifferActive])

  const handleResourceDelete = useCallback((id: string) => {
    setResources((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const handleDeleteSelected = useCallback(() => {
    const selectedResources = resources.filter((item) => item.selected)
    if (selectedResources.length === 0) {
      message.warning('请至少选择一个资源')
      return
    }

    const selectedIds = new Set(selectedResources.map((item) => item.id))
    setResources((prev) => prev.filter((item) => !selectedIds.has(item.id)))
    setDownloadTasks((prev) => prev.filter((task) => !selectedIds.has(task.resource.id)))
    setMergeTasks((prev) => prev.filter((task) => !selectedIds.has(task.video.id) && !selectedIds.has(task.audio.id)))
  }, [resources])

  const handleResourcePreview = useCallback(
    (id: string) => {
      const resource = resources.find((item) => item.id === id)
      if (!resource) return
      setPreviewResource(resource)
      setPreviewVisible(true)
    },
    [resources]
  )

  const downloadResource = useCallback(async (resource: MediaResource) => {
    await trpc.sniffer.download.mutate({ resource: resource as any })
  }, [])

  const handleResourceDownload = useCallback(
    async (id: string) => {
      const resource = resources.find((item) => item.id === id)
      if (!resource) return

      const existingTask = downloadTasks.find((task) => task.resource.id === id && task.status !== 'error')
      if (resource.downloadStatus === 'processing' || existingTask?.status === 'processing') {
        message.warning('该资源正在下载，请勿重复操作')
        return
      }

      if (existingTask?.status === 'pending') {
        setDownloadModalVisible(true)
        message.warning('该资源已在下载列表中')
        return
      }

      const prompt = buildRedownloadPrompt(resource)
      if (prompt) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: prompt.title,
            content: prompt.content,
            okText: '继续下载',
            cancelText: '取消',
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
          })
        })
        if (!confirmed) return
      }

      const nextTask = createDownloadTask(resource, Date.now())
      setDownloadTasks((prev) => [...prev.filter((task) => task.resource.id !== id), nextTask])
      updateResourcesDownloadState([id], {
        downloadProgress: 0,
        downloadStatus: 'processing',
        downloadStatusText: '准备下载'
      })

      try {
        await downloadResource(resource)
        setResources((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  downloaded: true,
                  selected: false,
                  downloadProgress: 100,
                  downloadStatus: 'success',
                  downloadStatusText: '下载完成'
                }
              : item
          )
        )
        setDownloadTasks((prev) =>
          prev.map((item) =>
            item.resource.id === id
              ? { ...item, status: 'success', statusText: '下载完成', progress: 100, errorMessage: undefined }
              : item
          )
        )
        window.dispatchEvent(new CustomEvent(RESOURCE_LIBRARY_REFRESH_EVENT))
        message.success('下载完成，已添加到素材库')
      } catch (error) {
        console.error('Sniffer download failed:', error)
        const errorMessage = (error as Error)?.message || '下载失败，未添加到素材库'
        updateResourcesDownloadState([id], {
          downloadProgress: 0,
          downloadStatus: 'error',
          downloadStatusText: '下载失败'
        })
        setDownloadTasks((prev) =>
          prev.map((item) =>
            item.resource.id === id
              ? { ...item, status: 'error', statusText: '下载失败', progress: 0, errorMessage }
              : item
          )
        )
        message.error(errorMessage)
      }
    },
    [downloadResource, downloadTasks, resources, updateResourcesDownloadState]
  )

  const handleBatchDownloadOpen = useCallback(() => {
    const selectedResources = resources.filter((item) => item.selected)
    if (selectedResources.length === 0) {
      message.warning('请至少选择一个资源')
      return
    }

    const pendingResources = selectedResources.filter((item) => !item.downloaded)
    if (pendingResources.length === 0) {
      message.warning('选中的资源已下载，无需重复加入下载列表')
      return
    }

    if (pendingResources.length !== selectedResources.length) {
      message.info(`已跳过 ${selectedResources.length - pendingResources.length} 个已下载资源`)
    }

    setDownloadTasks(pendingResources.map((resource, index) => createDownloadTask(resource, index)))
    setDownloadModalVisible(true)
  }, [resources])

  const handleBatchDownloadConfirm = useCallback(async () => {
    const tasksToRun = downloadTasks.filter((task) => task.status !== 'success')
    if (tasksToRun.length === 0) return

    setDownloadSubmitting(true)
    const taskIdsToRun = new Set(tasksToRun.map((task) => task.id))
    const downloadedIds = new Set<string>()
    let downloadedCount = 0

    setDownloadTasks((prev) =>
      prev.map((item) =>
        taskIdsToRun.has(item.id)
          ? {
              ...item,
              status: 'processing' as BatchActionItemStatus,
              statusText: '下载中',
              progress: 15,
              errorMessage: undefined
            }
          : item
      )
    )

    updateResourcesDownloadState(
      tasksToRun.map((task) => task.resource.id),
      {
        downloadProgress: 15,
        downloadStatus: 'processing',
        downloadStatusText: '下载中'
      }
    )

    try {
      const result = await trpc.sniffer.downloadSelected.mutate({
        resources: tasksToRun.map((task) => task.resource)
      })

      const resultMap = new Map(result.items.map((item) => [item.id, item]))
      for (const task of tasksToRun) {
        const taskResult = resultMap.get(task.resource.id)
        if (taskResult?.success) {
          downloadedIds.add(task.resource.id)
          downloadedCount += 1
        } else {
          console.error('Sniffer batch download failed:', taskResult?.errorMessage || 'Unknown download error')
        }
      }

      setDownloadTasks((prev) =>
        prev.map((item) => {
          if (!taskIdsToRun.has(item.id)) return item
          const taskResult = resultMap.get(item.resource.id)
          if (taskResult?.success) {
            return { ...item, status: 'success' as BatchActionItemStatus, statusText: '下载完成', progress: 100 }
          }
          return {
            ...item,
            status: 'error' as BatchActionItemStatus,
            statusText: '下载失败',
            progress: 0,
            errorMessage: taskResult?.errorMessage || '下载失败，未添加到素材库'
          }
        })
      )

      if (downloadedCount > 0) {
        window.dispatchEvent(new CustomEvent(RESOURCE_LIBRARY_REFRESH_EVENT))
        setResources((prev) =>
          prev.map((item) =>
            downloadedIds.has(item.id)
              ? {
                  ...item,
                  downloaded: true,
                  selected: false,
                  downloadProgress: 100,
                  downloadStatus: 'success',
                  downloadStatusText: '下载完成'
                }
              : item
          )
        )
        message.success(`下载完成，已自动添加 ${downloadedCount} 个素材到素材库`)
      }

      const failedIds = tasksToRun.map((task) => task.resource.id).filter((id) => !downloadedIds.has(id))
      if (failedIds.length > 0) {
        updateResourcesDownloadState(failedIds, {
          downloadProgress: 0,
          downloadStatus: 'error',
          downloadStatusText: '下载失败'
        })
      }

      if (tasksToRun.length !== downloadedCount) {
        message.error('部分资源下载失败，请查看详情后重试')
      }
    } catch (error) {
      console.error('Sniffer batch download failed:', error)
      setDownloadTasks((prev) =>
        prev.map((item) =>
          taskIdsToRun.has(item.id)
            ? {
                ...item,
                status: 'error' as BatchActionItemStatus,
                statusText: '下载失败',
                progress: 0,
                errorMessage: (error as Error)?.message || '下载失败，未添加到素材库'
              }
            : item
        )
      )
      updateResourcesDownloadState(
        tasksToRun.map((item) => item.resource.id),
        {
          downloadProgress: 0,
          downloadStatus: 'error',
          downloadStatusText: '下载失败'
        }
      )
      message.error((error as Error)?.message || '下载失败，未添加到素材库')
    } finally {
      setDownloadSubmitting(false)
    }
  }, [downloadTasks, updateResourcesDownloadState])

  const handleMergeOpen = useCallback(() => {
    const selectedResources = resources.filter(
      (item) => item.selected && !item.merged && (item.type === 'video' || item.type === 'audio')
    )
    if (selectedResources.length < 2) {
      message.warning('请至少选择一个未合并的视频和一个未合并的音频')
      return
    }

    const pairs = pairMergeResources(selectedResources)
    if (pairs.length === 0) {
      message.warning('未找到可合并的音视频配对，请检查选中项的时长是否接近')
      return
    }

    setMergeTasks(pairs.map((pair, index) => createMergeTask(pair, index)))
    setMergeModalVisible(true)
  }, [resources])

  const handleMergeConfirm = useCallback(async () => {
    const tasksToRun = mergeTasks.filter((task) => task.status !== 'success')
    if (tasksToRun.length === 0) return

    setMergeSubmitting(true)
    const taskIdsToRun = new Set(tasksToRun.map((task) => task.id))
    setMergeTasks((prev) =>
      prev.map((item) =>
        taskIdsToRun.has(item.id)
          ? {
              ...item,
              status: 'processing' as BatchActionItemStatus,
              statusText: '下载并合并中',
              progress: 15,
              errorMessage: undefined
            }
          : item
      )
    )

    const mergedIds = new Set<string>()
    let mergedCount = 0

    try {
      const result = await trpc.sniffer.mergeSelected.mutate({
        tasks: tasksToRun.map((task) => ({ id: task.id, video: task.video, audio: task.audio }))
      })

      const resultMap = new Map(result.items.map((item) => [item.id, item]))
      for (const task of tasksToRun) {
        const taskResult = resultMap.get(task.id)
        if (taskResult?.success) {
          mergedIds.add(task.video.id)
          mergedIds.add(task.audio.id)
          mergedCount += 1
        } else {
          console.error('Sniffer merge failed:', taskResult?.errorMessage || 'Unknown merge error')
        }
      }

      setMergeTasks((prev) =>
        prev.map((item) => {
          if (!taskIdsToRun.has(item.id)) return item
          const taskResult = resultMap.get(item.id)
          if (taskResult?.success) {
            return { ...item, status: 'success' as BatchActionItemStatus, statusText: '合并完成', progress: 100 }
          }
          return {
            ...item,
            status: 'error' as BatchActionItemStatus,
            statusText: '合并失败',
            progress: 0,
            errorMessage: taskResult?.errorMessage || '合并失败，未添加到素材库'
          }
        })
      )

      if (mergedCount > 0) {
        window.dispatchEvent(new CustomEvent(RESOURCE_LIBRARY_REFRESH_EVENT))
        setResources((prev) =>
          prev.map((item) => (mergedIds.has(item.id) ? { ...item, selected: false, merged: true } : item))
        )
        message.success(`合并完成，已自动添加 ${mergedCount} 个素材到素材库`)
      }

      if (tasksToRun.length !== mergedCount) {
        message.error('部分任务合并失败，请查看详情后重试')
      }
    } catch (error) {
      console.error('Sniffer merge failed:', error)
      setMergeTasks((prev) =>
        prev.map((item) =>
          taskIdsToRun.has(item.id)
            ? {
                ...item,
                status: 'error' as BatchActionItemStatus,
                statusText: '合并失败',
                progress: 0,
                errorMessage: (error as Error)?.message || '合并失败，未添加到素材库'
              }
            : item
        )
      )
      message.error((error as Error)?.message || '合并失败，未添加到素材库')
    } finally {
      setMergeSubmitting(false)
    }
  }, [mergeTasks])

  const handleResourceCopyUrl = useCallback(
    (id: string) => {
      const resource = resources.find((item) => item.id === id)
      if (!resource) return
      navigator.clipboard.writeText(resource.url).then(() => message.success('链接已复制'))
    },
    [resources]
  )

  const handleResourceMetadataChange = useCallback(
    (id: string, metadata: Partial<Pick<MediaResource, 'type' | 'resolution' | 'duration' | 'thumbnailUrl'>>) => {
      setResources((prev) =>
        prev.map((resource) => {
          if (resource.id !== id) return resource
          const next = { ...resource, ...metadata }
          if (
            next.type === resource.type &&
            next.resolution === resource.resolution &&
            next.duration === resource.duration &&
            next.thumbnailUrl === resource.thumbnailUrl
          ) {
            return resource
          }
          return next
        })
      )
    },
    []
  )

  useEffect(() => {
    if (mergeTasks.length === 0 && downloadTasks.length === 0) return

    const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))

    setMergeTasks((prev) =>
      prev.map((task) => {
        const nextVideo = resourceMap.get(task.video.id) ?? task.video
        const nextAudio = resourceMap.get(task.audio.id) ?? task.audio
        const nextCoverUrl = nextVideo.thumbnailUrl || nextVideo.url

        if (task.video === nextVideo && task.audio === nextAudio && task.coverUrl === nextCoverUrl) return task
        return { ...task, video: nextVideo, audio: nextAudio, coverUrl: nextCoverUrl }
      })
    )

    setDownloadTasks((prev) =>
      prev.map((task) => {
        const nextResource = resourceMap.get(task.resource.id) ?? task.resource
        const nextCoverUrl = nextResource.thumbnailUrl || (nextResource.type === 'image' ? nextResource.url : undefined)

        if (task.resource === nextResource && task.coverUrl === nextCoverUrl && task.type === nextResource.type) {
          return task
        }

        return { ...task, resource: nextResource, type: nextResource.type, coverUrl: nextCoverUrl }
      })
    )
  }, [downloadTasks.length, mergeTasks.length, resources])

  if (!activeTab || !isWebviewTab(activeTab)) {
    return (
      <PreviewModal
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        title={previewResource?.title}
        type={previewResource?.type}
        src={previewResource?.url}
        cover={previewResource?.thumbnailUrl}
        contentType={previewResource?.contentType}
        requestHeaders={previewResource?.requestHeaders}
      />
    )
  }

  return (
    <>
      <SnifferPanel
        resources={filteredResources}
        collapsed={snifferCollapsed}
        searchText={snifferSearch}
        stats={snifferStats}
        advancedFilters={advancedFilters}
        mergeTasks={mergeTasks}
        mergeModalVisible={mergeModalVisible}
        mergeSubmitting={mergeSubmitting}
        downloadTasks={downloadTasks}
        downloadModalVisible={downloadModalVisible}
        downloadSubmitting={downloadSubmitting}
        onToggle={() => setSnifferCollapsed((prev) => !prev)}
        onActiveChange={(active) => {
          if (active) {
            void handleSnifferStart()
            return
          }
          void handleSnifferStop()
        }}
        onSearchChange={setSnifferSearch}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onClearAll={handleClearAll}
        onDeleteSelected={handleDeleteSelected}
        onMerge={handleMergeOpen}
        onMergeCancel={() => !mergeSubmitting && setMergeModalVisible(false)}
        onMergeConfirm={handleMergeConfirm}
        onBatchDownload={handleBatchDownloadOpen}
        onBatchDownloadCancel={() => !downloadSubmitting && setDownloadModalVisible(false)}
        onBatchDownloadConfirm={handleBatchDownloadConfirm}
        onAdvancedFiltersChange={setAdvancedFilters}
        onResourceSelect={handleResourceSelect}
        onResourceDelete={handleResourceDelete}
        onResourcePreview={handleResourcePreview}
        onResourceDownload={handleResourceDownload}
        onResourceCopyUrl={handleResourceCopyUrl}
        onResourceMetadataChange={handleResourceMetadataChange}
      />
      <PreviewModal
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        title={previewResource?.title}
        type={previewResource?.type}
        src={previewResource?.url}
        cover={previewResource?.thumbnailUrl}
        contentType={previewResource?.contentType}
        requestHeaders={previewResource?.requestHeaders}
      />
    </>
  )
}
