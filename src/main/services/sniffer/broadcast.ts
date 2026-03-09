import { BrowserWindow } from 'electron'
import log from '../logger'
import { analyzeMedia } from '../ffmpeg'
import { formatDuration } from './utils'
import type { SnifferResource, SnifferStatsPayload } from '../../types/sniffer-types'

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

async function enrichResourceMetadata(resource: SnifferResource): Promise<SnifferResource> {
  if (resource.type === 'image') return resource
  if (resource.duration && (resource.type === 'audio' || resource.resolution || resource.thumbnailUrl)) return resource

  try {
    const meta = await analyzeMedia({
      path: resource.url,
      header: resource.requestHeaders
    })
    return {
      ...resource,
      resolution: resource.resolution || (meta.width && meta.height ? `${meta.width}×${meta.height}` : undefined),
      duration: resource.duration || (meta.duration ? formatDuration(meta.duration) : undefined),
      thumbnailUrl: resource.thumbnailUrl || meta.cover
    }
  } catch (error) {
    log.debug(`[Sniffer] Failed to enrich metadata for ${resource.url}: ${String(error)}`)
  }

  return resource
}

export function emitResource(partition: string, resource: SnifferResource): void {
  void enrichResourceMetadata(resource).then((nextResource) => {
    broadcastResource(partition, nextResource)
  })
}
