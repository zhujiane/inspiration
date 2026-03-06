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

const BILIBILI_NAVIGATION_PATCH = `
(() => {
  if ((window).__inspirationBilibiliPatchInstalled) return
  ;(window).__inspirationBilibiliPatchInstalled = true

  const toAbsoluteUrl = (value) => {
    try {
      return new URL(value, window.location.href).toString()
    } catch {
      return ''
    }
  }

  const shouldHandleAnchor = (anchor, event) => {
    if (!anchor) return false
    if (event.defaultPrevented) return false
    if (event.button !== 0) return false
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return false
    if (anchor.hasAttribute('download')) return false

    const target = (anchor.getAttribute('target') || '').toLowerCase()
    const rel = (anchor.getAttribute('rel') || '').toLowerCase()
    return target === '_blank' || rel.includes('noopener') || rel.includes('noreferrer')
  }

  document.addEventListener(
    'click',
    (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!shouldHandleAnchor(anchor, event)) return

      const nextUrl = toAbsoluteUrl(anchor.href)
      if (!nextUrl) return

      event.preventDefault()
      event.stopPropagation()
      window.location.href = nextUrl
    },
    true
  )

  const nativeWindowOpen = window.open.bind(window)
  window.open = (url, target, features) => {
    const nextUrl = typeof url === 'string' ? toAbsoluteUrl(url) : ''
    if (nextUrl) {
      window.location.href = nextUrl
      return null
    }
    return nativeWindowOpen(url, target, features)
  }
})()
`

const isBilibiliUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url)
    return (
      hostname === 'b23.tv' ||
      hostname === 'b23.wtf' ||
      hostname.endsWith('.bilibili.com') ||
      hostname === 'bilibili.com'
    )
  } catch {
    return false
  }
}

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
    const initialSrcRefs = useRef<{ [key: string]: string }>({})

    const scanPageResources = () => {
      const webview = webviewRefs.current[activeTabId]
      if (!webview?.executeJavaScript) return
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const partition = activeTab?.userDataPath ? `persist:${activeTab.userDataPath}` : 'persist:default'

      webview
        .executeJavaScript(DOM_SCAN_SCRIPT)
        .then((urls: string[]) => {
          if (!urls || urls.length === 0) return
          ;(window as any).snifferBridge?.scanUrls(partition, urls)
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
      const activeTabIds = new Set(tabs.map((tab) => tab.id))
      Object.keys(initialSrcRefs.current).forEach((tabId) => {
        if (!activeTabIds.has(tabId)) {
          delete initialSrcRefs.current[tabId]
        }
      })
    }, [tabs])

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

        const handleDomReady = () => {
          const currentUrl = webview.getURL?.() || ''
          if (!isBilibiliUrl(currentUrl)) return
          webview.executeJavaScript(BILIBILI_NAVIGATION_PATCH).catch(() => {
            /* ignore */
          })
        }

        webview.addEventListener('did-start-loading', handleEvent)
        webview.addEventListener('did-stop-loading', handleEvent)
        webview.addEventListener('did-navigate', handleEvent)
        webview.addEventListener('did-navigate-in-page', handleEvent)
        webview.addEventListener('page-title-updated', handleEvent)
        webview.addEventListener('page-favicon-updated', handleEvent)
        webview.addEventListener('dom-ready', handleDomReady)

        handlers[tabId] = { handleEvent, handleDomReady }
      })

      return () => {
        Object.keys(currentRefs).forEach((tabId) => {
          const webview = currentRefs[tabId]
          const handler = handlers[tabId]
          if (webview && handler && webview.removeEventListener) {
            webview.removeEventListener('did-start-loading', handler.handleEvent)
            webview.removeEventListener('did-stop-loading', handler.handleEvent)
            webview.removeEventListener('did-navigate', handler.handleEvent)
            webview.removeEventListener('did-navigate-in-page', handler.handleEvent)
            webview.removeEventListener('page-title-updated', handler.handleEvent)
            webview.removeEventListener('page-favicon-updated', handler.handleEvent)
            webview.removeEventListener('dom-ready', handler.handleDomReady)
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

            if (!(tab.id in initialSrcRefs.current)) {
              initialSrcRefs.current[tab.id] = tab.url || 'about:blank'
            }

            return (
              <webview
                key={tab.id}
                ref={(el) => {
                  if (el) webviewRefs.current[tab.id] = el
                }}
                // Keep the initial src stable after mount. Some sites update the URL
                // with pushState while staying on the same document (for example, modal routes).
                // Rebinding src to the latest tab.url would force a top-level navigation.
                src={initialSrcRefs.current[tab.id]}
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
