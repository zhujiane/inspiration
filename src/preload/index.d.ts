import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    trpc: {
      invoke: (channel: string, payload: any) => Promise<any>
    }
  }
}
