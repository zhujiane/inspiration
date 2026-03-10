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
  sniffed?: boolean
  identified?: boolean
  emitted?: boolean
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
  /**
   * 预览封面（通常是 dataURL 或可直接访问的图片 URL）
   * - 对视频：嗅探阶段可能已通过 ffprobe/截图拿到
   * - 对图片：可直接用 resource.url 或 thumbnailUrl
   */
  thumbnailUrl?: string
  /**
   * 分辨率文本（例如 "1920×1080" 或 "1920x1080"）
   */
  resolution?: string
  /**
   * 尺寸文本（例如 "12.3 MB"），非必需
   */
  size?: string
  requestHeaders?: Record<string, string>
}

export type SnifferMergeTaskInput = {
  id: string
  video: SnifferDownloadResourceInput
  audio: SnifferDownloadResourceInput
}

export interface SnifferDownloadProgressPayload {
  /**
   * 任务类型：
   * - download: 单资源下载到素材库
   * - merge: 合并音视频并入库
   */
  type: 'download' | 'merge'
  /**
   * 对于单下载：resource.id
   * 对于合并任务：SnifferMergeTaskInput.id
   */
  id: string
  /**
   * 当前阶段
   */
  phase: 'download' | 'video' | 'audio' | 'merge' | 'analyze' | 'library'
  /**
   * 0-100 的进度百分比（整数）
   */
  progress: number
  /**
   * 可选的人类可读提示
   */
  message?: string
}
