import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    // 自定义 tRPC 桥接
    contextBridge.exposeInMainWorld('trpc', {
      invoke: (channel: string, payload: any) => ipcRenderer.invoke(channel, payload)
    })
    // Sniffer IPC bridge
    contextBridge.exposeInMainWorld('snifferBridge', {
      // Renderer → Main: send DOM-scanned URLs
      scanUrls: (partition: string, urls: string[]) =>
        ipcRenderer.invoke('sniffer:scan-urls', { partition, urls }),
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
      }
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore
  window.trpc = {
    invoke: (channel: string, payload: any) => ipcRenderer.invoke(channel, payload)
  }
  // @ts-ignore
  window.snifferBridge = {
    scanUrls: (partition: string, urls: string[]) =>
      ipcRenderer.invoke('sniffer:scan-urls', { partition, urls }),
    onResource: (cb: (data: any) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('sniffer:resource', handler)
      return () => ipcRenderer.removeListener('sniffer:resource', handler)
    },
    onStats: (cb: (data: any) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('sniffer:stats', handler)
      return () => ipcRenderer.removeListener('sniffer:stats', handler)
    }
  }
}
