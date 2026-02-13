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
import type { MediaResource } from './components/SnifferPanel/MediaCard'
import StatusBar from './components/StatusBar'
import { Modal, Form, Select, Input, message } from 'antd'
import { trpc } from './lib/trpc'

/* ============================================================
   Demo Data
   ============================================================ */
const DEMO_TABS: Tab[] = []

// No longer used as Sidebar handles its own data

const DEMO_RESOURCES: MediaResource[] = [
  {
    id: 'res-1',
    type: 'video',
    title: '夏日海边旅拍.mp4',
    size: '24.5MB',
    resolution: '1920×1080',
    duration: '00:32',
    url: 'https://example.com/video1.mp4'
  },
  {
    id: 'res-2',
    type: 'image',
    title: '产品封面图.jpg',
    size: '1.2MB',
    resolution: '1200×800',
    url: 'https://example.com/img1.jpg'
  },
  {
    id: 'res-3',
    type: 'audio',
    title: '背景音乐-轻快.mp3',
    size: '3.8MB',
    duration: '03:45',
    url: 'https://example.com/audio1.mp3'
  },
  {
    id: 'res-4',
    type: 'video',
    title: '美食制作过程.mp4',
    size: '18.2MB',
    resolution: '1080×1920',
    duration: '01:15',
    url: 'https://example.com/video2.mp4'
  },
  {
    id: 'res-5',
    type: 'image',
    title: '城市夜景航拍.png',
    size: '5.6MB',
    resolution: '3840×2160',
    url: 'https://example.com/img2.png'
  },
  {
    id: 'res-6',
    type: 'image',
    title: '人物特写照片.jpg',
    size: '0.8MB',
    resolution: '800×1200',
    url: 'https://example.com/img3.jpg'
  }
]

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
  const [tabs, setTabs] = useState<Tab[]>(DEMO_TABS)
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [url, setUrl] = useState('')

  // --- Sidebar State ---
  const sidebarRef = useRef<LeftSidebarRef>(null)
  const [activeNavId, setActiveNavId] = useState<string | number>('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // --- Sniffer Panel State ---
  const [resources, setResources] = useState<MediaResource[]>(DEMO_RESOURCES)
  const [snifferCollapsed, setSnifferCollapsed] = useState(false)
  const [snifferSearch, setSnifferSearch] = useState('')

  // --- MainContent Ref ---
  const mainContentRef = useRef<MainContentRef>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const [allBookmarks, setAllBookmarks] = useState<any[]>([])
  const [bookmarkGroups, setBookmarkGroups] = useState<any[]>([])
  const [isBookmarkModalVisible, setIsBookmarkModalVisible] = useState(false)
  const [bookmarkForm] = Form.useForm()

  const getCanonicalUrl = (u: string) => {
    try {
      const urlObj = new URL(u)
      return urlObj.origin + urlObj.pathname
    } catch {
      return u
    }
  }

  const fetchBookmarkGroups = useCallback(async () => {
    try {
      const all = (await trpc.bookmark.list.query()) as any[]
      setAllBookmarks(all)
      setBookmarkGroups(all.filter((b) => b.type === 1))
    } catch (error) {
      console.error('Failed to fetch bookmark groups:', error)
    }
  }, [])

  const currentBookmark = useMemo(() => {
    if (!url) return null
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
            setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, favicon: e.favicons[0] } : t)))
          }
          break
      }
    },
    [activeTabId]
  )

  // --- Title Bar Handlers ---
  const handleTabSelect = useCallback(
    (id: string) => {
      setActiveTabId(id)
      const tab = tabs.find((t) => t.id === id)
      if (tab?.url) setUrl(tab.url)
    },
    [tabs]
  )

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (id === activeTabId && next.length > 0) {
          setActiveTabId(next[0].id)
          if (next[0].url) setUrl(next[0].url)
        }
        return next
      })
    },
    [activeTabId]
  )

  const handleTabAdd = useCallback(() => {
    const newTab: Tab = {
      id: `tab-${Date.now()}`,
      title: '新标签页',
      url: '',
      userDataPath: 'default' // Default persistence directory
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
    setUrl('')
  }, [])

  const handleNavSelect = useCallback((item: Bookmark) => {
    setActiveNavId(item.id)

    // Handle special local apps
    if (item.type === 3 && (item.name === '素材管理' || item.name === '素材中心')) {
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

    if (item.url) {
      setUrl(item.url)
      // Also update or create a tab
      setTabs((prev) => {
        const existing = prev.find((t) => t.url === item.url)
        if (existing) {
          setActiveTabId(existing.id)
          return prev
        }
        const newTab: Tab = {
          id: `tab-${Date.now()}`,
          title: item.name,
          url: item.url || '',
          userDataPath: item.userDataPath || 'default',
          type: 'webview'
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
  }, [isFavorited, currentBookmark, activeTabId, tabs, url, bookmarkGroups, bookmarkForm, fetchBookmarkGroups, message])

  const handleBookmarkSubmit = async () => {
    try {
      const values = await bookmarkForm.validateFields()
      await trpc.bookmark.create.mutate({
        ...values,
        type: 2 // URL type
      })
      message.success('已添加到收藏夹')
      setIsBookmarkModalVisible(false)
      fetchBookmarkGroups()
      sidebarRef.current?.refresh()
    } catch (error) {
      console.error('Failed to create bookmark:', error)
    }
  }

  // --- Sniffer Handlers ---
  const handleResourceSelect = useCallback((id: string, selected: boolean) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, selected } : r)))
  }, [])

  const handleSelectAll = useCallback(() => {
    setResources((prev) => prev.map((r) => ({ ...r, selected: true })))
  }, [])

  const handleClearAll = useCallback(() => {
    setResources((prev) => prev.map((r) => ({ ...r, selected: false })))
  }, [])

  const handleResourceDelete = useCallback((id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id))
  }, [])

  // Filter resources by search
  const filteredResources = snifferSearch ? resources.filter((r) => r.title.toLowerCase().includes(snifferSearch.toLowerCase()) || r.type.includes(snifferSearch.toLowerCase())) : resources

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp style={{ height: '100%' }}>
        <div className="app-shell">
          {/* 1. Left Sidebar — full height */}
          <LeftSidebar ref={sidebarRef} activeItemId={activeNavId} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((p) => !p)} onItemSelect={handleNavSelect} />

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
                // Basic URL detection: starts with protocol, or looks like a domain/IP (contains dot, etc)
                const isUrl = /^(https?:\/\/)|(localhost)|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})/.test(u)
                if (isUrl) {
                  if (!u.startsWith('http://') && !u.startsWith('https://')) {
                    formattedUrl = 'https://' + u
                  }
                } else {
                  // If not a URL, use search
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
              onTabAdd={handleTabAdd}
              onCloseAll={() => setTabs([])}
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
              <MainContent ref={mainContentRef} tabs={tabs} activeTabId={activeTabId} onWebviewEvent={handleWebviewEvent} />

              {/* 4. Right Sniffer Panel */}
              <SnifferPanel
                resources={filteredResources}
                collapsed={snifferCollapsed}
                searchText={snifferSearch}
                onToggle={() => setSnifferCollapsed((p) => !p)}
                onSearchChange={setSnifferSearch}
                onSelectAll={handleSelectAll}
                onClearAll={handleClearAll}
                onMerge={() => console.log('Merge')}
                onBatchAction={() => console.log('Batch')}
                onAdvancedSearch={() => console.log('Advanced search')}
                onResourceSelect={handleResourceSelect}
                onResourceDelete={handleResourceDelete}
                onResourcePreview={(id) => console.log('Preview:', id)}
                onResourceDownload={(id) => console.log('Download:', id)}
                onResourceCopyUrl={(id) => console.log('Copy URL:', id)}
              />
            </div>

            {/* 5. Status Bar */}
            <StatusBar status="connected" resourceCount={resources.length} currentUrl={url} />
          </div>
        </div>

        {/* Bookmark Create Modal */}
        <Modal title="添加收藏" open={isBookmarkModalVisible} onOk={handleBookmarkSubmit} onCancel={() => setIsBookmarkModalVisible(false)} okText="添加" cancelText="取消" destroyOnHidden>
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
            <Form.Item name="userDataPath" label="持久化目录 (Partition)" tooltip="每个标签页可以拥有独立的持久化数据，留空则使用默认配置">
              <Input placeholder="输入持久化标识，例如: user1" />
            </Form.Item>
          </Form>
        </Modal>
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
