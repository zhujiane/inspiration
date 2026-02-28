import { publicProcedure, trpc } from '@shared/routers/trpc'
import { z } from 'zod'
import { session, BrowserWindow, ipcMain } from 'electron'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import log from '../logger'
import https from 'https'
import http from 'http'
import { URL } from 'url'

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

// ─── State per webview partition ─────────────────────────────────────────────

interface SnifferState {
  active: boolean
  partition: string
  sniffedCount: number
  identifiedCount: number
  discardedCount: number
  seenUrls: Set<string>
  analyzingUrls: Set<string>
}

const snifferStates = new Map<string, SnifferState>()
// Map partition → unsubscribe function
const requestListeners = new Map<string, () => void>()

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Media URL extensions that are worth probing
 */
const MEDIA_EXTS = new Set([
  'm3u8', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'ts', 'mpd',
  'mp3', 'aac', 'ogg', 'flac', 'wav', 'm4a',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg'
])

/**
 * Noise URLs to skip quickly
 */
const SKIP_PATTERNS = [
  /\.(js|css|html|htm|json|xml|woff2?|ttf|eot|ico|txt|map)(\?|$)/i,
  /^data:/,
  /^blob:/,
  /^chrome-extension:/,
  /\/favicon\./i,
  /analytics|tracking|beacon|ping|telemetry/i
]

function mightBeMedia(url: string): boolean {
  if (!url || !url.startsWith('http')) return false
  for (const p of SKIP_PATTERNS) {
    if (p.test(url)) return false
  }
  try {
    const u = new URL(url)
    const ext = u.pathname.split('.').pop()?.toLowerCase() ?? ''
    // 1. explicit ext match
    if (MEDIA_EXTS.has(ext)) return true
    // 2. path hints
    if (/\/(video|audio|media|hls|stream|m3u8|playlist|mp4|ts|mp3)\//i.test(u.pathname)) return true
    // 3. known CDN / API patterns
    if (/\.(oss|cos|cdn|bce|myqcloud|aliyuncs)\./i.test(u.hostname)) return true
    return false
  } catch {
    return false
  }
}

/**
 * Probe a URL with ffprobe (with a 10 s timeout)
 */
function probeUrl(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ffprobe timeout')), 10_000)
    ffmpeg.ffprobe(url, (err, data) => {
      clearTimeout(t)
      if (err) reject(err)
      else resolve(data)
    })
  })
}

function parseDuration(raw: any): number {
  if (!raw || raw === 'N/A') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function formatDuration(secs: number): string {
  if (!secs) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${bytes}B`
}

/**
 * Fetch Content-Length of a URL without downloading
 */
function fetchContentLength(url: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const mod = u.protocol === 'https:' ? https : http
      const req = mod.request(url, { method: 'HEAD', timeout: 5_000 }, (res) => {
        const cl = parseInt(res.headers['content-length'] || '0', 10)
        resolve(cl || 0)
      })
      req.on('error', () => resolve(0))
      req.on('timeout', () => { req.destroy(); resolve(0) })
      req.end()
    } catch {
      resolve(0)
    }
  })
}

interface AnalyzedResource {
  id: string
  type: 'video' | 'audio' | 'image'
  url: string
  title: string
  size?: string
  resolution?: string
  duration?: string
  thumbnailUrl?: string
}

async function analyzeUrl(url: string, state: SnifferState): Promise<AnalyzedResource | null> {
  try {
    const metadata = await probeUrl(url)
    const videoStreams = metadata.streams?.filter((s: any) => s.codec_type === 'video') ?? []
    const audioStreams = metadata.streams?.filter((s: any) => s.codec_type === 'audio') ?? []
    const duration = parseDuration(metadata.format?.duration)
    const formatName: string = metadata.format?.format_name ?? ''

    const IMAGE_FORMATS = new Set(['image2', 'png_pipe', 'jpeg_pipe', 'mjpeg', 'gif', 'webp_pipe', 'bmp_pipe'])
    const isImage = IMAGE_FORMATS.has(formatName) || videoStreams.some((s: any) => s.codec_name === 'mjpeg' && duration === 0)

    let type: 'video' | 'audio' | 'image' | 'other' = 'other'
    if (isImage && videoStreams.length === 1) {
      type = 'image'
    } else if (videoStreams.length > 0 && duration > 0) {
      type = 'video'
    } else if (audioStreams.length > 0 && videoStreams.length === 0) {
      type = 'audio'
    }

    if (type === 'other') return null

    state.identifiedCount++

    // Build resource
    const videoStream = videoStreams[0]
    const sizePx = videoStream ? `${videoStream.width}×${videoStream.height}` : undefined

    // Get file size via HEAD
    const bytes = await fetchContentLength(url)

    // Extract filename from URL
    let title = ''
    try {
      const u = new URL(url)
      title = u.pathname.split('/').pop() || u.hostname
      if (title.length > 40) title = title.slice(0, 40)
    } catch {
      title = url.slice(0, 40)
    }

    return {
      id: `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      url,
      title,
      size: bytes ? formatSize(bytes) : undefined,
      resolution: sizePx,
      duration: duration ? formatDuration(duration) : undefined
    }
  } catch {
    state.discardedCount++
    return null
  }
}

