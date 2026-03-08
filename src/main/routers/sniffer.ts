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
import { session, BrowserWindow, ipcMain, app } from 'electron'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import log from '../core/logger'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import { analyzeMedia } from './ffmpeg'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { db } from '@main/db'
import { configs } from '@shared/db/config-schema'
import { resources } from '@shared/db/resource-schema'
import { eq } from 'drizzle-orm'

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
  capturedAt: number
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
  discardedUrls: string[]
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
  discardedUrls: string[]
  seenUrls: Set<string>
  seenOrder: string[]
  pendingHeadUrls: Set<string>
  pendingAnalyzeUrls: Set<string>
  analyzingUrls: Set<string>
  pendingUrls: string[]
  runningCount: number
  /** url → 最近请求元数据缓存 */
  requestMetaCache: Map<string, RequestMeta>
  /** requestId → 本次请求的元数据，用于在 response 阶段精确关联请求头 */
  requestMetaById: Map<string, RequestMeta>
}

// ─────────────────────────────────────────────
//  全局状态
// ─────────────────────────────────────────────

const snifferStates = new Map<string, SnifferState>()
const listenedPartitions = new Set<string>()
const MAX_DISCARDED_URLS = 100

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
    discardedUrls: [],
    seenUrls: new Set(),
    seenOrder: [],
    pendingHeadUrls: new Set(),
    pendingAnalyzeUrls: new Set(),
    analyzingUrls: new Set(),
    pendingUrls: [],
    runningCount: 0,
    requestMetaCache: new Map(),
    requestMetaById: new Map()
  }
}

function statsOf(state?: SnifferState, partition?: string): SnifferStatsPayload {
  return {
    partition: state?.partition ?? partition ?? '',
    active: state?.active ?? false,
    sniffedCount: state?.sniffedCount ?? 0,
    identifiedCount: state?.identifiedCount ?? 0,
    discardedCount: state?.discardedCount ?? 0,
    analyzingCount: state?.analyzingUrls.size ?? 0,
    discardedUrls: state?.discardedUrls ?? []
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

function recordDiscardedUrl(partition: string, state: SnifferState, url: string): void {
  state.discardedCount++
  state.discardedUrls = [url, ...state.discardedUrls.filter((item) => item !== url)].slice(0, MAX_DISCARDED_URLS)
  broadcastStats(partition, state)
}

function broadcastResource(partition: string, resource: SnifferResource): void {
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

function emitResource(partition: string, resource: SnifferResource): void {
  void enrichResourceMetadata(resource).then((nextResource) => {
    broadcastResource(partition, nextResource)
  })
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

function getHeaderValue(headers: Record<string, string> | undefined, key: string): string | undefined {
  if (!headers) return undefined
  const matchedKey = Object.keys(headers).find((headerKey) => headerKey.toLowerCase() === key.toLowerCase())
  return matchedKey ? headers[matchedKey] : undefined
}

function isRangeRequest(headers?: Record<string, string>): boolean {
  return Boolean(getHeaderValue(headers, 'range'))
}

function stripRangeHeader(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'range') continue
    result[key] = value
  }
  return Object.keys(result).length ? result : undefined
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

function parseDurationText(raw?: string): number {
  if (!raw) return 0
  const parts = raw.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

function guessExtensionFromContentType(contentType?: string): string {
  const ct = contentType?.toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  }
  return ct ? map[ct] || '' : ''
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'media'
  )
}

function extFromUrl(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl)
    return path.extname(parsed.pathname)
  } catch {
    return ''
  }
}

function filenameFromContentDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) return null
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1])
  const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i)
  return asciiMatch?.[1] ?? null
}

async function getConfigValue(key: string): Promise<string> {
  const [config] = await db.select().from(configs).where(eq(configs.key, key)).limit(1)
  return config?.value?.trim() ?? ''
}

