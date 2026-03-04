/**
 * sniffer.ts — 三层媒体资源嗅探器（重构版）
 *
 * 层级优先级（速度从快到慢）：
 *   Layer 1 — DOM 扫描       : renderer 调用 executeJavaScript，直接扫 <img>/<video>/<audio>/script URL
 *   Layer 2 — onResponseStarted : 响应头 Content-Type 直接确认（最可靠，无需 ffprobe）
 *   Layer 3 — onBeforeSendHeaders: 请求 URI 启发式分析 → 仅对模糊类型走 ffprobe 兜底
 *
 * 403 / 跨域 / Electron 无法播放方案：
 *   - onResponseStarted 收集原始 requestHeaders（含 Cookie / Referer）
 *   - 每个 SnifferResource 携带 requestHeaders，下载时原样转发即可
 *   - ffprobe 探测时复用收集到的请求头（通过 ffmpeg input option）
 */

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

// ─────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────

const MAX_CONCURRENT_ANALYZE = 3
const MAX_SEEN_URLS = 3000

// 明确媒体 MIME 前缀 → 直接确认，不需要 ffprobe
const CONFIRMED_VIDEO_CT = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-flv',
  'video/x-matroska',
  'video/mpeg',
  'video/3gpp',
  'application/vnd.apple.mpegurl', // HLS m3u8
  'application/x-mpegurl',
  'application/dash+xml' // DASH mpd
]
const CONFIRMED_AUDIO_CT = [
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
  'audio/x-m4a'
]
const CONFIRMED_IMAGE_CT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml'
]

// 需要 ffprobe 二次探测的模糊类型（大文件二进制流）
const AMBIGUOUS_CT = ['application/octet-stream', 'binary/octet-stream', 'application/binary']

// URL 扩展名白名单（Layer 3 启发式）
const MEDIA_EXTS = new Set([
  'm3u8',
  'mpd',
  'mp4',
  'webm',
  'mkv',
  'avi',
  'mov',
  'flv',
  'ts',
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
  'avif'
])

const IMAGE_FFPROBE_FORMATS = new Set(['image2', 'png_pipe', 'jpeg_pipe', 'mjpeg', 'gif', 'webp_pipe', 'bmp_pipe'])

// 跳过模式 — 明确无用的 URL
const SKIP_PATTERNS = [
  /\.(js|css|html|htm|json|xml|woff2?|ttf|eot|ico|txt|map|pdf)(?:\?|#|$)/i,
  /^data:/,
  /^blob:/,
  /^chrome-extension:/,
  /\/favicon\./i,
  /analytics|tracking|beacon|ping|telemetry/i,
  /\/(ads?|advertisement|banner)\//i
]

// 小图阈值 — 响应 Content-Length 小于此值的图片可能是图标，跳过
const MIN_IMAGE_SIZE = 2048 // 2KB

// ─────────────────────────────────────────────
//  类型定义
// ─────────────────────────────────────────────

export interface SnifferResource {
  id: string
  type: 'video' | 'audio' | 'image'
  url: string
  title: string
  pageUrl?: string // 来源页面（用作 Referer）
  contentType?: string
  size?: string
  resolution?: string
  duration?: string
  thumbnailUrl?: string
  /** 原始请求头（含 Cookie、Referer），下载时必须透传 */
  requestHeaders?: Record<string, string>
  /** 置信度：confirmed = 响应头直接确认，probable = URL启发式, speculative = ffprobe 推断 */
  confidence: 'confirmed' | 'probable' | 'speculative'
  source: 'dom' | 'response-header' | 'request-header' | 'ffprobe'
}

export interface SnifferStatsPayload {
  partition: string
  active: boolean
  sniffedCount: number
  identifiedCount: number
  discardedCount: number
  analyzingCount: number
}

// 内部请求元数据缓存：url → 收集到的请求信息
interface RequestMeta {
  requestHeaders: Record<string, string>
  referer?: string
  pageUrl?: string
  contentType?: string
  contentLength?: number
  ts: number // 时间戳，用于 LRU 淘汰
}

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
  /** url → 最近请求元数据缓存 */
  requestMetaCache: Map<string, RequestMeta>
}