// ─── Send event to all renderer windows ──────────────────────────────────────

function broadcast(channel: string, payload: any) {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function broadcastStats(partition: string) {
  const st = snifferStates.get(partition)
  if (!st) return
  broadcast('sniffer:stats', {
    partition,
    sniffedCount: st.sniffedCount,
    identifiedCount: st.identifiedCount,
    discardedCount: st.discardedCount,
    active: st.active
  })
}

// ─── Start / Stop interception ────────────────────────────────────────────────

function startInterception(partition: string) {
  stopInterception(partition)

  const ses = session.fromPartition(partition)
  const state: SnifferState = {
    active: true,
    partition,
    sniffedCount: 0,
    identifiedCount: 0,
    discardedCount: 0,
    seenUrls: new Set(),
    analyzingUrls: new Set()
  }
  snifferStates.set(partition, state)

  const onBeforeSendHeaders = (
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (response: Electron.BeforeSendResponse) => void
  ) => {
    callback({ requestHeaders: details.requestHeaders })
    const url = details.url
    if (!mightBeMedia(url) || state.seenUrls.has(url) || state.analyzingUrls.has(url)) return
    state.seenUrls.add(url)
    state.sniffedCount++
    broadcastStats(partition)
    state.analyzingUrls.add(url)
    analyzeUrl(url, state).then((resource) => {
      state.analyzingUrls.delete(url)
      broadcastStats(partition)
      if (resource) {
        broadcast('sniffer:resource', { partition, resource })
      }
    }).catch(() => {
      state.analyzingUrls.delete(url)
    })
  }

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, onBeforeSendHeaders)

  requestListeners.set(partition, () => {
    try {
      // Passing null removes the listener
      ses.webRequest.onBeforeSendHeaders(null as any)
    } catch { /* ignore */ }
  })

  log.info(`[Sniffer] Started interception for partition: ${partition}`)
  broadcastStats(partition)
}

function stopInterception(partition: string) {
  const unsubscribe = requestListeners.get(partition)
  if (unsubscribe) {
    unsubscribe()
    requestListeners.delete(partition)
  }
  const state = snifferStates.get(partition)
  if (state) {
    state.active = false
    broadcastStats(partition)
  }
  log.info(`[Sniffer] Stopped interception for partition: ${partition}`)
}

// ─── IPC for HTML scan results ────────────────────────────────────────────────
// The renderer sends a list of candidate URLs found in the DOM, and we analyze them

ipcMain.handle('sniffer:scan-urls', async (_event, { partition, urls }: { partition: string; urls: string[] }) => {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const candidateUrls = (urls as string[]).filter((u) => {
    if (!mightBeMedia(u)) return false
    if (state.seenUrls.has(u)) return false
    return true
  })

  for (const url of candidateUrls) {
    if (state.seenUrls.has(url) || state.analyzingUrls.has(url)) continue
    state.seenUrls.add(url)
    state.sniffedCount++
    broadcastStats(partition)
    state.analyzingUrls.add(url)
    analyzeUrl(url, state).then((resource) => {
      state.analyzingUrls.delete(url)
      broadcastStats(partition)
      if (resource) {
        broadcast('sniffer:resource', { partition, resource })
      }
    }).catch(() => {
      state.analyzingUrls.delete(url)
    })
  }
})

// ─── tRPC router ─────────────────────────────────────────────────────────────

export const snifferRouter = trpc.router({
  start: publicProcedure
    .input(z.object({ partition: z.string() }))
    .mutation(({ input }) => {
      startInterception(input.partition)
      return { success: true }
    }),

  stop: publicProcedure
    .input(z.object({ partition: z.string() }))
    .mutation(({ input }) => {
      stopInterception(input.partition)
      return { success: true }
    }),

  reset: publicProcedure
    .input(z.object({ partition: z.string() }))
    .mutation(({ input }) => {
      const state = snifferStates.get(input.partition)
      if (state) {
        state.sniffedCount = 0
        state.identifiedCount = 0
        state.discardedCount = 0
        state.seenUrls.clear()
        state.analyzingUrls.clear()
        broadcastStats(input.partition)
      }
      return { success: true }
    }),

  getStats: publicProcedure
    .input(z.object({ partition: z.string() }))
    .query(({ input }) => {
      const state = snifferStates.get(input.partition)
      if (!state) return { active: false, sniffedCount: 0, identifiedCount: 0, discardedCount: 0 }
      return {
        active: state.active,
        sniffedCount: state.sniffedCount,
        identifiedCount: state.identifiedCount,
        discardedCount: state.discardedCount
      }
    })
})
