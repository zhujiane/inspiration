export interface SnifferResource {
  id: string
  type: 'video' | 'audio' | 'image'
  url: string
  title: string
  capturedAt: number
  pageUrl?: string
  contentType?: string
  size?: string
  resolution?: string
  duration?: string
  thumbnailUrl?: string
  requestHeaders?: Record<string, string>
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

export interface RequestMeta {
  requestHeaders: Record<string, string>
  referer?: string
  pageUrl?: string
  contentType?: string
  contentLength?: number
  ts: number
}

export interface SnifferState {
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
  requestMetaCache: Map<string, RequestMeta>
  requestMetaById: Map<string, RequestMeta>
}

export interface HeadResult {
  contentType: string
  contentLength: number
  acceptRanges: boolean
  etag?: string
  finalUrl?: string
  contentDisposition?: string
}

export type SnifferDownloadResourceInput = {
  id: string
  type: 'video' | 'audio' | 'image'
  url: string
  title: string
  capturedAt?: number
  pageUrl?: string
  contentType?: string
  duration?: string
  requestHeaders?: Record<string, string>
}

export type SnifferMergeTaskInput = {
  id: string
  video: SnifferDownloadResourceInput
  audio: SnifferDownloadResourceInput
}
