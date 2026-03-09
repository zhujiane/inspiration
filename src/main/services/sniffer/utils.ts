import path from 'path'
import {
  AMBIGUOUS_CT,
  CONFIRMED_AUDIO_CT,
  CONFIRMED_IMAGE_CT,
  CONFIRMED_VIDEO_CT,
  MEDIA_EXTS,
  SKIP_PATTERNS
} from './constants'

export type MediaType = 'video' | 'audio' | 'image' | null

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    return u.toString()
  } catch {
    return raw
  }
}

export function getHeaderValue(headers: Record<string, string> | undefined, key: string): string | undefined {
  if (!headers) return undefined
  const matchedKey = Object.keys(headers).find((headerKey) => headerKey.toLowerCase() === key.toLowerCase())
  return matchedKey ? headers[matchedKey] : undefined
}

export function isRangeRequest(headers?: Record<string, string>): boolean {
  return Boolean(getHeaderValue(headers, 'range'))
}

export function stripRangeHeader(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'range') continue
    result[key] = value
  }
  return Object.keys(result).length ? result : undefined
}

export function shouldSkip(url: string): boolean {
  if (!url || !url.startsWith('http')) return true
  for (const p of SKIP_PATTERNS) {
    if (p.test(url)) return true
  }
  return false
}

export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    const clean = seg.split('?')[0]
    return clean.length > 60 ? clean.slice(0, 60) + '…' : clean
  } catch {
    return url.slice(0, 60)
  }
}

export function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function guessExtensionFromContentType(contentType?: string): string {
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

export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'media'
  )
}

export function extFromUrl(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl)
    return path.extname(parsed.pathname)
  } catch {
    return ''
  }
}

export function filenameFromContentDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) return null
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1])
  const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i)
  return asciiMatch?.[1] ?? null
}

export function inferPlatform(pageUrl?: string, resourceUrl?: string): string {
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

export function mapResourceType(type: 'video' | 'audio' | 'image'): string {
  if (type === 'video') return '视频'
  if (type === 'audio') return '音频'
  if (type === 'image') return '图片'
  return '其他'
}

export function flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    result[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
  }
  return result
}

export function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  const normalizedHeaders = stripRangeHeader(headers)
  if (!normalizedHeaders) return undefined
  const KEEP = ['cookie', 'referer', 'user-agent', 'authorization', 'origin', 'accept', 'accept-language']
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(normalizedHeaders)) {
    if (KEEP.includes(k.toLowerCase())) result[k] = v
  }
  return Object.keys(result).length ? result : undefined
}

export function mediaTypeFromContentType(ct: string): MediaType {
  const lower = ct.toLowerCase().split(';')[0].trim()
  if (CONFIRMED_VIDEO_CT.some((v) => lower.startsWith(v))) return 'video'
  if (CONFIRMED_AUDIO_CT.some((v) => lower.startsWith(v))) return 'audio'
  if (CONFIRMED_IMAGE_CT.some((v) => lower.startsWith(v))) return 'image'
  return null
}

export function isAmbiguousContentType(ct: string): boolean {
  const lower = ct.toLowerCase().split(';')[0].trim()
  return AMBIGUOUS_CT.some((a) => lower === a)
}

export function mightBeMediaByUrl(url: string): boolean {
  if (shouldSkip(url)) return false
  try {
    const u = new URL(url)
    const ext = u.pathname.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
    if (MEDIA_EXTS.has(ext)) return true
    if (/\/(video|audio|media|hls|stream|m3u8|playlist|mp4|ts|mp3|manifest)\//i.test(u.pathname)) return true
    if (/\.(oss|cos|cdn|bce|myqcloud|aliyuncs|cloudfront|akamaized)\./i.test(u.hostname)) return true
    return false
  } catch {
    return false
  }
}

export function mightBeMediaByRequestHeaders(url: string, headers: Record<string, string>): boolean {
  if (mightBeMediaByUrl(url)) return true
  const accept = getHeaderValue(headers, 'accept') || ''
  if (/video|audio/.test(accept)) return true
  if (/image\//.test(accept) && !/text\/html/.test(accept)) return true
  if (isRangeRequest(headers)) return true
  return false
}
