import { useState, useCallback } from 'react'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import TitleBar from './components/TitleBar'
import type { Tab } from './components/TitleBar'
import LeftSidebar from './components/LeftSidebar'
import type { Bookmark } from '../../shared/db/bookmark-schema'
import MainContent from './components/MainContent'
import SnifferPanel from './components/SnifferPanel'
import type { MediaResource } from './components/SnifferPanel/MediaCard'
import StatusBar from './components/StatusBar'

/* ============================================================
   Demo Data
   ============================================================ */
const DEMO_TABS: Tab[] = [
  { id: 'tab-1', title: '抖音', url: 'https://www.douyin.com' },
  { id: 'tab-2', title: '小红书', url: 'https://www.xiaohongshu.com' }
]

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
  const [url, setUrl] = useState('https://www.douyin.com')
  const [isFavorited, setIsFavorited] = useState(false)

  // --- Sidebar State ---
  const [activeNavId, setActiveNavId] = useState<string | number>('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // --- Sniffer Panel State ---
  const [resources, setResources] = useState<MediaResource[]>(DEMO_RESOURCES)
  const [snifferCollapsed, setSnifferCollapsed] = useState(false)
  const [snifferSearch, setSnifferSearch] = useState('')

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
      url: ''
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
    setUrl('')
  }, [])

  const handleNavSelect = useCallback((item: Bookmark) => {
    setActiveNavId(item.id)
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
          url: item.url || ''
        }
        setActiveTabId(newTab.id)
        return [...prev, newTab]
      })
    }
  }, [])

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
          <LeftSidebar activeItemId={activeNavId} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((p) => !p)} onItemSelect={handleNavSelect} />

          {/* Right body: TitleBar + Content + StatusBar */}
          <div className="app-body">
            {/* 2. Title Bar */}
            <TitleBar
              tabs={tabs}
              activeTabId={activeTabId}
              url={url}
              isFavorited={isFavorited}
              canGoBack={false}
              canGoForward={false}
              onBack={() => {}}
              onForward={() => {}}
              onHome={() => setUrl('')}
              onReload={() => {}}
              onUrlChange={setUrl}
              onUrlSubmit={(u) => setUrl(u)}
              onToggleFavorite={() => setIsFavorited((p) => !p)}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              onTabAdd={handleTabAdd}
              onCloseAll={() => setTabs([])}
              onCloseRight={() => {}}
              onCloseOthers={() => {
                setTabs((prev) => prev.filter((t) => t.id === activeTabId))
              }}
              onMenuClick={(k) => console.log('Menu:', k)}
              onMinimize={() => window.electron?.ipcRenderer.send('window-minimize')}
              onMaximize={() => window.electron?.ipcRenderer.send('window-maximize')}
              onClose={() => window.electron?.ipcRenderer.send('window-close')}
            />

            {/* 3. Content area: MainContent + SnifferPanel */}
            <div className="app-content">
              <MainContent url={url} />

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
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