async function getMaxConcurrentDownloads(): Promise<number> {
  const rawValue = await getConfigValue('download.maxConcurrent')
  const parsedValue = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 3
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const workerCount = Math.max(1, Math.min(limit, items.length))
  let currentIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = currentIndex++
        if (index >= items.length) return
        await worker(items[index], index)
      }
    })
  )
}

async function ensureDownloadDir(): Promise<string> {
  const configuredPath = await getConfigValue('download.path')
  const downloadDir = configuredPath || path.join(app.getPath('downloads'), 'download')
  await fs.mkdir(downloadDir, { recursive: true })
  return downloadDir
}

async function ensureUniqueFilePath(targetPath: string): Promise<string> {
  const parsed = path.parse(targetPath)
  let nextPath = targetPath
  let counter = 1

  while (true) {
    try {
      await fs.access(nextPath)
      nextPath = path.join(parsed.dir, `${parsed.name}(${counter++})${parsed.ext}`)
    } catch {
      return nextPath
    }
  }
}

function inferPlatform(pageUrl?: string, resourceUrl?: string): string {
  const source = pageUrl || resourceUrl
  if (!source) return '网络'
  try {
    const hostname = new URL(source).hostname.toLowerCase()
    if (hostname.includes('douyin')) return '抖音'
    if (hostname.includes('bilibili') || hostname.includes('bilivideo')) return 'B站'
    return hostname.replace(/^www\./, '')
  } catch {
    return '网络'
  }
}

function mapResourceType(type: SnifferResource['type']): string {
  if (type === 'video') return '视频'
  if (type === 'audio') return '音频'
  if (type === 'image') return '图片'
  return '其他'
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

function cacheRequestMetaById(state: SnifferState, requestId: string, meta: RequestMeta): void {
  state.requestMetaById.set(requestId, meta)
  if (state.requestMetaById.size > 1000) {
    const firstKey = state.requestMetaById.keys().next().value
    if (firstKey) state.requestMetaById.delete(firstKey)
  }
}

function consumeRequestMetaById(state: SnifferState, requestId?: string): RequestMeta | undefined {
  if (!requestId) return undefined
  const meta = state.requestMetaById.get(requestId)
  if (meta) state.requestMetaById.delete(requestId)
  return meta
}

function dropRequestMetaById(state: SnifferState, requestId?: string): void {
  if (!requestId) return
  state.requestMetaById.delete(requestId)
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
  const accept = getHeaderValue(headers, 'accept') || ''
  if (/video|audio/.test(accept)) return true
  if (/image\//.test(accept) && !/text\/html/.test(accept)) return true
  // Range 请求常见于媒体分段下载
  if (isRangeRequest(headers)) return true
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
  finalUrl?: string
  contentDisposition?: string
}

function parseContentRangeTotal(contentRange?: string): number {
  if (!contentRange) return 0
  const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+|\*)/i)
  if (!match || match[1] === '*') return 0
  const total = Number.parseInt(match[1], 10)
  return Number.isFinite(total) ? total : 0
}

function resolveContentLength(headers: Record<string, string>): number {
  const contentRangeTotal = parseContentRangeTotal(headers['content-range'])
  if (contentRangeTotal > 0) return contentRangeTotal

  const contentLength = Number.parseInt(headers['content-length'] || '0', 10)
  if (Number.isFinite(contentLength) && contentLength > 0) return contentLength
  return 0
}

function shouldProbeConfirmedMedia(url: string, contentType: string): boolean {
  const normalizedContentType = contentType.toLowerCase().split(';')[0].trim()
  if (normalizedContentType !== 'video/mp4') return false

  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return /media-audio|audio-und|audio-only|\/audio\//.test(pathname) || pathname.includes('mp4a')
  } catch {
    return /media-audio|audio-und|audio-only|\/audio\//.test(url.toLowerCase()) || url.toLowerCase().includes('mp4a')
  }
}

