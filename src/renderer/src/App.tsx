import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider, Form, Input, Modal, Select, message } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { Bookmark } from '../../shared/db/bookmark-schema'
import LeftSidebar from './components/LeftSidebar'
import type { LeftSidebarRef } from './components/LeftSidebar'
import MainContent from './components/MainContent'
import type { MainContentRef } from './components/MainContent'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import type { Tab } from './features/browser/types'
import { formatUrlInput, getTabPartition, isWebviewTab } from './features/browser/utils'
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

function getCanonicalUrl(value: string): string {
  if (!value || !value.includes('.')) return value

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    return url.origin + url.pathname
  } catch {
    return value
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
  const [allBookmarks, setAllBookmarks] = useState<any[]>([])
  const [bookmarkGroups, setBookmarkGroups] = useState<any[]>([])
  const [isBookmarkModalVisible, setIsBookmarkModalVisible] = useState(false)
  const [resourceCount, setResourceCount] = useState(0)
  const [snifferActive, setSnifferActive] = useState(false)

  const sidebarRef = useRef<LeftSidebarRef>(null)
  const mainContentRef = useRef<MainContentRef>(null)
  const [bookmarkForm] = Form.useForm()

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])

  const getActivePartition = useCallback(() => getTabPartition(activeTab), [activeTab])

  const fetchBookmarkGroups = useCallback(async () => {
    try {
      const all = (await trpc.bookmark.list.query()) as any[]
      setAllBookmarks(all)
      setBookmarkGroups(all.filter((item) => item.type === 1 && item.name !== '应用'))
    } catch (error) {
      console.error('Failed to fetch bookmark groups:', error)
    }
  }, [])

  useEffect(() => {
    void fetchBookmarkGroups()
  }, [fetchBookmarkGroups])

  const currentBookmark = useMemo(() => {
    if (!url || !url.includes('.')) return null
    const canonicalUrl = getCanonicalUrl(url)
    return allBookmarks.find((item) => item.type === 2 && item.url && getCanonicalUrl(item.url) === canonicalUrl)
  }, [allBookmarks, url])

  const isFavorited = !!currentBookmark

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

  const handleTabSelect = useCallback(
    (id: string) => {
      setActiveTabId(id)
      const tab = tabs.find((item) => item.id === id)
      setUrl(tab?.url || '')
    },
    [tabs]
  )

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const nextTabs = prev.filter((tab) => tab.id !== id)
        if (nextTabs.length === 0) {
          setActiveTabId('')
          setUrl('')
          return nextTabs
        }

        if (id === activeTabId) {
          setActiveTabId(nextTabs[0].id)
          setUrl(nextTabs[0].url || '')
        }

        return nextTabs
      })
    },
    [activeTabId]
  )

  const handleCloseOtherTabs = useCallback(() => {
    const currentTab = tabs.find((tab) => tab.id === activeTabId)
    if (!currentTab) {
      setTabs([])
      setActiveTabId('')
      setUrl('')
      return
    }

    if (tabs.length <= 1) {
      setUrl(currentTab.url || '')
      return
    }

    setUrl(currentTab.url || '')
    startTransition(() => {
      setTabs([currentTab])
    })
  }, [activeTabId, tabs])

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

  const handleToggleFavorite = useCallback(async () => {
    if (isFavorited && currentBookmark) {
      try {
        await trpc.bookmark.delete.mutate({ id: currentBookmark.id })
        message.success('已取消收藏')
        void fetchBookmarkGroups()
        sidebarRef.current?.refresh()
      } catch (error) {
        console.error('Failed to remove bookmark:', error)
        message.error('取消收藏失败')
      }
      return
    }

    bookmarkForm.setFieldsValue({
      name: activeTab?.title || '',
      url,
      parentId: bookmarkGroups[0]?.id || 0,
      userDataPath: activeTab?.userDataPath || 'default'
    })
    setIsBookmarkModalVisible(true)
  }, [activeTab, bookmarkForm, bookmarkGroups, currentBookmark, fetchBookmarkGroups, isFavorited, url])

  const handleBookmarkSubmit = useCallback(async () => {
    try {
      const values = await bookmarkForm.validateFields()
      await trpc.bookmark.create.mutate({ ...values, type: 2 })
      message.success('已添加到收藏夹')
      setIsBookmarkModalVisible(false)
      void fetchBookmarkGroups()
      sidebarRef.current?.refresh()
    } catch (error) {
      console.error('Failed to create bookmark:', error)
    }
  }, [bookmarkForm, fetchBookmarkGroups])

  const handleUrlSubmit = useCallback(
    (input: string) => {
      const formattedUrl = formatUrlInput(input.trim())
      if (!formattedUrl) return

      setUrl(formattedUrl)

      if (!activeTab || !isWebviewTab(activeTab)) {
        const nextTab: Tab = {
          id: `tab-${Date.now()}`,
          title: '新标签页',
          url: formattedUrl,
          userDataPath: 'default',
          type: 'webview'
        }
        setTabs((prev) => [...prev, nextTab])
        setActiveTabId(nextTab.id)
        return
      }

      mainContentRef.current?.loadURL(formattedUrl)
    },
    [activeTab]
  )

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
              onUrlSubmit={handleUrlSubmit}
              onToggleFavorite={handleToggleFavorite}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              onCloseAll={() => {
                setTabs([])
                setActiveTabId('')
                setUrl('')
              }}
              onCloseOthers={handleCloseOtherTabs}
              onMenuClick={(key) => console.log('Menu:', key)}
              onMinimize={() => trpc.system.minimize.mutate()}
              onMaximize={() => trpc.system.maximize.mutate()}
              onClose={() => trpc.system.close.mutate()}
            />

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

        <Modal
          title="添加收藏"
          open={isBookmarkModalVisible}
          onOk={() => void handleBookmarkSubmit()}
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
                {bookmarkGroups.map((group) => (
                  <Select.Option key={group.id} value={group.id}>
                    {group.name}
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
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
