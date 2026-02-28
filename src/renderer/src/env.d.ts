/// <reference types="vite/client" />

interface Window {
  snifferBridge?: {
    scanUrls: (partition: string, urls: string[]) => Promise<void>
    onResource: (cb: (data: any) => void) => () => void
    onStats: (cb: (data: any) => void) => () => void
  }
}
