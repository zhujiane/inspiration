export const MAX_CONCURRENT_ANALYZE = 3
export const MAX_SEEN_URLS = 3000
export const MAX_DISCARDED_URLS = 100
export const MIN_IMAGE_SIZE = 2048 // 2KB

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

export const CONFIRMED_VIDEO_CT = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-flv',
  'video/x-matroska',
  'video/mpeg',
  'video/3gpp',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/dash+xml'
]

export const CONFIRMED_AUDIO_CT = [
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

export const CONFIRMED_IMAGE_CT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml'
]

export const AMBIGUOUS_CT = ['application/octet-stream', 'binary/octet-stream', 'application/binary']

export const MEDIA_EXTS = new Set([
  'm3u8',
  'mpd',
  'mp4',
  'm4s',
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

export const IMAGE_FFPROBE_FORMATS = new Set([
  'image2',
  'png_pipe',
  'jpeg_pipe',
  'mjpeg',
  'gif',
  'webp_pipe',
  'bmp_pipe'
])

export const SKIP_PATTERNS = [
  /\.(js|css|html|htm|json|xml|woff2?|ttf|eot|ico|txt|map|pdf)(?:\?|#|$)/i,
  /^data:/,
  /^blob:/,
  /^chrome-extension:/,
  /\/favicon\./i,
  /analytics|tracking|beacon|ping|telemetry/i,
  /\/(ads?|advertisement|banner)\//i
]
