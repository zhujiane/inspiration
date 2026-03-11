import { session } from 'electron'
import log from '../logger'
import { MIN_IMAGE_SIZE } from './constants'
import { broadcastStats, emitResource } from './broadcast'
import { resolveContentLength } from './http'
import { listenedPartitions, snifferStates } from './runtime'
import {
  cacheRequestMeta,
  cacheRequestMetaById,
  consumeRequestMetaById,
  createState,
  dropRequestMetaById,
  rememberSeenUrl,
  statsOf
} from './state'
import {
  flattenHeaders,
  formatSize,
  getHeaderValue,
  isLikelyStreamSegmentUrl,
  mediaTypeFromContentType,
  mightBeMediaByRequestHeaders,
  normalizeUrl,
  normalizeUrlForLookup,
  sanitizeHeaders,
  shouldSkip,
  titleFromUrl
} from './utils'
import type { RequestMeta, SnifferResource } from '../../types/sniffer-types'

function inferMediaTypeFromUrl(url: string): SnifferResource['type'] | null {
  const cleanUrl = url.toLowerCase().split('#')[0].split('?')[0]

  if (/\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(cleanUrl)) return 'image'
  if (/\.(mp4|webm|mov|mkv|m3u8|mpd|flv)$/i.test(cleanUrl)) return 'video'
  if (/\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(cleanUrl)) return 'audio'

  if (/\/(image|img|cover|avatar)\//i.test(cleanUrl)) return 'image'
  if (/\/(audio|music|voice|podcast)\//i.test(cleanUrl)) return 'audio'

  return null
}

function inferMediaType(
  url: string,
  requestHeaders?: Record<string, string>,
  contentType?: string
): SnifferResource['type'] | null {
  const confirmedType = mediaTypeFromContentType(contentType || '')
  if (confirmedType) return confirmedType

  const fetchDest = (getHeaderValue(requestHeaders, 'sec-fetch-dest') || '').toLowerCase()
  if (fetchDest === 'image') return 'image'
  if (fetchDest === 'audio') return 'audio'
  if (fetchDest === 'video') return 'video'

  const accept = (getHeaderValue(requestHeaders, 'accept') || '').toLowerCase()
  if (accept.includes('image/')) return 'image'
  if (accept.includes('audio/')) return 'audio'
  if (accept.includes('video/')) return 'video'

  return inferMediaTypeFromUrl(url)
}

function buildResource(
  url: string,
  meta: RequestMeta,
  type: SnifferResource['type'],
  confidence: SnifferResource['confidence'],
  source: SnifferResource['source']
): SnifferResource {
  return {
    id: `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    url,
    title: titleFromUrl(url),
    capturedAt: Date.now(),
    contentType: meta.contentType,
    size: meta.contentLength ? formatSize(meta.contentLength) : undefined,
    pageUrl: meta.pageUrl,
    requestHeaders: sanitizeHeaders(meta.requestHeaders),
    confidence,
    source
  }
}

function handleResponseStarted(partition: string, details: Electron.OnResponseStartedListenerDetails): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  const lookupUrl = normalizeUrlForLookup(details.url)
  if (shouldSkip(url)) return
  if (state.seenUrls.has(lookupUrl)) return

  if (isLikelyStreamSegmentUrl(url)) {
    rememberSeenUrl(state, lookupUrl)
    return
  }

  const flatResHeaders = flattenHeaders(details.responseHeaders ?? {})
  const ct = flatResHeaders['content-type'] || ''
  const contentLength = resolveContentLength(flatResHeaders)
  const requestId = (details as { requestId?: string }).requestId
  const requestMeta = consumeRequestMetaById(state, requestId)
  const existingMeta = state.requestMetaCache.get(lookupUrl)
  const requestHeaders = {
    ...(existingMeta?.requestHeaders ?? {}),
    ...(requestMeta?.requestHeaders ?? {})
  }

  const meta: RequestMeta = {
    ...(existingMeta ?? {}),
    ...(requestMeta ?? {}),
    requestHeaders,
    referer: getHeaderValue(requestHeaders, 'referer'),
    pageUrl: requestMeta?.pageUrl || existingMeta?.pageUrl || getHeaderValue(requestHeaders, 'referer'),
    contentType: ct || requestMeta?.contentType || existingMeta?.contentType,
    contentLength: Math.max(contentLength, requestMeta?.contentLength ?? 0, existingMeta?.contentLength ?? 0),
    ts: Date.now()
  }

  const confirmedType = mediaTypeFromContentType(ct)
  const maybeMedia = confirmedType ? true : mightBeMediaByRequestHeaders(url, requestHeaders)
  const mediaType = confirmedType || (maybeMedia ? inferMediaType(url, requestHeaders, ct) : null)
  if (!mediaType) {
    cacheRequestMeta(state, lookupUrl, meta)
    return
  }

  if (mediaType === 'image' && (meta.contentLength ?? 0) > 0 && (meta.contentLength ?? 0) < MIN_IMAGE_SIZE) {
    cacheRequestMeta(state, lookupUrl, meta)
    return
  }

  if (!meta.sniffed) {
    meta.sniffed = true
    state.sniffedCount++
  }

  const confirmed = Boolean(confirmedType)
  const shouldEmit = confirmed || !meta.emitted

  if (!meta.identified) {
    meta.identified = true
    state.identifiedCount++
  }

  meta.emitted = true
  cacheRequestMeta(state, lookupUrl, meta)
  rememberSeenUrl(state, lookupUrl)

  if (shouldEmit) {
    emitResource(
      partition,
      buildResource(url, meta, mediaType, confirmed ? 'confirmed' : 'probable', 'response-header')
    )
  }

  broadcastStats(statsOf(state, partition))
}

function handleBeforeSendHeaders(
  partition: string,
  details: { url: string; requestHeaders: Record<string, string>; requestId?: string }
): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  const lookupUrl = normalizeUrlForLookup(details.url)
  if (shouldSkip(url)) return
  if (state.seenUrls.has(lookupUrl)) return

  if (isLikelyStreamSegmentUrl(url)) {
    rememberSeenUrl(state, lookupUrl)
    return
  }

  const existingMeta = state.requestMetaCache.get(lookupUrl)
  const requestHeaders = {
    ...(existingMeta?.requestHeaders ?? {}),
    ...details.requestHeaders
  }

  const meta: RequestMeta = {
    ...(existingMeta ?? {}),
    requestHeaders,
    referer: getHeaderValue(requestHeaders, 'referer'),
    pageUrl: existingMeta?.pageUrl || getHeaderValue(requestHeaders, 'referer'),
    ts: Date.now()
  }

  const maybeMedia = mightBeMediaByRequestHeaders(url, requestHeaders)
  if (maybeMedia && !meta.sniffed) {
    meta.sniffed = true
    state.sniffedCount++
  }

  const mediaType = maybeMedia ? inferMediaType(url, requestHeaders, meta.contentType) : null
  const shouldEmit = Boolean(mediaType && !meta.emitted)

  if (shouldEmit) {
    meta.identified = true
    meta.emitted = true
    state.identifiedCount++
  }

  cacheRequestMeta(state, lookupUrl, meta)

  if (details.requestId) {
    cacheRequestMetaById(state, details.requestId, meta)
  }

  if (!shouldEmit || !mediaType) {
    if (maybeMedia) broadcastStats(statsOf(state, partition))
    return
  }

  emitResource(partition, buildResource(url, meta, mediaType, 'probable', 'request-header'))
  broadcastStats(statsOf(state, partition))
}

export function ensurePartitionListener(partition: string): void {
  if (listenedPartitions.has(partition)) return
  listenedPartitions.add(partition)

  const ses = session.fromPartition(partition)

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ requestHeaders: details.requestHeaders })
    handleBeforeSendHeaders(partition, {
      url: details.url,
      requestHeaders: details.requestHeaders as Record<string, string>,
      requestId: (details as { requestId?: string }).requestId
    })
  })

  ses.webRequest.onResponseStarted({ urls: ['<all_urls>'] }, (details) => {
    handleResponseStarted(partition, details)
  })

  ses.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
    const state = snifferStates.get(partition)
    if (!state) return
    dropRequestMetaById(state, (details as { requestId?: string }).requestId)
  })

  log.info(`[Sniffer] Listeners attached to partition: ${partition}`)
}

export function startInterception(partition: string): void {
  const state = createState(partition)
  snifferStates.set(partition, state)
  ensurePartitionListener(partition)
  log.info(`[Sniffer] Started: ${partition}`)
  broadcastStats(statsOf(state, partition))
}

export function stopInterception(partition: string): void {
  const state = snifferStates.get(partition)
  if (!state) {
    broadcastStats(statsOf(undefined, partition))
    return
  }
  state.active = false
  log.info(`[Sniffer] Stopped: ${partition}`)
  broadcastStats(statsOf(state, partition))
}

export function resetInterception(partition: string): void {
  const state = snifferStates.get(partition)
  if (!state) {
    broadcastStats(statsOf(undefined, partition))
    return
  }
  state.sniffedCount = 0
  state.identifiedCount = 0
  state.discardedCount = 0
  state.discardedUrls = []
  state.seenUrls.clear()
  state.seenOrder = []
  state.requestMetaCache.clear()
  state.requestMetaById.clear()
  broadcastStats(statsOf(state, partition))
}
