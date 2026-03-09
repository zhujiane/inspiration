import { session } from 'electron'
import log from '../logger'
import { MIN_IMAGE_SIZE } from './constants'
import { broadcastStats, emitResource } from './broadcast'
import { headRequest, resolveContentLength } from './http'
import { shouldProbeConfirmedMedia } from './ffprobe'
import { enqueueForFfprobe } from './queue'
import { listenedPartitions, snifferStates } from './runtime'
import {
  cacheRequestMeta,
  cacheRequestMetaById,
  consumeRequestMetaById,
  createState,
  dropRequestMetaById,
  recordDiscardedUrl,
  rememberSeenUrl,
  statsOf
} from './state'
import {
  flattenHeaders,
  getHeaderValue,
  isAmbiguousContentType,
  isLikelyStreamSegmentUrl,
  mediaTypeFromContentType,
  mightBeMediaByUrl,
  normalizeUrl,
  sanitizeHeaders,
  shouldSkip,
  titleFromUrl,
  formatSize
} from './utils'
import type { RequestMeta, SnifferResource, SnifferState } from '../../types/sniffer-types'

function handleResponseStarted(partition: string, details: Electron.OnResponseStartedListenerDetails): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  if (shouldSkip(url)) return
  if (state.seenUrls.has(url)) return
  // HLS/DASH 分片数量巨大，且对用户几乎无意义；跳过可显著减少“分析中很久”的情况
  if (isLikelyStreamSegmentUrl(url)) {
    rememberSeenUrl(state, url)
    return
  }

  const flatResHeaders = flattenHeaders(details.responseHeaders ?? {})
  const ct = flatResHeaders['content-type'] || ''
  const contentLength = resolveContentLength(flatResHeaders)

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

  const mediaType = mediaTypeFromContentType(ct)
  if (mediaType) {
    if (shouldProbeConfirmedMedia(url, ct)) {
      rememberSeenUrl(state, url)
      state.sniffedCount++
      enqueueForFfprobe(partition, state, url)
      broadcastStats(statsOf(state, partition))
      return
    }

    const resBytes = meta.contentLength ?? 0
    if (mediaType === 'image' && resBytes > 0 && resBytes < MIN_IMAGE_SIZE) return

    rememberSeenUrl(state, url)
    state.sniffedCount++
    state.identifiedCount++

    const resource: SnifferResource = {
      id: `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: mediaType,
      url,
      title: titleFromUrl(url),
      capturedAt: Date.now(),
      contentType: ct,
      size: resBytes ? formatSize(resBytes) : undefined,
      pageUrl: meta.pageUrl,
      requestHeaders: sanitizeHeaders(mergedRequestHeaders),
      confidence: 'confirmed',
      source: 'response-header'
    }

    emitResource(partition, resource)
    broadcastStats(statsOf(state, partition))
    return
  }

  if (isAmbiguousContentType(ct) && mightBeMediaByUrl(url)) {
    state.sniffedCount++
    enqueueForFfprobe(partition, state, url)
    broadcastStats(statsOf(state, partition))
    return
  }
}

function handleBeforeSendHeaders(
  partition: string,
  details: { url: string; requestHeaders: Record<string, string>; requestId?: string }
): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  const url = normalizeUrl(details.url)
  if (shouldSkip(url)) return
  if (state.seenUrls.has(url)) return

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
}

export function handleDomUrls(partition: string, urls: string[]): void {
  const state = snifferStates.get(partition)
  if (!state || !state.active) return

  for (const raw of urls) {
    const url = normalizeUrl(raw)
    if (shouldSkip(url)) continue
    if (state.seenUrls.has(url)) continue
    if (isLikelyStreamSegmentUrl(url)) {
      rememberSeenUrl(state, url)
      continue
    }
    if (state.pendingHeadUrls.has(url)) continue

    state.pendingHeadUrls.add(url)
    state.sniffedCount++
    broadcastStats(statsOf(state, partition))

    void verifyByHead(url, state, partition).finally(() => {
      state.pendingHeadUrls.delete(url)
    })
  }
}

async function verifyByHead(url: string, state: SnifferState, partition: string): Promise<void> {
  const meta = state.requestMetaCache.get(url)

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
      cacheRequestMeta(state, url, {
        ...(meta ?? { requestHeaders: {} }),
        requestHeaders: meta?.requestHeaders ?? {},
        contentType: head.contentType,
        contentLength: head.contentLength,
        ts: Date.now()
      })

      state.identifiedCount++
      const resource: SnifferResource = {
        id: `sniff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      broadcastStats(statsOf(state, partition))
      return
    }

    if (isAmbiguousContentType(head.contentType) && mightBeMediaByUrl(url)) {
      enqueueForFfprobe(partition, state, url)
      return
    }

    if (!head.contentType && mightBeMediaByUrl(url)) {
      enqueueForFfprobe(partition, state, url)
      return
    }

    recordDiscardedUrl(state, url)
    broadcastStats(statsOf(state, partition))
  } catch {
    recordDiscardedUrl(state, url)
    broadcastStats(statsOf(state, partition))
  }
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
  state.pendingUrls = []
  state.pendingHeadUrls.clear()
  state.pendingAnalyzeUrls.clear()
  state.analyzingUrls.clear()
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
  state.pendingHeadUrls.clear()
  state.pendingAnalyzeUrls.clear()
  state.analyzingUrls.clear()
  state.pendingUrls = []
  state.requestMetaCache.clear()
  state.requestMetaById.clear()
  broadcastStats(statsOf(state, partition))
}
