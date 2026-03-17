import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { GlobalOutlined } from '@ant-design/icons'
import PageView from './PageView'
import WebviewPane from './WebviewPane'
import type { MainContentProps, MainContentRef } from './types'
import { isWebviewTab } from '../../features/browser/utils'

const MainContent = forwardRef<MainContentRef, MainContentProps>(
  ({ tabs, activeTabId, onWebviewEvent, snifferActive = false }, ref) => {
    const webviewRefs = useRef<Record<string, Electron.WebviewTag | null>>({})
    const initialSrcRefs = useRef<Record<string, string>>({})

    const scanPageResources = () => {}

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
          webviewRefs.current[activeTabId]?.reload?.()
        },
        loadURL: (url: string) => {
          webviewRefs.current[activeTabId]?.loadURL?.(url)
        },
        getCanGoBack: () => webviewRefs.current[activeTabId]?.canGoBack?.() || false,
        getCanGoForward: () => webviewRefs.current[activeTabId]?.canGoForward?.() || false,
        scanPageResources
      }),
      [activeTabId]
    )

    useEffect(() => {
      const activeTabIds = new Set(tabs.map((tab) => tab.id))

      Object.keys(initialSrcRefs.current).forEach((tabId) => {
        if (!activeTabIds.has(tabId)) {
          delete initialSrcRefs.current[tabId]
          delete webviewRefs.current[tabId]
        }
      })
    }, [tabs])

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

    return (
      <main className="main-content" id="main-content">
        <div className="main-content__webview-container">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId

            if (!isWebviewTab(tab)) {
              return <PageView key={tab.id} active={active} tab={tab} />
            }

            if (!(tab.id in initialSrcRefs.current)) {
              initialSrcRefs.current[tab.id] = tab.url || 'about:blank'
            }

            return (
              <WebviewPane
                key={tab.id}
                active={active}
                tab={tab}
                src={initialSrcRefs.current[tab.id]}
                snifferActive={active && snifferActive}
                webviewRef={(element) => {
                  webviewRefs.current[tab.id] = element
                }}
                onWebviewEvent={onWebviewEvent}
                onScanRequested={scanPageResources}
              />
            )
          })}
        </div>
      </main>
    )
  }
)

MainContent.displayName = 'MainContent'

export type { MainContentProps, MainContentRef } from './types'

export default MainContent