function isAttachedPictureStream(stream: any): boolean {
  const disposition = stream?.disposition ?? {}
  if (disposition.attached_pic === 1 || disposition.attached_pic === true) return true

  const codecName = String(stream?.codec_name ?? '').toLowerCase()
  const codecTag = String(stream?.codec_tag_string ?? '').toLowerCase()
  return ['mjpeg', 'png', 'webp'].includes(codecName) || codecTag === 'mp4a'
}

function fallbackAudioResource(url: string, meta?: RequestMeta, durationSecs?: number): SnifferResource {
  return {
    id: genId(),
    type: 'audio',
    url,
    title: titleFromUrl(url),
    capturedAt: Date.now(),
    pageUrl: meta?.pageUrl,
    contentType: meta?.contentType,
    size: meta?.contentLength ? formatSize(meta.contentLength) : undefined,
    duration: durationSecs ? formatDuration(durationSecs) : undefined,
    requestHeaders: sanitizeHeaders(meta?.requestHeaders),
    confidence: 'probable',
    source: 'ffprobe'
  }
}

function headRequest(url: string, extraHeaders?: Record<string, string>): Promise<HeadResult> {
  return new Promise((resolve) => {
    try {
      const reqHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        ...extraHeaders
      }

      void requestWithRedirect(url, { method: 'HEAD', headers: reqHeaders, timeout: 6_000 })
        .then(({ response, finalUrl }) => {
          response.resume()
          const flatHeaders = flattenHeaders(response.headers as Record<string, string | string[]>)
          resolve({
            contentType: flatHeaders['content-type'] || '',
            contentLength: resolveContentLength(flatHeaders),
            acceptRanges: response.headers['accept-ranges'] === 'bytes',
            etag: response.headers['etag'] as string | undefined,
            finalUrl,
            contentDisposition: response.headers['content-disposition'] as string | undefined
          })
        })
        .catch(() => resolve({ contentType: '', contentLength: 0, acceptRanges: false }))
    } catch {
      resolve({ contentType: '', contentLength: 0, acceptRanges: false })
    }
  })
}

type RequestMethod = 'GET' | 'HEAD'

interface RedirectRequestOptions {
  method?: RequestMethod
  headers?: Record<string, string>
  timeout?: number
}

function requestWithRedirect(
  targetUrl: string,
  options: RedirectRequestOptions,
  redirectCount = 0
): Promise<{ response: http.IncomingMessage; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'))
      return
    }

    let nextUrl: URL
    try {
      nextUrl = new URL(targetUrl)
    } catch (error) {
      reject(error)
      return
    }

    const mod = nextUrl.protocol === 'https:' ? https : http
    const req = mod.request(
      nextUrl,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        timeout: options.timeout ?? 15_000
      },
      (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          response.resume()
          const redirectedUrl = new URL(location, nextUrl).toString()
          void requestWithRedirect(redirectedUrl, options, redirectCount + 1)
            .then(resolve)
            .catch(reject)
          return
        }

        if (statusCode >= 400) {
          response.resume()
          reject(new Error(`HTTP ${statusCode}`))
          return
        }

        resolve({ response, finalUrl: nextUrl.toString() })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'))
    })
    req.end()
  })
}

// ─────────────────────────────────────────────
//  ffprobe 兜底（Layer 3 精确探测）
// ─────────────────────────────────────────────

