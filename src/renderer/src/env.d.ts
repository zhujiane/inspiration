/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface Window {
  trpc: {
    invoke: (payload: { path: string; input: unknown; type: 'query' | 'mutation' | 'subscription' }) => Promise<any>
  }
  snifferBridge?: {
    onResource: (cb: (data: any) => void) => () => void
    onStats: (cb: (data: any) => void) => () => void
    onDownloadProgress: (cb: (data: any) => void) => () => void
  }
}