// ─────────────────────────────────────────────
//  全局状态
// ─────────────────────────────────────────────

const snifferStates = new Map<string, SnifferState>()
const listenedPartitions = new Set<string>()

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────

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
    runningCount: 0,
    requestMetaCache: new Map()
  }
}

function statsOf(state?: SnifferState, partition?: string): SnifferStatsPayload {
  return {
    partition: state?.partition ?? partition ?? '',
    active: state?.active ?? false,
    sniffedCount: state?.sniffedCount ?? 0,
    identifiedCount: state?.identifiedCount ?? 0,
    discardedCount: state?.discardedCount ?? 0,
    analyzingCount: state?.analyzingUrls.size ?? 0
  }
}

function broadcast(channel: string, payload: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function broadcastStats(partition: string, state?: SnifferState): void {
  broadcast('sniffer:stats', statsOf(state, partition))
}

function broadcastResource(partition: string, resource: SnifferResource): void {
  broadcast('sniffer:resource', { partition, resource })
}

// 规范化 URL（去掉 fragment，保留 query）
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    return u.toString()
  } catch {
    return raw
  }
}

// 是否是需要跳过的 URL
function shouldSkip(url: string): boolean {
  if (!url || !url.startsWith('http')) return true
  for (const p of SKIP_PATTERNS) {
    if (p.test(url)) return true
  }
  return false
}

// 从 URL 提取友好标题
function titleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    const clean = seg.split('?')[0]
    return clean.length > 60 ? clean.slice(0, 60) + '…' : clean
  } catch {
    return url.slice(0, 60)
  }
}

// 格式化时长
function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function rememberSeenUrl(state: SnifferState, url: string): void {
  state.seenUrls.add(url)
  state.seenOrder.push(url)
  if (state.seenOrder.length > MAX_SEEN_URLS) {
    const stale = state.seenOrder.shift()
    if (stale) state.seenUrls.delete(stale)
  }
}

/** 缓存请求元数据，并控制缓存大小（最多 500 条） */
function cacheRequestMeta(state: SnifferState, url: string, meta: RequestMeta): void {
  state.requestMetaCache.set(url, meta)
  if (state.requestMetaCache.size > 500) {
    // 删除最旧的条目
    const firstKey = state.requestMetaCache.keys().next().value
    if (firstKey) state.requestMetaCache.delete(firstKey)
  }
}

// ─────────────────────────────────────────────
//  Content-Type 分析（Layer 2 核心）
// ─────────────────────────────────────────────

type MediaType = 'video' | 'audio' | 'image' | null

function mediaTypeFromContentType(ct: string): MediaType {
  const lower = ct.toLowerCase().split(';')[0].trim()
  if (CONFIRMED_VIDEO_CT.some((v) => lower.startsWith(v))) return 'video'
  if (CONFIRMED_AUDIO_CT.some((v) => lower.startsWith(v))) return 'audio'
  if (CONFIRMED_IMAGE_CT.some((v) => lower.startsWith(v))) return 'image'
  return null
}

function isAmbiguousContentType(ct: string): boolean {
  const lower = ct.toLowerCase().split(';')[0].trim()
  return AMBIGUOUS_CT.some((a) => lower === a)
}

// ─────────────────────────────────────────────
//  URL 启发式分析（Layer 3 辅助）
// ─────────────────────────────────────────────

