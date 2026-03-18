import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { Bookmark } from '../../shared/db/bookmark-schema'
import LeftSidebar from './components/LeftSidebar'
import type { LeftSidebarRef } from './components/LeftSidebar'
import MainContent from './components/MainContent'
import type { MainContentRef } from './components/MainContent'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import BookmarkModal from './features/browser/title-bar/BookmarkModal'
import type { TitleBarBookmark } from './features/browser/title-bar/types'
import type { Tab } from './features/browser/types'
import { useTitleBarController } from './features/browser/title-bar/useTitleBarController'
import { getCanonicalUrl, getTabPartition } from './features/browser/utils'
import SnifferWorkspace from './features/sniffer/SnifferWorkspace'
import { trpc } from './lib/trpc'

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

function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [url, setUrl] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeNavId, setActiveNavId] = useState<string | number>('')
  const [allBookmarks, setAllBookmarks] = useState<TitleBarBookmark[]>([])
  const [bookmarkGroups, setBookmarkGroups] = useState<TitleBarBookmark[]>([])
  const [resourceCount, setResourceCount] = useState(0)
  const [snifferActive, setSnifferActive] = useState(false)

  const sidebarRef = useRef<LeftSidebarRef>(null)
  const mainContentRef = useRef<MainContentRef>(null)

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])

  const getActivePartition = useCallback(() => getTabPartition(activeTab), [activeTab])

  const fetchBookmarkGroups = useCallback(async () => {
    try {
      const all = (await trpc.bookmark.list.query()) as TitleBarBookmark[]
      setAllBookmarks(all)
      setBookmarkGroups(all.filter((item) => item.type === 1 && item.name !== '应用'))
    } catch (error) {
      console.error('Failed to fetch bookmark groups:', error)
    }
  }, [])

  useEffect(() => {
    void fetchBookmarkGroups()
  }, [fetchBookmarkGroups])

  const { titleBarProps, bookmarkModalProps } = useTitleBarController({
    tabs,
    activeTab,
    activeTabId,
    url,
    canGoBack,
    canGoForward,
    allBookmarks,
    bookmarkGroups,
    setTabs,
    setActiveTabId,
    setUrl,
    fetchBookmarkGroups,
    mainContentRef,
    sidebarRef
  })

  const handleWebviewEvent = useCallback(
    (tabId: string, event: any) => {
      if (tabId !== activeTabId) return

      setCanGoBack(mainContentRef.current?.getCanGoBack() || false)
      setCanGoForward(mainContentRef.current?.getCanGoForward() || false)

      switch (event.type) {
        case 'did-navigate':
        case 'did-navigate-in-page':
          setUrl(event.url)
          setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, url: event.url } : tab)))
          break
        case 'page-title-updated':
          setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, title: event.title } : tab)))
          break
        case 'page-favicon-updated':
          if (!event.favicons?.length) break

          const favicon = event.favicons[0]
          setTabs((prev) =>
            prev.map((tab) => {
              if (tab.id !== tabId) return tab
              if (tab.favicon?.startsWith('data:image')) return tab
              return { ...tab, favicon }
            })
          )

          if (!activeTab?.url) break
          const bookmark = allBookmarks.find(
            (item) => item.type === 2 && item.url && getCanonicalUrl(item.url) === getCanonicalUrl(activeTab.url || '')
          )

          if (!bookmark || (bookmark.icon && bookmark.icon.startsWith('data:image'))) break

          fetch(favicon)
            .then((res) => res.blob())
            .then((blob) => {
              const reader = new FileReader()
              reader.onloadend = () => {
                const base64 = reader.result as string
                if (!base64?.startsWith('data:image')) return

                trpc.bookmark.update
                  .mutate({ id: bookmark.id, icon: base64 })
                  .then(() => {
                    void fetchBookmarkGroups()
                    sidebarRef.current?.refresh()
                  })
                  .catch((error) => console.error('Failed to save favicon to DB:', error))
              }
              reader.readAsDataURL(blob)
            })
            .catch(() => {})
          break
      }
    },
    [activeTab, activeTabId, allBookmarks, fetchBookmarkGroups]
  )

  const handleNavSelect = useCallback((item: Bookmark) => {
    setActiveNavId(item.id)

    if (item.type === 3) {
      if (item.name === '素材管理' || item.name === '素材中心') {
        setTabs((prev) => {
          const existing = prev.find((tab) => tab.type === 'resource')
          if (existing) {
            setActiveTabId(existing.id)
            return prev
          }

          const nextTab: Tab = { id: 'tab-resource', title: '素材管理', type: 'resource' }
          setActiveTabId(nextTab.id)
          return [...prev, nextTab]
        })
        return
      }

      if (item.name === '系统配置' || item.name === '系统初始化') {
        setTabs((prev) => {
          const existing = prev.find((tab) => tab.type === 'system')
          if (existing) {
            setActiveTabId(existing.id)
            return prev
          }

          const nextTab: Tab = { id: 'tab-system', title: '系统配置', type: 'system' }
          setActiveTabId(nextTab.id)
          return [...prev, nextTab]
        })
        return
      }
    }

    if (!item.url) return

    const dbFavicon = item.icon?.startsWith('data:image') ? item.icon : undefined
    setUrl(item.url)

    setTabs((prev) => {
      const existing = prev.find((tab) => tab.url === item.url)
      if (existing) {
        setActiveTabId(existing.id)
        if (dbFavicon && !existing.favicon?.startsWith('data:image')) {
          return prev.map((tab) => (tab.id === existing.id ? { ...tab, favicon: dbFavicon } : tab))
        }
        return prev
      }

      const nextTab: Tab = {
        id: `tab-${Date.now()}`,
        title: item.name,
        url: item.url || undefined,
        userDataPath: item.userDataPath || 'default',
        type: 'webview',
        favicon: dbFavicon
      }
      setActiveTabId(nextTab.id)
      return [...prev, nextTab]
    })
  }, [])

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <AntdApp style={{ height: '100%' }}>
        <div className="app-shell">
          <LeftSidebar
            ref={sidebarRef}
            activeItemId={activeNavId}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((prev) => !prev)}
            onItemSelect={handleNavSelect}
            onUpdate={fetchBookmarkGroups}
          />

          <div className="app-body">
            <TitleBar {...titleBarProps} />

            <div className="app-content">
              <MainContent
                ref={mainContentRef}
                tabs={tabs}
                activeTabId={activeTabId}
                onWebviewEvent={handleWebviewEvent}
                snifferActive={snifferActive}
              />

              <SnifferWorkspace
                activeTab={activeTab}
                getActivePartition={getActivePartition}
                scanPageResources={() => mainContentRef.current?.scanPageResources()}
                onResourceCountChange={setResourceCount}
                onActiveStateChange={setSnifferActive}
              />
            </div>

            <StatusBar status="connected" resourceCount={resourceCount} currentUrl={url} />
          </div>
        </div>

        <BookmarkModal {...bookmarkModalProps} />
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
