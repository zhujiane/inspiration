import { MAX_DISCARDED_URLS, MAX_SEEN_URLS } from './constants'
import type { RequestMeta, SnifferState, SnifferStatsPayload } from '../../types/sniffer-types'

export function createState(partition: string): SnifferState {
  return {
    active: true,
    partition,
    sniffedCount: 0,
    identifiedCount: 0,
    discardedCount: 0,
    discardedUrls: [],
    seenUrls: new Set(),
    seenOrder: [],
    requestMetaCache: new Map(),
    requestMetaById: new Map()
  }
}

export function statsOf(state?: SnifferState, partition?: string): SnifferStatsPayload {
  return {
    partition: state?.partition ?? partition ?? '',
    active: state?.active ?? false,
    sniffedCount: state?.sniffedCount ?? 0,
    identifiedCount: state?.identifiedCount ?? 0,
    discardedCount: state?.discardedCount ?? 0,
    analyzingCount: 0,
    discardedUrls: state?.discardedUrls ?? []
  }
}

export function rememberSeenUrl(state: SnifferState, url: string): void {
  state.seenUrls.add(url)
  state.seenOrder.push(url)
  if (state.seenOrder.length > MAX_SEEN_URLS) {
    const stale = state.seenOrder.shift()
    if (stale) state.seenUrls.delete(stale)
  }
}

export function recordDiscardedUrl(state: SnifferState, url: string): void {
  state.discardedCount++
  state.discardedUrls = [url, ...state.discardedUrls.filter((item) => item !== url)].slice(0, MAX_DISCARDED_URLS)
}

export function cacheRequestMeta(state: SnifferState, url: string, meta: RequestMeta): void {
  state.requestMetaCache.set(url, meta)
  if (state.requestMetaCache.size > 500) {
    const firstKey = state.requestMetaCache.keys().next().value
    if (firstKey) state.requestMetaCache.delete(firstKey)
  }
}

export function cacheRequestMetaById(state: SnifferState, requestId: string, meta: RequestMeta): void {
  state.requestMetaById.set(requestId, meta)
  if (state.requestMetaById.size > 1000) {
    const firstKey = state.requestMetaById.keys().next().value
    if (firstKey) state.requestMetaById.delete(firstKey)
  }
}

export function consumeRequestMetaById(state: SnifferState, requestId?: string): RequestMeta | undefined {
  if (!requestId) return undefined
  const meta = state.requestMetaById.get(requestId)
  if (meta) state.requestMetaById.delete(requestId)
  return meta
}

export function dropRequestMetaById(state: SnifferState, requestId?: string): void {
  if (!requestId) return
  state.requestMetaById.delete(requestId)
}
