export type TabType = 'webview' | 'resource' | 'system'

export interface Tab {
  id: string
  title: string
  url?: string
  favicon?: string
  userDataPath?: string
  type?: TabType
}