function probeUrl(url: string, requestHeaders?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ffprobe timeout')), 15_000)

    const cmd = ffmpeg()
    const sanitizedRequestHeaders = sanitizeHeaders(requestHeaders)

    // 将收集到的请求头注入 ffmpeg input_options（解决 403 问题）
    if (sanitizedRequestHeaders) {
      const headerStr = Object.entries(sanitizedRequestHeaders)
        .filter(([k]) => /^(cookie|referer|user-agent|authorization|origin|accept|accept-language)$/i.test(k))
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
    const playableVideoStreams = videoStreams.filter((s: any) => !isAttachedPictureStream(s))
    const duration = parseDuration(metadata.format?.duration)
    const formatName: string = metadata.format?.format_name ?? ''

    const isImage =
      IMAGE_FFPROBE_FORMATS.has(formatName) ||
      (playableVideoStreams.some((s: any) => s.codec_name === 'mjpeg') && duration === 0)

    let type: 'video' | 'audio' | 'image' | null = null
    if (isImage && playableVideoStreams.length === 1 && audioStreams.length === 0) type = 'image'
    else if (playableVideoStreams.length > 0 && duration > 0) type = 'video'
    else if (audioStreams.length > 0 && playableVideoStreams.length === 0) type = 'audio'
    else if (audioStreams.length > 0 && shouldProbeConfirmedMedia(url, meta?.contentType || '')) type = 'audio'

    if (!type && shouldProbeConfirmedMedia(url, meta?.contentType || '')) {
      return fallbackAudioResource(url, meta, duration)
    }

    if (!type) return null

    const videoStream = playableVideoStreams[0]
    const resolution = videoStream ? `${videoStream.width}×${videoStream.height}` : undefined
    const bytes = meta?.contentLength || 0

    return {
      id: genId(),
      type,
      url,
      title: titleFromUrl(url),
      capturedAt: Date.now(),
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
    if (shouldProbeConfirmedMedia(url, meta?.contentType || '')) {
      return fallbackAudioResource(url, meta)
    }

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
  const contentLength = resolveContentLength(flatResHeaders)

  // 使用 requestId 精确关联请求头，避免多个相同 URL 的请求互相污染
  const requestMeta = consumeRequestMetaById(state, (details as { requestId?: string }).requestId)
  const existingMeta = state.requestMetaCache.get(url)
  const mergedRequestHeaders = {
    ...(existingMeta?.requestHeaders ?? {}),
    ...(requestMeta?.requestHeaders ?? {})
  }
  const meta: RequestMeta = {
    requestHeaders: mergedRequestHeaders,
    referer: getHeaderValue(mergedRequestHeaders, 'referer'),
    pageUrl: requestMeta?.pageUrl || existingMeta?.pageUrl || getHeaderValue(mergedRequestHeaders, 'referer'),
    contentType: ct,
    contentLength: Math.max(contentLength, requestMeta?.contentLength ?? 0, existingMeta?.contentLength ?? 0),
    ts: Date.now()
  }
  cacheRequestMeta(state, url, meta)

  // 已经见过这个 URL，跳过
  if (state.seenUrls.has(url)) return

  const mediaType = mediaTypeFromContentType(ct)

  if (mediaType) {
    if (shouldProbeConfirmedMedia(url, ct)) {
      rememberSeenUrl(state, url)
      state.sniffedCount++
      enqueueForFfprobe(partition, state, url)
      broadcastStats(partition, state)
      log.debug(`[Sniffer] Escalated to ffprobe despite confirmed content-type: ${ct} ${url}`)
      return
    }

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
      capturedAt: Date.now(),
      contentType: ct,
      size: contentLength ? formatSize(contentLength) : undefined,
      pageUrl: meta.pageUrl,
      requestHeaders: sanitizeHeaders(mergedRequestHeaders),
      confidence: 'confirmed',
      source: 'response-header'
    }

    emitResource(partition, resource)
    broadcastStats(partition, state)
    log.debug(`[Sniffer] Confirmed via response-header: ${mediaType} ${url}`)
    return
  }

  // 模糊类型 + URL 看起来像媒体 → 进入 ffprobe 队列
  if (isAmbiguousContentType(ct) && mightBeMediaByUrl(url)) {
    state.sniffedCount++
    enqueueForFfprobe(partition, state, url)
    broadcastStats(partition, state)
    return
  }
}

// ─────────────────────────────────────────────
//  Layer 3：onBeforeSendHeaders → 启发式 + ffprobe 兜底
// ─────────────────────────────────────────────

function handleBeforeSendHeaders(
  partition: string,
  details: { url: string; requestHeaders: Record<string, string>; requestId?: string }
): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  if (shouldSkip(url)) return
  if (state.seenUrls.has(url)) return

  // 缓存请求头（onResponseStarted 会补全 content-type 和 length）
  const existingMeta = state.requestMetaCache.get(url)
  const mergedRequestHeaders = {
    ...(existingMeta?.requestHeaders ?? {}),
    ...details.requestHeaders
  }
  cacheRequestMeta(state, url, {
    requestHeaders: mergedRequestHeaders,
    referer: getHeaderValue(mergedRequestHeaders, 'referer'),
    pageUrl: existingMeta?.pageUrl || getHeaderValue(mergedRequestHeaders, 'referer'),
    contentType: existingMeta?.contentType,
    contentLength: existingMeta?.contentLength,
    ts: Date.now()
  })

  if (details.requestId) {
    cacheRequestMetaById(state, details.requestId, {
      requestHeaders: mergedRequestHeaders,
      referer: getHeaderValue(mergedRequestHeaders, 'referer'),
      pageUrl: existingMeta?.pageUrl || getHeaderValue(mergedRequestHeaders, 'referer'),
      contentType: existingMeta?.contentType,
      contentLength: existingMeta?.contentLength,
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
    if (state.pendingHeadUrls.has(url)) continue

    // DOM 扫到的 URL 先走 HEAD 请求验证（快速，比 ffprobe 更轻量）
    state.pendingHeadUrls.add(url)
    state.sniffedCount++
    broadcastStats(partition, state)

    void verifyByHead(url, state, partition).finally(() => {
      state.pendingHeadUrls.delete(url)
    })
  }
}

/** 通过 HEAD 请求验证 DOM 扫到的 URL */
async function verifyByHead(url: string, state: SnifferState, partition: string): Promise<void> {
  const meta = state.requestMetaCache.get(url)

  // 给 HEAD 请求带上已知的请求头（如 Referer/Cookie），减少 403
  const extraHeaders: Record<string, string> = {}
  const referer = getHeaderValue(meta?.requestHeaders, 'referer')
  const cookie = getHeaderValue(meta?.requestHeaders, 'cookie')
  const origin = getHeaderValue(meta?.requestHeaders, 'origin')
  if (referer) extraHeaders['Referer'] = referer
  if (cookie) extraHeaders['Cookie'] = cookie
  if (origin) extraHeaders['Origin'] = origin

  try {
    const head = await headRequest(url, extraHeaders)
    const mediaType = mediaTypeFromContentType(head.contentType)

    if (mediaType) {
      if (shouldProbeConfirmedMedia(url, head.contentType)) {
        enqueueForFfprobe(partition, state, url)
        return
      }

      if (mediaType === 'image' && head.contentLength > 0 && head.contentLength < MIN_IMAGE_SIZE) return

      rememberSeenUrl(state, url)
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
        capturedAt: Date.now(),
        contentType: head.contentType,
        size: head.contentLength ? formatSize(head.contentLength) : undefined,
        pageUrl: meta?.pageUrl,
        requestHeaders: sanitizeHeaders(meta?.requestHeaders),
        confidence: 'confirmed',
        source: 'dom'
      }
      emitResource(partition, resource)
      broadcastStats(partition, state)
    } else if (isAmbiguousContentType(head.contentType) && mightBeMediaByUrl(url)) {
      // 模糊类型 → ffprobe
      enqueueForFfprobe(partition, state, url)
    } else if (!head.contentType && mightBeMediaByUrl(url)) {
      // HEAD 无响应类型（某些 CDN 流媒体），只靠 URL 判断 → ffprobe
      enqueueForFfprobe(partition, state, url)
    } else {
      recordDiscardedUrl(partition, state, url)
    }
  } catch {
    recordDiscardedUrl(partition, state, url)
  }
}

// ─────────────────────────────────────────────
//  ffprobe 队列管理
// ─────────────────────────────────────────────

function enqueueForFfprobe(partition: string, state: SnifferState, url: string): void {
  if (state.analyzingUrls.has(url) || state.pendingAnalyzeUrls.has(url)) return
  if (!state.seenUrls.has(url)) rememberSeenUrl(state, url)
  state.pendingAnalyzeUrls.add(url)
  state.pendingUrls.push(url)
  drainQueue(partition, state)
}

function drainQueue(partition: string, state: SnifferState): void {
  while (state.active && state.runningCount < MAX_CONCURRENT_ANALYZE && state.pendingUrls.length > 0) {
    const url = state.pendingUrls.shift()!
    state.pendingAnalyzeUrls.delete(url)
    state.runningCount++
    state.analyzingUrls.add(url)
    broadcastStats(partition, state)

    void analyzeByFfprobe(url, state)
      .then((resource) => {
        if (!resource) {
          recordDiscardedUrl(partition, state, url)
          return
        }
        if (snifferStates.get(partition) === state && state.active) {
          state.identifiedCount++
          emitResource(partition, resource)
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
      requestId: (details as { requestId?: string }).requestId
    })
  })

  // Layer 2：响应头拦截，直接通过 Content-Type 确认资源
  ses.webRequest.onResponseStarted({ urls: ['<all_urls>'] }, (details) => {
    const partition = findPartitionForSession(ses)
    if (!partition) return
    handleResponseStarted(partition, details)
  })

  ses.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
    const partition = findPartitionForSession(ses)
    if (!partition) return
    const state = snifferStates.get(partition)
    if (!state) return
    dropRequestMetaById(state, (details as { requestId?: string }).requestId)
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
  state.pendingHeadUrls.clear()
  state.pendingAnalyzeUrls.clear()
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
  state.discardedUrls = []
  state.seenUrls.clear()
  state.seenOrder = []
  state.pendingHeadUrls.clear()
  state.pendingAnalyzeUrls.clear()
  state.analyzingUrls.clear()
  state.pendingUrls = []
  state.requestMetaCache.clear()
  state.requestMetaById.clear()
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
  const normalizedHeaders = stripRangeHeader(headers)
  if (!normalizedHeaders) return undefined
  const KEEP = ['cookie', 'referer', 'user-agent', 'authorization', 'origin', 'accept', 'accept-language']
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(normalizedHeaders)) {
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
//  下载 / 合并
// ─────────────────────────────────────────────

const snifferDownloadResourceSchema = z.object({
  id: z.string(),
  type: z.enum(['video', 'audio', 'image']),
  url: z.string().url(),
  title: z.string(),
  capturedAt: z.number().optional(),
  pageUrl: z.string().optional(),
  contentType: z.string().optional(),
  duration: z.string().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional()
})

type SnifferDownloadResourceInput = z.infer<typeof snifferDownloadResourceSchema>

async function safeUnlink(targetPath: string): Promise<void> {
  try {
    await fs.unlink(targetPath)
  } catch {}
}

async function safeRm(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true })
  } catch {}
}

