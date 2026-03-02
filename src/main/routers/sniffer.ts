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

const MAX_CONCURRENT_ANALYZE = 4
const MAX_SEEN_URLS = 2000

interface SnifferState {
  active: boolean
  partition: string
  sniffedCount: number
  identifiedCount: number
  discardedCount: number
  seenUrls: Set<string>
  seenOrder: string[]
  analyzingUrls: Set<string>
  pendingUrls: string[]
  runningCount: number
}

export interface SnifferStatsPayload {
  partition: string
  active: boolean
  sniffedCount: number
  identifiedCount: number
  discardedCount: number
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

const snifferStates = new Map<string, SnifferState>()
const listenedPartitions = new Set<string>()

const MEDIA_EXTS = new Set([
  'm3u8',
  'mp4',
  'webm',
  'mkv',
  'avi',
  'mov',
  'flv',
  'ts',
  'mpd',
  'mp3',
  'aac',
  'ogg',
  'flac',
  'wav',
  'm4a',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'avif',
  'svg'
])

const IMAGE_FORMATS = new Set(['image2', 'png_pipe', 'jpeg_pipe', 'mjpeg', 'gif', 'webp_pipe', 'bmp_pipe'])

const SKIP_PATTERNS = [
  /\.(js|css|html|htm|json|xml|woff2?|ttf|eot|ico|txt|map)(\?|$)/i,
  /^data:/,
  /^blob:/,
  /^chrome-extension:/,
  /\/favicon\./i,
  /analytics|tracking|beacon|ping|telemetry/i
]

function createState(partition: string): SnifferState {
  return {
    active: true,
    partition,
    sniffedCount: 0,
    identifiedCount: 0,
    discardedCount: 0,
    seenUrls: new Set(),
    seenOrder: [],
    analyzingUrls: new Set(),
    pendingUrls: [],
    runningCount: 0
  }
}

function statsOf(state?: SnifferState, partition?: string): SnifferStatsPayload {
  return {
    partition: state?.partition ?? partition ?? '',
    active: state?.active ?? false,
    sniffedCount: state?.sniffedCount ?? 0,
    identifiedCount: state?.identifiedCount ?? 0,
    discardedCount: state?.discardedCount ?? 0
  }
}

function mightBeMedia(url: string): boolean {
  if (!url || !url.startsWith('http')) return false
  for (const p of SKIP_PATTERNS) {
    if (p.test(url)) return false
  }
  try {
    const u = new URL(url)
    const ext = u.pathname.split('.').pop()?.toLowerCase() ?? ''
    if (MEDIA_EXTS.has(ext)) return true
    if (/\/(video|audio|media|hls|stream|m3u8|playlist|mp4|ts|mp3)\//i.test(u.pathname)) return true
    if (/\.(oss|cos|cdn|bce|myqcloud|aliyuncs)\./i.test(u.hostname)) return true
    return false
  } catch {
    return false
  }
}

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
      req.on('timeout', () => {
        req.destroy()
        resolve(0)
      })
      req.end()
    } catch {
      resolve(0)
    }
  })
}

