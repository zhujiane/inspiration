import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import TitleBar from './components/TitleBar'
import type { Tab } from './components/TitleBar'
import LeftSidebar from './components/LeftSidebar'
import type { LeftSidebarRef } from './components/LeftSidebar'
import type { Bookmark } from '../../shared/db/bookmark-schema'
import MainContent from './components/MainContent'
import type { MainContentRef } from './components/MainContent'
import SnifferPanel from './components/SnifferPanel'
import type { SnifferStats } from './components/SnifferPanel'
import type { AdvancedSearchFilters } from './components/SnifferPanel'
import { DEFAULT_ADVANCED_FILTERS } from './components/SnifferPanel'
import type { MediaResource } from './components/SnifferPanel/MediaCard'
import type { BatchActionItem, BatchActionItemStatus } from './components/SnifferPanel/BatchActionModal'
import StatusBar from './components/StatusBar'
import PreviewModal from './components/PreviewModal'
import { Modal, Form, Select, Input, message } from 'antd'
import { trpc } from './lib/trpc'

const RESOURCE_LIBRARY_REFRESH_EVENT = 'resource-library:refresh'

interface MergeTask extends BatchActionItem {
  video: MediaResource
  audio: MediaResource
}

interface DownloadTask extends BatchActionItem {
  resource: MediaResource
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
    coverUrl: resource.thumbnailUrl || (resource.type === 'image' ? resource.url : undefined),
    metrics: [resource.size, resource.resolution, resource.duration].filter(Boolean) as string[],
    progress: 0,
    status: 'pending',
    statusText: '待下载',
    resource
  }
}

/* ============================================================
   Ant Design Compact Theme Tokens
   ============================================================ */
const antdTheme = {
  token: {
    colorPrimary: '#1677ff',
    fontSize: 12,
    borderRadius: 4,
    controlHeight: 28,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  },
  components: {
    Button: { controlHeight: 24, paddingInline: 8 },
    Input: { controlHeight: 26 },
    Select: { controlHeight: 26 },
    Tooltip: { fontSize: 11 }
  }
}

/* ============================================================
   App Component
   ============================================================ */