async function singleStreamDownload(url: string, headers: Record<string, string>, targetPath: string): Promise<void> {
  const tempPath = `${targetPath}.part`
  await safeUnlink(tempPath)
  try {
    const { response } = await requestWithRedirect(url, { method: 'GET', headers, timeout: 30_000 })
    await pipeline(response, createWriteStream(tempPath))
    await fs.rename(tempPath, targetPath)
  } catch (error) {
    await safeUnlink(tempPath)
    throw error
  }
}

async function concatenateFiles(partPaths: string[], outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath)
    let index = 0

    const pipeNext = () => {
      if (index >= partPaths.length) {
        output.end(() => resolve())
        return
      }

      const input = createReadStream(partPaths[index++])
      input.on('error', reject)
      input.on('end', pipeNext)
      input.pipe(output, { end: false })
    }

    output.on('error', reject)
    pipeNext()
  })
}

async function chunkedDownload(
  url: string,
  headers: Record<string, string>,
  targetPath: string,
  contentLength: number,
  chunkCount: number
): Promise<void> {
  const tempDir = `${targetPath}.chunks`
  const partPaths: string[] = []
  await safeRm(tempDir)
  await fs.mkdir(tempDir, { recursive: true })

  try {
    const chunkSize = Math.ceil(contentLength / chunkCount)
    await Promise.all(
      Array.from({ length: chunkCount }, async (_, index) => {
        const start = index * chunkSize
        const end = Math.min(contentLength - 1, start + chunkSize - 1)
        const partPath = path.join(tempDir, `part-${index}.tmp`)
        partPaths[index] = partPath
        const { response } = await requestWithRedirect(url, {
          method: 'GET',
          headers: {
            ...headers,
            Range: `bytes=${start}-${end}`
          },
          timeout: 30_000
        })
        await pipeline(response, createWriteStream(partPath))
      })
    )

    const tempTargetPath = `${targetPath}.part`
    await safeUnlink(tempTargetPath)
    await concatenateFiles(partPaths, tempTargetPath)
    await fs.rename(tempTargetPath, targetPath)
  } catch (error) {
    await safeUnlink(`${targetPath}.part`)
    throw error
  } finally {
    await safeRm(tempDir)
  }
}