async function analyzeUrl(url: string, state: SnifferState): Promise<AnalyzedResource | null> {
  try {
    const metadata = await probeUrl(url)
    const videoStreams = metadata.streams?.filter((s: any) => s.codec_type === 'video') ?? []
    const audioStreams = metadata.streams?.filter((s: any) => s.codec_type === 'audio') ?? []
    const duration = parseDuration(metadata.format?.duration)
    const formatName: string = metadata.format?.format_name ?? ''

    const isImage =
      IMAGE_FORMATS.has(formatName) || videoStreams.some((s: any) => s.codec_name === 'mjpeg' && duration === 0)

    let type: 'video' | 'audio' | 'image' | 'other' = 'other'
    if (isImage && videoStreams.length === 1) type = 'image'
    else if (videoStreams.length > 0 && duration > 0) type = 'video'
    else if (audioStreams.length > 0 && videoStreams.length === 0) type = 'audio'

    if (type === 'other') return null

    state.identifiedCount++

    const videoStream = videoStreams[0]
    const sizePx = videoStream ? `${videoStream.width}×${videoStream.height}` : undefined
    const bytes = await fetchContentLength(url)

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

function broadcast(channel: string, payload: any): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function broadcastStats(partition: string, state?: SnifferState): void {
  broadcast('sniffer:stats', statsOf(state, partition))
}

function rememberSeenUrl(state: SnifferState, url: string): void {
  state.seenUrls.add(url)
  state.seenOrder.push(url)

  if (state.seenOrder.length <= MAX_SEEN_URLS) return

  const stale = state.seenOrder.shift()
  if (stale) {
    state.seenUrls.delete(stale)
  }
}

function drainQueue(partition: string, state: SnifferState): void {
  while (state.active && state.runningCount < MAX_CONCURRENT_ANALYZE && state.pendingUrls.length > 0) {
    const url = state.pendingUrls.shift()
    if (!url) continue

    state.runningCount++
    state.analyzingUrls.add(url)

    void analyzeUrl(url, state)
      .then((resource) => {
        if (resource && snifferStates.get(partition) === state && state.active) {
          broadcast('sniffer:resource', { partition, resource })
        }
      })
      .finally(() => {
        if (snifferStates.get(partition) !== state) return

        state.runningCount = Math.max(0, state.runningCount - 1)
        state.analyzingUrls.delete(url)
        broadcastStats(partition, state)
        drainQueue(partition, state)
      })
  }
}

function enqueueUrl(partition: string, state: SnifferState, url: string): void {
  if (!mightBeMedia(url)) return
  if (state.seenUrls.has(url) || state.analyzingUrls.has(url)) return

  rememberSeenUrl(state, url)
  state.sniffedCount++
  state.pendingUrls.push(url)
  broadcastStats(partition, state)
  drainQueue(partition, state)
}

function enqueueUrls(partition: string, urls: string[]): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  for (const url of urls) {
    enqueueUrl(partition, state, url)
  }
}

function ensurePartitionListener(partition: string): void {
  if (listenedPartitions.has(partition)) return

  const ses = session.fromPartition(partition)
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ requestHeaders: details.requestHeaders })
    enqueueUrls(partition, [details.url])
  })

  listenedPartitions.add(partition)
}

function startInterception(partition: string): void {
  const state = createState(partition)
  snifferStates.set(partition, state)
  ensurePartitionListener(partition)
  log.info(`[Sniffer] Started interception for partition: ${partition}`)
  broadcastStats(partition, state)
}

function stopInterception(partition: string): void {
  const state = snifferStates.get(partition)
  if (!state) {
    broadcastStats(partition)
    return
  }

  state.active = false
  state.pendingUrls = []
  state.analyzingUrls.clear()
  state.seenUrls.clear()
  state.seenOrder = []
  log.info(`[Sniffer] Stopped interception for partition: ${partition}`)
  broadcastStats(partition, state)
}

ipcMain.handle('sniffer:scan-urls', async (_event, { partition, urls }: { partition: string; urls: string[] }) => {
  enqueueUrls(partition, urls || [])
})

export const snifferRouter = trpc.router({
  start: publicProcedure.input(z.object({ partition: z.string() })).mutation(({ input }) => {
    startInterception(input.partition)
    return { success: true }
  }),

  stop: publicProcedure.input(z.object({ partition: z.string() })).mutation(({ input }) => {
    stopInterception(input.partition)
    return { success: true }
  }),

  reset: publicProcedure.input(z.object({ partition: z.string() })).mutation(({ input }) => {
    const state = snifferStates.get(input.partition)
    if (state) {
      state.sniffedCount = 0
      state.identifiedCount = 0
      state.discardedCount = 0
      state.seenUrls.clear()
      state.seenOrder = []
      state.analyzingUrls.clear()
      state.pendingUrls = []
      broadcastStats(input.partition, state)
    } else {
      broadcastStats(input.partition)
    }
    return { success: true }
  }),

  getStats: publicProcedure.input(z.object({ partition: z.string() })).query(({ input }) => {
    return statsOf(snifferStates.get(input.partition), input.partition)
  })
})
