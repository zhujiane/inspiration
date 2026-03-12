export function normalizeMediaSrc(src?: string): string | undefined {
  if (!src) return undefined
  const actualSrc = src.replace(/\\/g, '/')
  return actualSrc.startsWith('http') || actualSrc.startsWith('file://') ? actualSrc : `file:///${actualSrc}`
}

export function isHlsMediaSource(src?: string, contentType?: string): boolean {
  if (contentType) {
    const normalizedContentType = contentType.toLowerCase().split(';')[0].trim()
    if (
      normalizedContentType === 'application/vnd.apple.mpegurl' ||
      normalizedContentType === 'application/x-mpegurl' ||
      normalizedContentType === 'audio/mpegurl' ||
      normalizedContentType === 'audio/x-mpegurl'
    ) {
      return true
    }
  }

  if (!src) return false
  return /\.m3u8(?:$|[?#])/i.test(src)
}

export function buildPreviewProxyUrl(src?: string, requestHeaders?: Record<string, string>): string | undefined {
  const normalizedSrc = normalizeMediaSrc(src)
  if (!normalizedSrc) return normalizedSrc

  const search = new URLSearchParams()
  search.set('url', normalizedSrc)

  if (normalizedSrc.startsWith('http') && requestHeaders && Object.keys(requestHeaders).length > 0) {
    search.set('headers', encodeURIComponent(JSON.stringify(requestHeaders)))
  }

  return `sniffer-media://preview?${search.toString()}`
}