async function resolveDownloadTarget(
  resource: SnifferDownloadResourceInput,
  suffix = ''
): Promise<{ downloadDir: string; filePath: string; fileName: string; finalUrl: string }> {
  const downloadDir = await ensureDownloadDir()
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    ...(sanitizeHeaders(resource.requestHeaders) ?? {})
  }
  const head = await headRequest(resource.url, headers)
  const fileNameBase =
    filenameFromContentDisposition(head.contentDisposition) ||
    `${sanitizeFilename(resource.title || titleFromUrl(resource.url))}${suffix}`
  const ext =
    path.extname(fileNameBase) ||
    extFromUrl(head.finalUrl || resource.url) ||
    extFromUrl(resource.url) ||
    guessExtensionFromContentType(resource.contentType || head.contentType) ||
    (resource.type === 'video' ? '.mp4' : resource.type === 'audio' ? '.m4a' : '.jpg')
  const normalizedBase = path.basename(fileNameBase, path.extname(fileNameBase))
  const fileName = `${sanitizeFilename(normalizedBase)}${ext}`
  const filePath = await ensureUniqueFilePath(path.join(downloadDir, fileName))
  return {
    downloadDir,
    fileName: path.basename(filePath),
    filePath,
    finalUrl: head.finalUrl || resource.url
  }
}

