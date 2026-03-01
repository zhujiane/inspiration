import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { GlobalOutlined } from '@ant-design/icons'
import type { Tab } from '../TitleBar'
import ResourcePage from '../../pages/resource'
import SetupPage from '../../pages/config'
import FloatingCompass from '../FloatingCompass'

interface MainContentProps {
  tabs: Tab[]
  activeTabId: string
  onWebviewEvent?: (tabId: string, event: any) => void
  snifferActive?: boolean
  snifferPartition?: string
  onSnifferStart?: () => void
  onSnifferStop?: () => void
  onSnifferRefresh?: () => void
  onSnifferConfig?: () => void
}

export interface MainContentRef {
  goBack: () => void
  goForward: () => void
  reload: () => void
  loadURL: (url: string) => void
  getCanGoBack: () => boolean
  getCanGoForward: () => boolean
  scanPageResources: () => void
}

/**
 * Generates a JavaScript snippet that scans the current page DOM
 * and returns all candidate media URLs in an array.
 */
const DOM_SCAN_SCRIPT = `
(function() {
  const urls = new Set();
  // <video src>, <audio src>, <source src>
  document.querySelectorAll('video, audio, source, track').forEach(el => {
    if (el.src) urls.add(el.src);
    if (el.currentSrc) urls.add(el.currentSrc);
  });
  // <img src>
  document.querySelectorAll('img').forEach(el => {
    if (el.src && el.src.startsWith('http')) urls.add(el.src);
    if (el.dataset.src) urls.add(el.dataset.src);
  });
  // background-image inline styles
  document.querySelectorAll('[style]').forEach(el => {
    const m = el.style.backgroundImage.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
    if (m && m[1].startsWith('http')) urls.add(m[1]);
  });
  // Scripts / meta: look for m3u8/mp4 in all script text
  document.querySelectorAll('script:not([src])').forEach(scr => {
    const matches = scr.textContent.matchAll(/https?:[^'"\`\\s]+\\.(m3u8|mp4|webm|mkv|mp3|aac|flac|ts|mpd)[^'"\`\\s]*/gi);
    for (const m of matches) urls.add(m[0]);
  });
  return [...urls].filter(u => u.startsWith('http'));
})()
`

const MainContent = forwardRef<MainContentRef, MainContentProps>(
  (
    {
      tabs,
      activeTabId,
      onWebviewEvent,
      snifferActive = false,
      onSnifferStart,
      onSnifferStop,
      onSnifferRefresh,
      onSnifferConfig
    },
    ref
  ) => {
    const webviewRefs = useRef<{ [key: string]: any }>({})

    const scanPageResources = () => {
      const webview = webviewRefs.current[activeTabId]
      if (!webview?.executeJavaScript) return
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const partition = activeTab?.userDataPath ? `persist:${activeTab.userDataPath}` : 'persist:default'

      webview
        .executeJavaScript(DOM_SCAN_SCRIPT)
        .then((urls: string[]) => {
          if (!urls || urls.length === 0) return
            ; (window as any).snifferBridge?.scanUrls(partition, urls)
        })
        .catch(() => {
          /* ignore */
        })
    }

    useImperativeHandle(
      ref,
      () => ({
        goBack: () => {
          const webview = webviewRefs.current[activeTabId]
          if (webview?.canGoBack?.()) webview.goBack()
        },
        goForward: () => {
          const webview = webviewRefs.current[activeTabId]
          if (webview?.canGoForward?.()) webview.goForward()
        },
        reload: () => {
          const webview = webviewRefs.current[activeTabId]
          if (webview?.reload) webview.reload()
        },
        loadURL: (url: string) => {
          const webview = webviewRefs.current[activeTabId]
          if (webview?.loadURL) webview.loadURL(url)
        },
        getCanGoBack: () => {
          return webviewRefs.current[activeTabId]?.canGoBack?.() || false
        },
        getCanGoForward: () => {
          return webviewRefs.current[activeTabId]?.canGoForward?.() || false
        },
        scanPageResources
      }),
      [activeTabId, tabs]
    )

    useEffect(() => {
      // Register event listeners for all webviews
      const currentRefs = webviewRefs.current
      const handlers: { [key: string]: any } = {}

      Object.keys(currentRefs).forEach((tabId) => {
        const webview = currentRefs[tabId]
        if (!webview || !webview.addEventListener) return

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
          if (webview && handler && webview.removeEventListener) {
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

    // When sniffer is active and page finishes loading, auto-scan
    useEffect(() => {
      if (!snifferActive) return
      const webview = webviewRefs.current[activeTabId]
      if (!webview || !webview.addEventListener) return

      const onStopLoading = () => {
        setTimeout(() => scanPageResources(), 500)
      }

      webview.addEventListener('did-stop-loading', onStopLoading)
      return () => {
        webview.removeEventListener('did-stop-loading', onStopLoading)
      }
    }, [snifferActive, activeTabId, tabs])

    if (tabs.length === 0) {
      return (
        <main className="main-content" id="main-content">
          <div
            className="main-content__webview-container"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div className="main-content__placeholder">
              <GlobalOutlined className="main-content__placeholder-icon" />
              <div className="main-content__placeholder-text">选择左侧导航或新建标签页开始浏览</div>
            </div>
          </div>
        </main>
      )
    }

    const activeTab = tabs.find((t) => t.id === activeTabId)
    const isWebviewActive = activeTab?.type !== 'resource' && activeTab?.type !== 'system'

    return (
      <main className="main-content" id="main-content">
        <div className="main-content__webview-container">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId

            if (tab.type === 'resource') {
              return (
                <div
                  key={tab.id}
                  style={{ display: isActive ? 'block' : 'none', height: '100%', width: '100%', overflow: 'auto' }}
                >
                  <ResourcePage />
                </div>
              )
            }

            if (tab.type === 'system') {
              return (
                <div
                  key={tab.id}
                  style={{ display: isActive ? 'block' : 'none', height: '100%', width: '100%', overflow: 'auto' }}
                >
                  <SetupPage />
                </div>
              )
            }

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

        {/* Floating Compass — overlays the active webview */}
        {isWebviewActive && (
          <FloatingCompass
            active={snifferActive}
            onStart={() => onSnifferStart?.()}
            onStop={() => onSnifferStop?.()}
            onRefresh={() => {
              scanPageResources()
              onSnifferRefresh?.()
            }}
            onConfig={() => onSnifferConfig?.()}
          />
        )}
      </main>
    )
  }
)

MainContent.displayName = 'MainContent'

export default MainContent
