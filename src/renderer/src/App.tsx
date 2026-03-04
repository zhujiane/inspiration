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
import StatusBar from './components/StatusBar'
import PreviewModal from './components/PreviewModal'
import { Modal, Form, Select, Input, message } from 'antd'
import { trpc } from './lib/trpc'

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
        // Deduplicate by URL
        if (prev.some((r) => r.url === resource.url)) return prev
        return [resource, ...prev]
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
        analyzingCount: data.analyzingCount
      })
    })

    return () => {
      unsubResource()
      unsubStats()
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

  // --- Sniffer Resource Handlers ---
  const handleResourceSelect = useCallback((id: string, selected: boolean) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, selected } : r)))
  }, [])

  const handleSelectAll = useCallback(() => {
    setResources((prev) => prev.map((r) => ({ ...r, selected: true })))
  }, [])

  const handleClearAll = useCallback(() => {
    setResources([])
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

  const handleResourceDownload = useCallback(
    (id: string) => {
      const res = resources.find((r) => r.id === id)
      if (!res) return
      // Trigger file download via browser
      const a = document.createElement('a')
      a.href = res.url
      a.download = res.title || 'media'
      a.target = '_blank'
      a.click()
      message.success('已开始下载，资源将添加至素材库')
    },
    [resources]
  )

  const handleResourceCopyUrl = useCallback(
    (id: string) => {
      const res = resources.find((r) => r.id === id)
      if (!res) return
      navigator.clipboard.writeText(res.url).then(() => message.success('链接已复制'))
    },
    [resources]
  )

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
        if (advancedFilters.type !== 'all' && r.type !== advancedFilters.type) {
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
                onToggle={() => setSnifferCollapsed((p) => !p)}
                onSearchChange={setSnifferSearch}
                onSelectAll={handleSelectAll}
                onClearAll={handleClearAll}
                onMerge={() => console.log('Merge')}
                onBatchAction={() => console.log('Batch')}
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
        />
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