async function downloadRemoteResource(
  resource: SnifferDownloadResourceInput,
  suffix = ''
): Promise<{ filePath: string; fileName: string; finalUrl: string }> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    ...(sanitizeHeaders(resource.requestHeaders) ?? {})
  }
  const { filePath, fileName, finalUrl } = await resolveDownloadTarget(resource, suffix)
  const head = await headRequest(resource.url, headers)

  if (head.acceptRanges && head.contentLength > 8 * 1024 * 1024) {
    const chunkCount = Math.min(4, Math.max(2, Math.ceil(head.contentLength / (16 * 1024 * 1024))))
    await chunkedDownload(finalUrl, headers, filePath, head.contentLength, chunkCount)
  } else {
    await singleStreamDownload(finalUrl, headers, filePath)
  }

  return { filePath, fileName, finalUrl }
}

async function addDownloadedResourceToLibrary(
  resource: SnifferDownloadResourceInput,
  localPath: string,
  sourceUrl: string
): Promise<any> {
  const meta = await analyzeMedia({ path: localPath })
  const created = await db
    .insert(resources)
    .values({
      name: path.basename(localPath),
      type: mapResourceType(resource.type),
      url: sourceUrl,
      localPath,
      cover: meta.cover,
      platform: inferPlatform(resource.pageUrl, sourceUrl),
      metadata: JSON.stringify(meta),
      description: `嗅探下载: ${resource.pageUrl || sourceUrl}`
    })
    .returning()
  return created[0]
}

