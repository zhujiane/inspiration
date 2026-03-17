import { useEffect } from 'react'
import type { Tab } from '../../features/browser/types'
import { getTabPartition } from '../../features/browser/utils'

interface WebviewPaneProps {
  active: boolean
  tab: Tab
  src: string
  snifferActive: boolean
  webviewRef: (element: Electron.WebviewTag | null) => void
  onWebviewEvent?: (tabId: string, event: any) => void
  onScanRequested?: () => void
}

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

function isBilibiliUrl(url: string): boolean {
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

export default function WebviewPane({
  active,
  tab,
  src,
  snifferActive,
  webviewRef,
  onWebviewEvent,
  onScanRequested
}: WebviewPaneProps): React.JSX.Element {
  useEffect(() => {
    const webview = document.querySelector(`webview[data-tab-id="${tab.id}"]`) as Electron.WebviewTag | null
    if (!webview?.addEventListener) return

    const handleEvent = (event: any) => onWebviewEvent?.(tab.id, event)
    const handleDomReady = () => {
      const currentUrl = webview.getURL?.() || ''
      if (!isBilibiliUrl(currentUrl)) return
      webview.executeJavaScript(BILIBILI_NAVIGATION_PATCH).catch(() => {})
    }

    webview.addEventListener('did-start-loading', handleEvent)
    webview.addEventListener('did-stop-loading', handleEvent)
    webview.addEventListener('did-navigate', handleEvent)
    webview.addEventListener('did-navigate-in-page', handleEvent)
    webview.addEventListener('page-title-updated', handleEvent)
    webview.addEventListener('page-favicon-updated', handleEvent)
    webview.addEventListener('dom-ready', handleDomReady)

    return () => {
      webview.removeEventListener('did-start-loading', handleEvent)
      webview.removeEventListener('did-stop-loading', handleEvent)
      webview.removeEventListener('did-navigate', handleEvent)
      webview.removeEventListener('did-navigate-in-page', handleEvent)
      webview.removeEventListener('page-title-updated', handleEvent)
      webview.removeEventListener('page-favicon-updated', handleEvent)
      webview.removeEventListener('dom-ready', handleDomReady)
    }
  }, [onWebviewEvent, tab.id])

  useEffect(() => {
    if (!active || !snifferActive) return

    const webview = document.querySelector(`webview[data-tab-id="${tab.id}"]`) as Electron.WebviewTag | null
    if (!webview?.addEventListener) return

    const handleStopLoading = () => {
      window.setTimeout(() => onScanRequested?.(), 500)
    }

    webview.addEventListener('did-stop-loading', handleStopLoading)
    return () => {
      webview.removeEventListener('did-stop-loading', handleStopLoading)
    }
  }, [active, onScanRequested, snifferActive, tab.id])

  return (
    <webview
      ref={webviewRef}
      data-tab-id={tab.id}
      src={src}
      style={{
        display: active ? 'flex' : 'none',
        width: '100%',
        height: '100%',
        background: '#fff'
      }}
      partition={getTabPartition(tab)}
      allowpopups
    />
  )
}
