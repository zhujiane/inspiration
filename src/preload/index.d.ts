import { ElectronAPI } from '@electron-toolkit/preload'

type TrpcRequest = {
  path: string
  input: unknown
  type: 'query' | 'mutation' | 'subscription'
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    trpc: {
      invoke: (payload: TrpcRequest) => Promise<any>
    }
  }
}
