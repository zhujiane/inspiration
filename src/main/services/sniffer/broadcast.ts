import { BrowserWindow } from 'electron'
import type { SnifferDownloadProgressPayload, SnifferResource, SnifferStatsPayload } from '../../types/sniffer-types'

export function broadcast(channel: string, payload: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function broadcastStats(payload: SnifferStatsPayload): void {
  broadcast('sniffer:stats', payload)
}

export function broadcastResource(partition: string, resource: SnifferResource): void {
  broadcast('sniffer:resource', { partition, resource })
}

export function broadcastDownloadProgress(payload: SnifferDownloadProgressPayload): void {
  broadcast('sniffer:download-progress', payload)
}

export function emitResource(partition: string, resource: SnifferResource): void {
  broadcastResource(partition, resource)
}
