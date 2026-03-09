import { runFfprobe } from '../ffmpeg'
import { IMAGE_FFPROBE_FORMATS } from './constants'
import { formatDuration, formatSize, sanitizeHeaders, titleFromUrl } from './utils'
import type { RequestMeta, SnifferResource, SnifferState } from '../../types/sniffer-types'

function probeUrl(url: string, requestHeaders?: Record<string, string>): Promise<any> {
  return runFfprobe(url, sanitizeHeaders(requestHeaders), 15_000)
}

function parseDuration(raw: any): number {
  if (!raw || raw === 'N/A') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function shouldProbeConfirmedMedia(url: string, contentType: string): boolean {
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
    id: `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

export async function analyzeByFfprobe(url: string, state: SnifferState): Promise<SnifferResource | null> {
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
      id: `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    return null
  }
}
