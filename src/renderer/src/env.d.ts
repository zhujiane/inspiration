/// <reference types="vite/client" />

interface Window {
  trpc: {
    invoke: (payload: { path: string; input: unknown; type: 'query' | 'mutation' | 'subscription' }) => Promise<any>
  }
  snifferBridge?: {
    scanUrls: (partition: string, urls: string[]) => Promise<void>
    onResource: (cb: (data: any) => void) => () => void
    onStats: (cb: (data: any) => void) => () => void
  }
}
