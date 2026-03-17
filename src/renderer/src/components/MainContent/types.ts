import type { Tab } from '../../features/browser/types'

export interface MainContentProps {
  tabs: Tab[]
  activeTabId: string
  onWebviewEvent?: (tabId: string, event: any) => void
  snifferActive?: boolean
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