function mightBeMediaByUrl(url: string): boolean {
  if (shouldSkip(url)) return false
  try {
    const u = new URL(url)
    const ext = u.pathname.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
    if (MEDIA_EXTS.has(ext)) return true
    if (/\/(video|audio|media|hls|stream|m3u8|playlist|mp4|ts|mp3|manifest)\//i.test(u.pathname)) return true
    // CDN 域名特征
    if (/\.(oss|cos|cdn|bce|myqcloud|aliyuncs|cloudfront|akamaized)\./i.test(u.hostname)) return true
    return false
  } catch {
    return false
  }
}

function mightBeMediaByRequestHeaders(url: string, headers: Record<string, string>): boolean {
  if (mightBeMediaByUrl(url)) return true
  const accept = headers['Accept'] || headers['accept'] || ''
  if (/video|audio/.test(accept)) return true
  if (/image\//.test(accept) && !/text\/html/.test(accept)) return true
  // Range 请求常见于媒体分段下载
  if (headers['Range'] || headers['range']) return true
  return false
}

// ─────────────────────────────────────────────
//  HEAD 请求 — 验证 Content-Type & Content-Length
// ─────────────────────────────────────────────

interface HeadResult {
  contentType: string
  contentLength: number
  acceptRanges: boolean
  etag?: string
}

function headRequest(url: string, extraHeaders?: Record<string, string>): Promise<HeadResult> {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const mod = u.protocol === 'https:' ? https : http
      const reqHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        ...extraHeaders
      }
      const req = mod.request(url, { method: 'HEAD', timeout: 6_000, headers: reqHeaders }, (res) => {
        resolve({
          contentType: (res.headers['content-type'] as string) || '',
          contentLength: parseInt(res.headers['content-length'] || '0', 10) || 0,
          acceptRanges: res.headers['accept-ranges'] === 'bytes',
          etag: res.headers['etag'] as string | undefined
        })
      })
      req.on('error', () => resolve({ contentType: '', contentLength: 0, acceptRanges: false }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ contentType: '', contentLength: 0, acceptRanges: false })
      })
      req.end()
    } catch {
      resolve({ contentType: '', contentLength: 0, acceptRanges: false })
    }
  })
}

// ─────────────────────────────────────────────
//  ffprobe 兜底（Layer 3 精确探测）
// ─────────────────────────────────────────────

