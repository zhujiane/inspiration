import log from '../logger'
import { MAX_CONCURRENT_ANALYZE } from './constants'
import { broadcastStats, emitResource } from './broadcast'
import { analyzeByFfprobe } from './ffprobe'
import { snifferStates } from './runtime'
import { recordDiscardedUrl, rememberSeenUrl, statsOf } from './state'
import type { SnifferState } from '../../types/sniffer-types'

export function enqueueForFfprobe(partition: string, state: SnifferState, url: string): void {
  if (state.analyzingUrls.has(url) || state.pendingAnalyzeUrls.has(url)) return
  if (!state.seenUrls.has(url)) rememberSeenUrl(state, url)
  state.pendingAnalyzeUrls.add(url)
  state.pendingUrls.push(url)
  drainQueue(partition, state)
}

export function drainQueue(partition: string, state: SnifferState): void {
  while (state.active && state.runningCount < MAX_CONCURRENT_ANALYZE && state.pendingUrls.length > 0) {
    const url = state.pendingUrls.shift()!
    state.pendingAnalyzeUrls.delete(url)
    state.runningCount++
    state.analyzingUrls.add(url)
    broadcastStats(statsOf(state, partition))

    void analyzeByFfprobe(url, state)
      .then((resource) => {
        if (snifferStates.get(partition) !== state || !state.active) return
        if (!resource) {
          recordDiscardedUrl(state, url)
          broadcastStats(statsOf(state, partition))
          return
        }
        state.identifiedCount++
        emitResource(partition, resource)
      })
      .catch((error) => {
        log.debug(`[Sniffer] ffprobe analyze error: ${String(error)}`)
        recordDiscardedUrl(state, url)
        broadcastStats(statsOf(state, partition))
      })
      .finally(() => {
        if (snifferStates.get(partition) !== state) return
        state.runningCount = Math.max(0, state.runningCount - 1)
        state.analyzingUrls.delete(url)
        broadcastStats(statsOf(state, partition))
        drainQueue(partition, state)
      })
  }
}
