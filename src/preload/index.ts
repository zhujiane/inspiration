import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}
type TrpcRequest = { path: string; input: unknown; type: 'query' | 'mutation' | 'subscription' }

const trpcBridge = {
  invoke: (payload: TrpcRequest) => ipcRenderer.invoke('trpc-request', payload)
}

const snifferBridge = {
  // Main → Renderer: listen for new resources
  onResource: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('sniffer:resource', handler)
    return () => ipcRenderer.removeListener('sniffer:resource', handler)
  },
  // Main → Renderer: listen for stats updates
  onStats: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('sniffer:stats', handler)
    return () => ipcRenderer.removeListener('sniffer:stats', handler)
  },
  // Main → Renderer: listen for download / merge progress updates
  onDownloadProgress: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('sniffer:download-progress', handler)
    return () => ipcRenderer.removeListener('sniffer:download-progress', handler)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('trpc', trpcBridge)
    contextBridge.exposeInMainWorld('snifferBridge', snifferBridge)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore
  window.trpc = trpcBridge
  // @ts-ignore
  window.snifferBridge = snifferBridge
}