async function mergeAudioVideo(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(['-map 0:v:0', '-map 1:a:0', '-c:v copy', '-c:a aac', '-shortest'])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
  })
}

function pairSelectedResources(items: SnifferDownloadResourceInput[]): Array<{
  video: SnifferDownloadResourceInput
  audio: SnifferDownloadResourceInput
}> {
  const videos = items.filter((item) => item.type === 'video')
  const audios = items.filter((item) => item.type === 'audio')
  const usedAudioIds = new Set<string>()
  const pairs: Array<{ video: SnifferDownloadResourceInput; audio: SnifferDownloadResourceInput }> = []

  for (const video of videos) {
    const videoDuration = parseDurationText(video.duration)
    const videoCapturedAt = video.capturedAt ?? 0
    const candidates = audios
      .filter((audio) => !usedAudioIds.has(audio.id))
      .map((audio) => {
        const audioDuration = parseDurationText(audio.duration)
        return {
          audio,
          durationDiff: Math.abs(videoDuration - audioDuration),
          tsDiff: Math.abs(videoCapturedAt - (audio.capturedAt ?? 0))
        }
      })
      .filter((item) => item.durationDiff <= 1)
      .sort((a, b) => a.durationDiff - b.durationDiff || a.tsDiff - b.tsDiff)

    const matched = candidates[0]
    if (!matched) continue
    usedAudioIds.add(matched.audio.id)
    pairs.push({ video, audio: matched.audio })
  }

  return pairs
}

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
  }),

  download: publicProcedure.input(z.object({ resource: snifferDownloadResourceSchema })).mutation(async ({ input }) => {
    const { filePath, finalUrl } = await downloadRemoteResource(input.resource)
    const libraryItem = await addDownloadedResourceToLibrary(input.resource, filePath, finalUrl)
    return { success: true, filePath, libraryItem }
  }),

  mergeSelected: publicProcedure
    .input(z.object({ resources: z.array(snifferDownloadResourceSchema).min(2) }))
    .mutation(async ({ input }) => {
      const pairs = pairSelectedResources(input.resources)
      if (pairs.length === 0) {
        throw new Error('未找到可合并的音视频配对，请检查选中项的时长是否接近')
      }

      const downloadDir = await ensureDownloadDir()
      const maxConcurrent = await getMaxConcurrentDownloads()
      const mergedResults: Array<{ filePath: string; libraryItem: any }> = new Array(pairs.length)

      await runWithConcurrencyLimit(pairs, maxConcurrent, async (pair, index) => {
        const tempFiles: string[] = []
        try {
          const [videoDownloaded, audioDownloaded] = await Promise.all([
            downloadRemoteResource(pair.video, `-video-${index + 1}`),
            downloadRemoteResource(pair.audio, `-audio-${index + 1}`)
          ])
          tempFiles.push(videoDownloaded.filePath, audioDownloaded.filePath)

          const outputBaseName = sanitizeFilename(
            path.basename(pair.video.title, path.extname(pair.video.title)) || `merged-${index + 1}`
          )
          const outputName = `${outputBaseName}-merged-${index + 1}.mp4`
          const outputPath = await ensureUniqueFilePath(path.join(downloadDir, outputName))
          await mergeAudioVideo(videoDownloaded.filePath, audioDownloaded.filePath, outputPath)

          const meta = await analyzeMedia({ path: outputPath })
          const [libraryItem] = await db
            .insert(resources)
            .values({
              name: path.basename(outputPath),
              type: '视频',
              url: pair.video.url,
              localPath: outputPath,
              cover: meta.cover,
              platform: inferPlatform(pair.video.pageUrl, pair.video.url),
              metadata: JSON.stringify(meta),
              description: `嗅探合并: ${pair.video.url}`
            })
            .returning()

          mergedResults[index] = { filePath: outputPath, libraryItem }
        } finally {
          await Promise.all(tempFiles.map((tempPath) => safeUnlink(tempPath)))
        }
      })

      return { success: true, mergedCount: mergedResults.length, items: mergedResults }
    })
})
