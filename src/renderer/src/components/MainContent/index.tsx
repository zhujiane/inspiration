import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { GlobalOutlined } from '@ant-design/icons'
import type { Tab } from '../TitleBar'

interface MainContentProps {
  tabs: Tab[]
  activeTabId: string
  onWebviewEvent?: (tabId: string, event: any) => void
}

export interface MainContentRef {
  goBack: () => void
  goForward: () => void
  reload: () => void
  loadURL: (url: string) => void
  getCanGoBack: () => boolean
  getCanGoForward: () => boolean
}

const MainContent = forwardRef<MainContentRef, MainContentProps>(({ tabs, activeTabId, onWebviewEvent }, ref) => {
  const webviewRefs = useRef<{ [key: string]: any }>({})

  useImperativeHandle(
    ref,
    () => ({
      goBack: () => {
        const webview = webviewRefs.current[activeTabId]
        if (webview?.canGoBack()) webview.goBack()
      },
      goForward: () => {
        const webview = webviewRefs.current[activeTabId]
        if (webview?.canGoForward()) webview.goForward()
      },
      reload: () => {
        const webview = webviewRefs.current[activeTabId]
        if (webview) webview.reload()
      },
      loadURL: (url: string) => {
        const webview = webviewRefs.current[activeTabId]
        if (webview) webview.loadURL(url)
      },
      getCanGoBack: () => {
        return webviewRefs.current[activeTabId]?.canGoBack() || false
      },
      getCanGoForward: () => {
        return webviewRefs.current[activeTabId]?.canGoForward() || false
      }
    }),
    [activeTabId]
  )

  useEffect(() => {
    // Register event listeners for all webviews
    const currentRefs = webviewRefs.current
    const handlers: { [key: string]: any } = {}

    Object.keys(currentRefs).forEach((tabId) => {
      const webview = currentRefs[tabId]
      if (!webview) return

      const handleEvent = (e: any) => {
        onWebviewEvent?.(tabId, e)
      }

      webview.addEventListener('did-start-loading', handleEvent)
      webview.addEventListener('did-stop-loading', handleEvent)
      webview.addEventListener('did-navigate', handleEvent)
      webview.addEventListener('did-navigate-in-page', handleEvent)
      webview.addEventListener('page-title-updated', handleEvent)
      webview.addEventListener('page-favicon-updated', handleEvent)

      handlers[tabId] = handleEvent
    })

    return () => {
      Object.keys(currentRefs).forEach((tabId) => {
        const webview = currentRefs[tabId]
        const handler = handlers[tabId]
        if (webview && handler) {
          webview.removeEventListener('did-start-loading', handler)
          webview.removeEventListener('did-stop-loading', handler)
          webview.removeEventListener('did-navigate', handler)
          webview.removeEventListener('did-navigate-in-page', handler)
          webview.removeEventListener('page-title-updated', handler)
          webview.removeEventListener('page-favicon-updated', handler)
        }
      })
    }
  }, [tabs, onWebviewEvent])

  if (tabs.length === 0) {
    return (
      <main className="main-content" id="main-content">
        <div className="main-content__webview-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="main-content__placeholder">
            <GlobalOutlined className="main-content__placeholder-icon" />
            <div className="main-content__placeholder-text">选择左侧导航或新建标签页开始浏览</div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="main-content" id="main-content">
      <div className="main-content__webview-container">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <webview
              key={tab.id}
              ref={(el) => {
                if (el) webviewRefs.current[tab.id] = el
              }}
              src={tab.url || 'about:blank'}
              style={{
                display: isActive ? 'flex' : 'none',
                width: '100%',
                height: '100%',
                background: '#fff'
              }}
              // 1. Persistent state support
              // Use default partition if no specific userDataPath is provided
              partition={tab.userDataPath ? `persist:${tab.userDataPath}` : 'persist:default'}
              allowpopups
            />
          )
        })}
      </div>
    </main>
  )
})

MainContent.displayName = 'MainContent'

export default MainContent