function probeUrl(url: string, requestHeaders?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ffprobe timeout')), 15_000)

    const cmd = ffmpeg()

    // 将收集到的请求头注入 ffmpeg input_options（解决 403 问题）
    if (requestHeaders) {
      const headerStr = Object.entries(requestHeaders)
        .filter(([k]) => /^(cookie|referer|user-agent|authorization)$/i.test(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')
      if (headerStr) {
        cmd.inputOptions([`-headers`, headerStr])
      }
    }

    cmd.input(url).ffprobe((err, data) => {
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

async function analyzeByFfprobe(url: string, state: SnifferState): Promise<SnifferResource | null> {
  const meta = state.requestMetaCache.get(url)
  const requestHeaders = meta?.requestHeaders

  try {
    const metadata = await probeUrl(url, requestHeaders)
    const videoStreams = metadata.streams?.filter((s: any) => s.codec_type === 'video') ?? []
    const audioStreams = metadata.streams?.filter((s: any) => s.codec_type === 'audio') ?? []
    const duration = parseDuration(metadata.format?.duration)
    const formatName: string = metadata.format?.format_name ?? ''

    const isImage =
      IMAGE_FFPROBE_FORMATS.has(formatName) ||
      (videoStreams.some((s: any) => s.codec_name === 'mjpeg') && duration === 0)

    let type: 'video' | 'audio' | 'image' | null = null
    if (isImage && videoStreams.length === 1) type = 'image'
    else if (videoStreams.length > 0 && duration > 0) type = 'video'
    else if (audioStreams.length > 0 && videoStreams.length === 0) type = 'audio'

    if (!type) return null

    const videoStream = videoStreams[0]
    const resolution = videoStream ? `${videoStream.width}×${videoStream.height}` : undefined
    const bytes = meta?.contentLength || 0

    return {
      id: genId(),
      type,
      url,
      title: titleFromUrl(url),
      pageUrl: meta?.pageUrl,
      contentType: meta?.contentType,
      size: bytes ? formatSize(bytes) : undefined,
      resolution,
      duration: duration ? formatDuration(duration) : undefined,
      requestHeaders: sanitizeHeaders(requestHeaders),
      confidence: 'speculative',
      source: 'ffprobe'
    }
  } catch (_e) {
    // ffprobe 失败，放弃此 URL
    return null
  }
}

// ─────────────────────────────────────────────
//  Layer 2：onResponseStarted 直接确认
// ─────────────────────────────────────────────

function handleResponseStarted(partition: string, details: Electron.OnResponseStartedListenerDetails): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  if (shouldSkip(url)) return

  // 拍平响应头（Electron 中 responseHeaders 每个值都是 string[]）
  const flatResHeaders = flattenHeaders(details.responseHeaders ?? {})
  const ct = flatResHeaders['content-type'] || ''
  const clStr = flatResHeaders['content-length'] || '0'
  const contentLength = parseInt(clStr, 10) || 0

  // 收集原始请求头缓存（用于下载时解决 403）
  const flatReqHeaders = flattenHeaders((details as any).requestHeaders ?? {})
  const existingMeta = state.requestMetaCache.get(url)
  const meta: RequestMeta = {
    requestHeaders: { ...existingMeta?.requestHeaders, ...flatReqHeaders },
    referer: flatReqHeaders['referer'],
    contentType: ct,
    contentLength: Math.max(contentLength, existingMeta?.contentLength ?? 0),
    ts: Date.now()
  }
  cacheRequestMeta(state, url, meta)

  // 已经见过这个 URL，跳过
  if (state.seenUrls.has(url)) return

  const mediaType = mediaTypeFromContentType(ct)

  if (mediaType) {
    // 图片过滤：Content-Length 太小可能是图标
    if (mediaType === 'image' && contentLength > 0 && contentLength < MIN_IMAGE_SIZE) return

    rememberSeenUrl(state, url)
    state.sniffedCount++
    state.identifiedCount++

    const resource: SnifferResource = {
      id: genId(),
      type: mediaType,
      url,
      title: titleFromUrl(url),
      contentType: ct,
      size: contentLength ? formatSize(contentLength) : undefined,
      requestHeaders: sanitizeHeaders(flatReqHeaders),
      confidence: 'confirmed',
      source: 'response-header'
    }

    broadcastResource(partition, resource)
    broadcastStats(partition, state)
    log.debug(`[Sniffer] Confirmed via response-header: ${mediaType} ${url}`)
    return
  }

  // 模糊类型 + URL 看起来像媒体 → 进入 ffprobe 队列
  if (isAmbiguousContentType(ct) && mightBeMediaByUrl(url)) {
    enqueueForFfprobe(partition, state, url)
    return
  }
}

// ─────────────────────────────────────────────
//  Layer 3：onBeforeSendHeaders → 启发式 + ffprobe 兜底
// ─────────────────────────────────────────────

function handleBeforeSendHeaders(
  partition: string,
  details: Electron.BeforeSendResponse & { url: string; requestHeaders: Record<string, string> }
): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  if (shouldSkip(url)) return
  if (state.seenUrls.has(url)) return

  // 缓存请求头（onResponseStarted 会补全 content-type 和 length）
  const existingMeta = state.requestMetaCache.get(url)
  if (!existingMeta) {
    cacheRequestMeta(state, url, {
      requestHeaders: details.requestHeaders,
      referer: details.requestHeaders['Referer'] || details.requestHeaders['referer'],
      ts: Date.now()
    })
  }

  if (mightBeMediaByRequestHeaders(url, details.requestHeaders)) {
    // 先不计入 sniffedCount，等 onResponseStarted 确认
    // 但也要标记避免重复，加入轻量候选池
    // （由 onResponseStarted 来做最终决定，避免两层重复入队）
  }
}

// ─────────────────────────────────────────────
//  Layer 1：DOM 扫描 URL 入口（来自 renderer IPC）
// ─────────────────────────────────────────────

function handleDomUrls(partition: string, urls: string[]): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  for (const raw of urls) {
    const url = normalizeUrl(raw)
    if (shouldSkip(url)) continue
    if (state.seenUrls.has(url)) continue

    // DOM 扫到的 URL 先走 HEAD 请求验证（快速，比 ffprobe 更轻量）
    rememberSeenUrl(state, url)
    state.sniffedCount++
    broadcastStats(partition, state)

    void verifyByHead(url, state, partition)
  }
}

/** 通过 HEAD 请求验证 DOM 扫到的 URL */
async function verifyByHead(url: string, state: SnifferState, partition: string): Promise<void> {
  const meta = state.requestMetaCache.get(url)

  // 给 HEAD 请求带上已知的请求头（如 Referer/Cookie），减少 403
  const extraHeaders: Record<string, string> = {}
  if (meta?.requestHeaders?.['Referer']) extraHeaders['Referer'] = meta.requestHeaders['Referer']
  if (meta?.requestHeaders?.['referer']) extraHeaders['Referer'] = meta.requestHeaders['referer']
  if (meta?.requestHeaders?.['Cookie']) extraHeaders['Cookie'] = meta.requestHeaders['Cookie']
  if (meta?.requestHeaders?.['cookie']) extraHeaders['Cookie'] = meta.requestHeaders['cookie']

  try {
    const head = await headRequest(url, extraHeaders)
    const mediaType = mediaTypeFromContentType(head.contentType)

    if (mediaType) {
      if (mediaType === 'image' && head.contentLength > 0 && head.contentLength < MIN_IMAGE_SIZE) return

      // 更新缓存
      cacheRequestMeta(state, url, {
        ...meta,
        requestHeaders: meta?.requestHeaders ?? {},
        contentType: head.contentType,
        contentLength: head.contentLength,
        ts: Date.now()
      })

      state.identifiedCount++
      const resource: SnifferResource = {
        id: genId(),
        type: mediaType,
        url,
        title: titleFromUrl(url),
        contentType: head.contentType,
        size: head.contentLength ? formatSize(head.contentLength) : undefined,
        requestHeaders: sanitizeHeaders(meta?.requestHeaders),
        confidence: 'confirmed',
        source: 'dom'
      }
      broadcastResource(partition, resource)
      broadcastStats(partition, state)
    } else if (isAmbiguousContentType(head.contentType) && mightBeMediaByUrl(url)) {
      // 模糊类型 → ffprobe
      enqueueForFfprobe(partition, state, url)
    } else if (!head.contentType && mightBeMediaByUrl(url)) {
      // HEAD 无响应类型（某些 CDN 流媒体），只靠 URL 判断 → ffprobe
      enqueueForFfprobe(partition, state, url)
    } else {
      state.discardedCount++
      broadcastStats(partition, state)
    }
  } catch {
    state.discardedCount++
    broadcastStats(partition, state)
  }
}

// ─────────────────────────────────────────────
//  ffprobe 队列管理
// ─────────────────────────────────────────────

function enqueueForFfprobe(partition: string, state: SnifferState, url: string): void {
  if (state.analyzingUrls.has(url)) return
  state.pendingUrls.push(url)
  drainQueue(partition, state)
}

function drainQueue(partition: string, state: SnifferState): void {
  while (state.active && state.runningCount < MAX_CONCURRENT_ANALYZE && state.pendingUrls.length > 0) {
    const url = state.pendingUrls.shift()!
    state.runningCount++
    state.analyzingUrls.add(url)
    broadcastStats(partition, state)

    void analyzeByFfprobe(url, state)
      .then((resource) => {
        if (!resource) {
          state.discardedCount++
          return
        }
        if (snifferStates.get(partition) === state && state.active) {
          state.identifiedCount++
          broadcastResource(partition, resource)
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

// ─────────────────────────────────────────────
//  Session 监听器挂载（每个 partition 只挂一次）
// ─────────────────────────────────────────────

function ensurePartitionListener(partition: string): void {
  if (listenedPartitions.has(partition)) return
  listenedPartitions.add(partition)

  const ses = session.fromPartition(partition)

  // Layer 3：请求拦截，收集请求头元数据
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ requestHeaders: details.requestHeaders })

    const url = normalizeUrl(details.url)
    if (shouldSkip(url)) return

    const partition = findPartitionForSession(ses)
    if (!partition) return

    handleBeforeSendHeaders(partition, {
      url,
      requestHeaders: details.requestHeaders as Record<string, string>,
      cancel: false
    })
  })

  // Layer 2：响应头拦截，直接通过 Content-Type 确认资源
  ses.webRequest.onResponseStarted({ urls: ['<all_urls>'] }, (details) => {
    const partition = findPartitionForSession(ses)
    if (!partition) return
    handleResponseStarted(partition, details)
  })

  log.info(`[Sniffer] Listeners attached to partition: ${partition}`)
}

/** 从 session 实例反查 partition 字符串 */
function findPartitionForSession(ses: Electron.Session): string | null {
  for (const [partition, state] of snifferStates) {
    if (state.active && session.fromPartition(partition) === ses) return partition
  }
  // 即使 sniffer 未 active，也尝试在 listenedPartitions 中找到对应的
  for (const partition of listenedPartitions) {
    if (session.fromPartition(partition) === ses) return partition
  }
  return null
}

// ─────────────────────────────────────────────
//  生命周期
// ─────────────────────────────────────────────

function startInterception(partition: string): void {
  const state = createState(partition)
  snifferStates.set(partition, state)
  ensurePartitionListener(partition)
  log.info(`[Sniffer] Started: ${partition}`)
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
  // 保留 seenUrls / requestMetaCache 供停止后查询
  log.info(`[Sniffer] Stopped: ${partition}`)
  broadcastStats(partition, state)
}

function resetState(partition: string): void {
  const state = snifferStates.get(partition)
  if (!state) {
    broadcastStats(partition)
    return
  }
  state.sniffedCount = 0
  state.identifiedCount = 0
  state.discardedCount = 0
  state.seenUrls.clear()
  state.seenOrder = []
  state.analyzingUrls.clear()
  state.pendingUrls = []
  state.requestMetaCache.clear()
  broadcastStats(partition, state)
}

// ─────────────────────────────────────────────
//  辅助
// ─────────────────────────────────────────────

function genId(): string {
  return `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** 拍平 Electron responseHeaders 格式（每个值是 string[]）为 Record<string, string> */
function flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    result[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
  }
  return result
}

/** 只保留下载时有用的请求头，丢弃无关字段 */
function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  const KEEP = ['cookie', 'referer', 'user-agent', 'authorization', 'origin']
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (KEEP.includes(k.toLowerCase())) result[k] = v
  }
  return Object.keys(result).length ? result : undefined
}

// ─────────────────────────────────────────────
//  IPC 处理器
// ─────────────────────────────────────────────

// Layer 1：接收来自 renderer DOM 扫描的 URL 列表
ipcMain.handle('sniffer:scan-urls', async (_event, { partition, urls }: { partition: string; urls: string[] }) => {
  handleDomUrls(partition, urls || [])
})

// ─────────────────────────────────────────────
//  tRPC 路由
// ─────────────────────────────────────────────

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
    resetState(input.partition)
    return { success: true }
  }),

  getStats: publicProcedure.input(z.object({ partition: z.string() })).query(({ input }) => {
    return statsOf(snifferStates.get(input.partition), input.partition)
  })
})