function App(): React.JSX.Element {
  // --- Title Bar State ---
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [url, setUrl] = useState('')

  // --- Sidebar State ---
  const sidebarRef = useRef<LeftSidebarRef>(null)
  const [activeNavId, setActiveNavId] = useState<string | number>('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // --- Sniffer Panel State ---
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

  // --- Preview State ---
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewResource, setPreviewResource] = useState<MediaResource | null>(null)

  // --- MainContent Ref ---
  const mainContentRef = useRef<MainContentRef>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const [allBookmarks, setAllBookmarks] = useState<any[]>([])
  const [bookmarkGroups, setBookmarkGroups] = useState<any[]>([])
  const [isBookmarkModalVisible, setIsBookmarkModalVisible] = useState(false)
  const [bookmarkForm] = Form.useForm()

  // ---------- Sniffer partition helper ----------
  const getActivePartition = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    return tab?.userDataPath ? `persist:${tab.userDataPath}` : 'persist:default'
  }, [tabs, activeTabId])

  // ---------- IPC listeners from main process ----------
  useEffect(() => {
    const bridge = (window as any).snifferBridge
    if (!bridge) return

    const unsubResource = bridge.onResource((data: any) => {
      const { resource } = data
      if (!resource) return
      setResources((prev) => {
        const existingIndex = prev.findIndex((r) => r.url === resource.url)
        if (existingIndex === -1) return [resource, ...prev]

        const existing = prev[existingIndex]
        const merged = {
          ...existing,
          ...resource,
          id: existing.id,
          selected: existing.selected,
          merged: existing.merged
        }
        const next = [...prev]
        next[existingIndex] = merged
        return next
      })
      // Auto-expand panel when a resource is found
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
      const { type, id, progress, phase, message } = payload
      const safeProgress = typeof progress === 'number' ? Math.max(0, Math.min(100, Math.round(progress))) : 0

      if (type === 'merge' && id) {
        setMergeTasks((prev) =>
          prev.map((task) =>
            task.id === id
              ? {
                  ...task,
                  progress: safeProgress > task.progress ? safeProgress : task.progress,
                  statusText:
                    message ||
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
        setDownloadTasks((prev) =>
          prev.map((task) =>
            task.resource.id === id
              ? {
                  ...task,
                  progress: safeProgress > task.progress ? safeProgress : task.progress,
                  statusText:
                    message ||
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

  // ---------- Sniffer control handlers ----------
  const handleSnifferStart = useCallback(async () => {
    const partition = getActivePartition()
    try {
      await trpc.sniffer.start.mutate({ partition })
      setSnifferActive(true)
      setSnifferCollapsed(false)
      setResources([])
      setSnifferStats({ active: true, sniffedCount: 0, identifiedCount: 0, discardedCount: 0, analyzingCount: 0 })
      // Trigger initial DOM scan
      setTimeout(() => mainContentRef.current?.scanPageResources(), 300)
    } catch (e) {
      console.error('Sniffer start failed', e)
    }
  }, [getActivePartition])

  const handleSnifferStop = useCallback(async () => {
    const partition = getActivePartition()
    try {
      await trpc.sniffer.stop.mutate({ partition })
      setSnifferActive(false)
      setSnifferStats((s) => ({ ...s, active: false }))
    } catch (e) {
      console.error('Sniffer stop failed', e)
    }
  }, [getActivePartition])

  const handleSnifferRefresh = useCallback(async () => {
    // Re-scan current page DOM
    mainContentRef.current?.scanPageResources()
  }, [])

  const handleSnifferConfig = useCallback(() => {
    // Placeholder for config modal
    message.info('配置功能即将上线')
  }, [])

  // ---------- Bookmark helpers ----------
  const getCanonicalUrl = (u: string) => {
    if (!u || !u.includes('.')) return u
    try {
      const urlObj = new URL(u.startsWith('http') ? u : `https://${u}`)
      return urlObj.origin + urlObj.pathname
    } catch {
      return u
    }
  }

  const fetchBookmarkGroups = useCallback(async () => {
    try {
      const all = (await trpc.bookmark.list.query()) as any[]
      setAllBookmarks(all)
      setBookmarkGroups(all.filter((b) => b.type === 1 && b.name !== '应用'))
    } catch (error) {
      console.error('Failed to fetch bookmark groups:', error)
    }
  }, [])

  const currentBookmark = useMemo(() => {
    if (!url || !url.includes('.')) return null
    const canonicalUrl = getCanonicalUrl(url)
    return allBookmarks.find((b) => b.type === 2 && b.url && getCanonicalUrl(b.url) === canonicalUrl)
  }, [url, allBookmarks])

  const isFavorited = !!currentBookmark

  useEffect(() => {
    fetchBookmarkGroups()
  }, [fetchBookmarkGroups])

  // --- Webview Event Handler ---
  const handleWebviewEvent = useCallback(
    (tabId: string, e: any) => {
      if (tabId !== activeTabId) return

      // Update navigation state
      if (mainContentRef.current) {
        setCanGoBack(mainContentRef.current.getCanGoBack())
        setCanGoForward(mainContentRef.current.getCanGoForward())
      }

      // Handle specific events
      switch (e.type) {
        case 'did-navigate':
        case 'did-navigate-in-page':
          setUrl(e.url)
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, url: e.url } : t)))
          break
        case 'page-title-updated':
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, title: e.title } : t)))
          break
        case 'page-favicon-updated':
          if (e.favicons && e.favicons.length > 0) {
            const favicon = e.favicons[0]
            setTabs((prev) =>
              prev.map((t) => {
                if (t.id === tabId) {
                  if (t.favicon && t.favicon.startsWith('data:image')) {
                    return t
                  }
                  return { ...t, favicon }
                }
                return t
              })
            )

            // Save favicon to DB if the bookmark doesn't have one yet
            const currentUrl = tabs.find((t) => t.id === tabId)?.url
            if (currentUrl) {
              const bookmark = allBookmarks.find(
                (b) => b.type === 2 && b.url && getCanonicalUrl(b.url) === getCanonicalUrl(currentUrl)
              )
              if (bookmark && (!bookmark.icon || !bookmark.icon.startsWith('data:image'))) {
                fetch(favicon)
                  .then((res) => res.blob())
                  .then((blob) => {
                    const reader = new FileReader()
                    reader.onloadend = () => {
                      const base64 = reader.result as string
                      if (base64 && base64.startsWith('data:image')) {
                        trpc.bookmark.update
                          .mutate({ id: bookmark.id, icon: base64 })
                          .then(() => {
                            fetchBookmarkGroups()
                            sidebarRef.current?.refresh()
                          })
                          .catch((err) => console.error('Failed to save favicon to DB:', err))
                      }
                    }
                    reader.readAsDataURL(blob)
                  })
                  .catch(() => {})
              }
            }
          }
          break
      }
    },
    [activeTabId, tabs, allBookmarks, fetchBookmarkGroups]
  )

  // --- Title Bar Handlers ---
  const handleTabSelect = useCallback(
    (id: string) => {
      setActiveTabId(id)
      const tab = tabs.find((t) => t.id === id)
      setUrl(tab?.url || '')
    },
    [tabs]
  )

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          setUrl('')
        } else if (id === activeTabId && next.length > 0) {
          setActiveTabId(next[0].id)
          setUrl(next[0].url || '')
        }
        return next
      })
    },
    [activeTabId]
  )

  const handleNavSelect = useCallback((item: Bookmark) => {
    setActiveNavId(item.id)

    // Handle special local apps
    if (item.type === 3) {
      if (item.name === '素材管理' || item.name === '素材中心') {
        setTabs((prev) => {
          const existing = prev.find((t) => t.type === 'resource')
          if (existing) {
            setActiveTabId(existing.id)
            return prev
          }
          const newTab: Tab = {
            id: `tab-resource`,
            title: '素材管理',
            type: 'resource'
          }
          setActiveTabId(newTab.id)
          return [...prev, newTab]
        })
        return
      }

      if (item.name === '系统配置' || item.name === '系统初始化') {
        setTabs((prev) => {
          const existing = prev.find((t) => t.type === 'system')
          if (existing) {
            setActiveTabId(existing.id)
            return prev
          }
          const newTab: Tab = {
            id: `tab-system`,
            title: '系统配置',
            type: 'system'
          }
          setActiveTabId(newTab.id)
          return [...prev, newTab]
        })
        return
      }
    }

    if (item.url) {
      setUrl(item.url)
      const dbFavicon = item.icon && item.icon.startsWith('data:image') ? item.icon : undefined
      setTabs((prev) => {
        const existing = prev.find((t) => t.url === item.url)
        if (existing) {
          setActiveTabId(existing.id)
          if (dbFavicon && (!existing.favicon || !existing.favicon.startsWith('data:image'))) {
            return prev.map((t) => (t.id === existing.id ? { ...t, favicon: dbFavicon } : t))
          }
          return prev
        }
        const newTab: Tab = {
          id: `tab-${Date.now()}`,
          title: item.name,
          url: item.url || '',
          userDataPath: item.userDataPath || 'default',
          type: 'webview',
          favicon: dbFavicon
        }
        setActiveTabId(newTab.id)
        return [...prev, newTab]
      })
    }
  }, [])

  // --- Bookmark Handlers ---
  const handleToggleFavorite = useCallback(async () => {
    if (isFavorited && currentBookmark) {
      try {
        await trpc.bookmark.delete.mutate({ id: currentBookmark.id })
        message.success('已取消收藏')
        fetchBookmarkGroups()
        sidebarRef.current?.refresh()
      } catch (error) {
        console.error('Failed to remove bookmark:', error)
        message.error('取消收藏失败')
      }
      return
    }

    const currentTab = tabs.find((t) => t.id === activeTabId)
    bookmarkForm.setFieldsValue({
      name: currentTab?.title || '',
      url: url,
      parentId: bookmarkGroups[0]?.id || 0,
      userDataPath: currentTab?.userDataPath || 'default'
    })
    setIsBookmarkModalVisible(true)
  }, [isFavorited, currentBookmark, activeTabId, tabs, url, bookmarkGroups, bookmarkForm, fetchBookmarkGroups])

  const handleBookmarkSubmit = async () => {
    try {
      const values = await bookmarkForm.validateFields()
      await trpc.bookmark.create.mutate({
        ...values,
        type: 2
      })
      message.success('已添加到收藏夹')
      setIsBookmarkModalVisible(false)
      fetchBookmarkGroups()
      sidebarRef.current?.refresh()
    } catch (error) {
      console.error('Failed to create bookmark:', error)
    }
  }

  // Helper: parse size string to KB
  const parseSizeToKB = (sizeStr?: string): number => {
    if (!sizeStr) return 0
    const match = sizeStr.match(/^([\d.]+)\s*(KB|MB|GB|TB)?$/i)
    if (!match) return 0
    const value = parseFloat(match[1])
    const unit = (match[2] || 'KB').toUpperCase()
    const multipliers: Record<string, number> = { KB: 1, MB: 1024, GB: 1024 * 1024, TB: 1024 * 1024 * 1024 }
    return value * (multipliers[unit] || 1)
  }

  // Helper: parse resolution string to width and height
  const parseResolution = (resStr?: string): { width: number; height: number } => {
    if (!resStr) return { width: 0, height: 0 }
    const match = resStr.match(/^(\d+)\s*[×xX]\s*(\d+)$/)
    if (!match) return { width: 0, height: 0 }
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) }
  }

  // Helper: parse duration string to seconds
  const parseDuration = (durationStr?: string): number => {
    if (!durationStr) return 0
    const match = durationStr.match(/^(\d+):(\d{2})(?::(\d{2}))?$/)
    if (!match) return 0
    const hours = match[3] ? parseInt(match[1], 10) : 0
    const minutes = match[3] ? parseInt(match[2], 10) : parseInt(match[1], 10)
    const seconds = match[3] ? parseInt(match[3], 10) : parseInt(match[2], 10)
    return hours * 3600 + minutes * 60 + seconds
  }

  // Filter resources by search and advanced filters
  const filteredResources = useMemo(() => {
    let result = resources

    // Text search filter
    if (snifferSearch) {
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(snifferSearch.toLowerCase()) || r.type.includes(snifferSearch.toLowerCase())
      )
    }

    // Advanced filters
    if (advancedFilters) {
      result = result.filter((r) => {
        // Type filter
        if (
          advancedFilters.type.length > 0 &&
          !advancedFilters.type.includes('all') &&
          !advancedFilters.type.includes(r.type)
        ) {
          return false
        }

        // Resolution filter (only for images and videos)
        if (r.type === 'image' || r.type === 'video') {
          const { width, height } = parseResolution(r.resolution)
          if (width < advancedFilters.minWidth || height < advancedFilters.minHeight) {
            return false
          }
        }

        // Size filter
        const sizeKB = parseSizeToKB(r.size)
        if (sizeKB < advancedFilters.minSize) {
          return false
        }

        // Duration filter (only for videos and audio)
        if (r.type === 'video' || r.type === 'audio') {
          const durationSec = parseDuration(r.duration)
          if (durationSec < advancedFilters.minDuration) {
            return false
          }
        }

        return true
      })
    }

    return result
  }, [resources, snifferSearch, advancedFilters])

  // --- Sniffer Resource Handlers ---
  const handleResourceSelect = useCallback((id: string, selected: boolean) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, selected } : r)))
  }, [])

  const handleSelectAll = useCallback(() => {
    const visibleIds = new Set(filteredResources.map((r) => r.id))
    setResources((prev) => prev.map((r) => (visibleIds.has(r.id) ? { ...r, selected: true } : r)))
  }, [filteredResources])

  const handleInvertSelect = useCallback(() => {
    const visibleIds = new Set(filteredResources.map((r) => r.id))
    setResources((prev) => prev.map((r) => (visibleIds.has(r.id) ? { ...r, selected: !r.selected } : r)))
  }, [filteredResources])

  const handleClearAll = useCallback(() => {
    setResources([])
    setMergeTasks([])
    setMergeModalVisible(false)
    setMergeSubmitting(false)
    const partition = getActivePartition()
    trpc.sniffer.reset.mutate({ partition }).catch(() => {})
    setSnifferStats({
      active: snifferActive,
      sniffedCount: 0,
      identifiedCount: 0,
      discardedCount: 0,
      analyzingCount: 0
    })
  }, [getActivePartition, snifferActive])

  const handleResourceDelete = useCallback((id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const handleResourcePreview = useCallback(
    (id: string) => {
      const res = resources.find((r) => r.id === id)
      if (!res) return
      setPreviewResource(res)
      setPreviewVisible(true)
    },
    [resources]
  )

  const downloadResource = useCallback(async (resource: MediaResource) => {
    await trpc.sniffer.download.mutate({ resource: resource as any })
  }, [])

  const handleResourceDownload = useCallback(
    async (id: string) => {
      const res = resources.find((r) => r.id === id)
      if (!res) return
      try {
        await downloadResource(res)
        window.dispatchEvent(new CustomEvent(RESOURCE_LIBRARY_REFRESH_EVENT))
        message.success('下载完成，已添加到素材库')
      } catch (error) {
        console.error('Sniffer download failed:', error)
        message.error((error as Error)?.message || '下载失败，未添加到素材库')
      }
    },
    [downloadResource, resources]
  )

  const handleBatchDownloadOpen = useCallback(() => {
    const selectedResources = resources.filter((r) => r.selected)
    if (selectedResources.length === 0) {
      message.warning('请至少选择一个资源')
      return
    }

    setDownloadTasks(selectedResources.map((resource, index) => createDownloadTask(resource, index)))
    setDownloadModalVisible(true)
  }, [resources])

  const handleBatchDownloadConfirm = useCallback(async () => {
    const tasksToRun = downloadTasks.filter((task) => task.status !== 'success')
    if (tasksToRun.length === 0) return

    setDownloadSubmitting(true)
    const downloadedIds = new Set<string>()
    let downloadedCount = 0

    try {
      for (const task of tasksToRun) {
        setDownloadTasks((prev) =>
          prev.map((item) =>
            item.id === task.id
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

        try {
          await downloadResource(task.resource)
          downloadedIds.add(task.resource.id)
          downloadedCount += 1

          setDownloadTasks((prev) =>
            prev.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: 'success' as BatchActionItemStatus,
                    statusText: '下载完成',
                    progress: 100
                  }
                : item
            )
          )
        } catch (error) {
          console.error('Sniffer batch download failed:', error)
          setDownloadTasks((prev) =>
            prev.map((item) =>
              item.id === task.id
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
        }
      }

      if (downloadedCount > 0) {
        window.dispatchEvent(new CustomEvent(RESOURCE_LIBRARY_REFRESH_EVENT))
        setResources((prev) => prev.map((item) => (downloadedIds.has(item.id) ? { ...item, selected: false } : item)))
        message.success(`下载完成，已自动添加 ${downloadedCount} 个素材到素材库`)
      }

      if (tasksToRun.length !== downloadedCount) {
        message.error('部分资源下载失败，请查看详情后重试')
      }
    } finally {
      setDownloadSubmitting(false)
    }
  }, [downloadResource, downloadTasks])

  const handleMergeOpen = useCallback(() => {
    const selectedResources = resources.filter(
      (r) => r.selected && !r.merged && (r.type === 'video' || r.type === 'audio')
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
        tasks: tasksToRun.map((task) => ({
          id: task.id,
          video: task.video,
          audio: task.audio
        }))
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
            return {
              ...item,
              status: 'success' as BatchActionItemStatus,
              statusText: '合并完成',
              progress: 100
            }
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
          prev.map((item) =>
            mergedIds.has(item.id)
              ? {
                  ...item,
                  selected: false,
                  merged: true
                }
              : item
          )
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
      const res = resources.find((r) => r.id === id)
      if (!res) return
      navigator.clipboard.writeText(res.url).then(() => message.success('链接已复制'))
    },
    [resources]
  )

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp style={{ height: '100%' }}>
        <div className="app-shell">
          {/* 1. Left Sidebar — full height */}
          <LeftSidebar
            ref={sidebarRef}
            activeItemId={activeNavId}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((p) => !p)}
            onItemSelect={handleNavSelect}
            onUpdate={fetchBookmarkGroups}
          />

          {/* Right body: TitleBar + Content + StatusBar */}
          <div className="app-body">
            {/* 2. Title Bar */}
            <TitleBar
              tabs={tabs}
              activeTabId={activeTabId}
              url={url}
              isFavorited={isFavorited}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onBack={() => mainContentRef.current?.goBack()}
              onForward={() => mainContentRef.current?.goForward()}
              onReload={() => mainContentRef.current?.reload()}
              onUrlChange={setUrl}
              onUrlSubmit={(u) => {
                if (!u) return
                let formattedUrl = u
                const isUrl =
                  /^(https?:\/\/)|(localhost)|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})/.test(
                    u
                  )
                if (isUrl) {
                  if (!u.startsWith('http://') && !u.startsWith('https://')) {
                    formattedUrl = 'https://' + u
                  }
                } else {
                  formattedUrl = `https://www.google.com/search?q=${encodeURIComponent(u)}`
                }

                setUrl(formattedUrl)

                if (tabs.length === 0) {
                  const newTab: Tab = {
                    id: `tab-${Date.now()}`,
                    title: '新标签页',
                    url: formattedUrl,
                    userDataPath: 'default'
                  }
                  setTabs([newTab])
                  setActiveTabId(newTab.id)
                } else {
                  mainContentRef.current?.loadURL(formattedUrl)
                }
              }}
              onToggleFavorite={handleToggleFavorite}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              onCloseAll={() => {
                setTabs([])
                setUrl('')
              }}
              onCloseRight={() => {}}
              onCloseOthers={() => {
                setTabs((prev) => prev.filter((t) => t.id === activeTabId))
              }}
              onMenuClick={(k) => console.log('Menu:', k)}
              onMinimize={() => trpc.system.minimize.mutate()}
              onMaximize={() => trpc.system.maximize.mutate()}
              onClose={() => trpc.system.close.mutate()}
            />

            {/* 3. Content area: MainContent + SnifferPanel */}
            <div className="app-content">
              <MainContent
                ref={mainContentRef}
                tabs={tabs}
                activeTabId={activeTabId}
                onWebviewEvent={handleWebviewEvent}
                snifferActive={snifferActive}
                snifferPartition={getActivePartition()}
                onSnifferStart={handleSnifferStart}
                onSnifferStop={handleSnifferStop}
                onSnifferRefresh={handleSnifferRefresh}
                onSnifferConfig={handleSnifferConfig}
              />

              {/* 4. Right Sniffer Panel */}
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
                onToggle={() => setSnifferCollapsed((p) => !p)}
                onSearchChange={setSnifferSearch}
                onSelectAll={handleSelectAll}
                onInvertSelect={handleInvertSelect}
                onClearAll={handleClearAll}
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
              />
            </div>

            {/* 5. Status Bar */}
            <StatusBar status="connected" resourceCount={resources.length} currentUrl={url} />
          </div>
        </div>

        {/* Bookmark Create Modal */}
        <Modal
          title="添加收藏"
          open={isBookmarkModalVisible}
          onOk={handleBookmarkSubmit}
          onCancel={() => setIsBookmarkModalVisible(false)}
          okText="添加"
          cancelText="取消"
          destroyOnHidden
        >
          <Form form={bookmarkForm} layout="vertical">
            <Form.Item name="name" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="url" label="网址" rules={[{ required: true, message: '请输入网址' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="parentId" label="收藏分组" rules={[{ required: true, message: '请选择分组' }]}>
              <Select placeholder="请选择分组">
                {bookmarkGroups.map((g) => (
                  <Select.Option key={g.id} value={g.id}>
                    {g.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              name="userDataPath"
              label="持久化目录 (Partition)"
              tooltip="每个标签页可以拥有独立的持久化数据，留空则使用默认配置"
            >
              <Input placeholder="输入持久化标识，例如: user1" />
            </Form.Item>
          </Form>
        </Modal>

        {/* Resource Preview Modal */}
        <PreviewModal
          open={previewVisible}
          onCancel={() => setPreviewVisible(false)}
          title={previewResource?.title}
          type={previewResource?.type}
          src={previewResource?.url}
          cover={previewResource?.thumbnailUrl}
          requestHeaders={previewResource?.requestHeaders}
        />
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
