import { spawn } from 'child_process'
import { createHash } from 'crypto'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { promises as fs } from 'fs'
import path from 'path'
import log from './logger'
import type { AnalyzeInput, AnalyzeResult, ProbeMetadata, ProbeStream } from '../types/ffmpeg-types'

const ffprobePath = ffprobeStatic.path

type SpawnResult = {
  stdout: Buffer
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const FINGERPRINT_CHUNK_BYTES = 1024 * 1024

const isHttpUrl = (input: string): boolean => input.startsWith('http://') || input.startsWith('https://')

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'])
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const getFfmpegPath = (): string => {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg binary is not available')
  }
  return ffmpegStatic
}

const getFfprobePath = (): string => {
  if (!ffprobePath) {
    throw new Error('ffprobe binary is not available')
  }
  return ffprobePath
}

const toHeaderLines = (header?: Record<string, string>): string | null => {
  if (!header) return null
  const lines = Object.entries(header)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${value.replace(/[\r\n]+/g, ' ').trim()}`)
    .join('\r\n')
  return lines ? `${lines}\r\n` : null
}

const buildInputArgs = (source: string, header?: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS): string[] => {
  const args: string[] = []
  const headerLines = toHeaderLines(header)

  if (headerLines) {
    args.push('-headers', headerLines)
  }

  if (isHttpUrl(source)) {
    args.push('-rw_timeout', String(timeoutMs * 1000), '-reconnect', '1', '-reconnect_streamed', '1')
  }

  args.push('-i', source)
  return args
}

const runProcess = (
  binaryPath: string,
  args: string[],
  options?: {
    timeoutMs?: number
    stdoutLimitBytes?: number
  }
): Promise<SpawnResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { windowsHide: true })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const stdoutLimitBytes = options?.stdoutLimitBytes ?? Number.POSITIVE_INFINITY
    let stdoutLength = 0
    let settled = false

    const finish = (handler: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      handler()
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL')
        reject(new Error(`${binaryPath} timeout`))
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLength += chunk.length
      if (stdoutLength > stdoutLimitBytes) {
        finish(() => {
          child.kill('SIGKILL')
          reject(new Error(`${binaryPath} stdout exceeded limit`))
        })
        return
      }
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      finish(() => reject(error))
    })

    child.on('close', (code) => {
      finish(() => {
        const stdout = Buffer.concat(stdoutChunks)
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        if (code === 0) {
          resolve({ stdout, stderr })
          return
        }
        reject(new Error(stderr || `${binaryPath} exited with code ${code}`))
      })
    })
  })

export const runFfprobe = async (
  source: string,
  header?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<any> => {
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    ...buildInputArgs(source, header, timeoutMs)
  ]
  const { stdout } = await runProcess(getFfprobePath(), args, {
    timeoutMs,
    stdoutLimitBytes: 2 * 1024 * 1024
  })
  return JSON.parse(stdout.toString('utf8'))
}

export const captureVideoFrame = async (
  source: string,
  header?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Buffer> => {
  const args = [
    '-v',
    'error',
    '-ss',
    '0',
    ...buildInputArgs(source, header, timeoutMs),
    '-frames:v',
    '1',
    '-f',
    'image2',
    '-vcodec',
    'mjpeg',
    '-vf',
    'scale=320:-1',
    'pipe:1'
  ]
  const { stdout } = await runProcess(getFfmpegPath(), args, {
    timeoutMs,
    stdoutLimitBytes: 8 * 1024 * 1024
  })
  return stdout
}

export const mergeMediaTracks = async (
  videoPath: string,
  audioPath: string,
  outputPath: string,
  timeoutMs = 120_000
): Promise<void> => {
  let audioCodec = ''
  try {
    const meta = await runFfprobe(audioPath, undefined, Math.min(timeoutMs, 15_000))
    const stream = meta?.streams?.find((s: any) => s?.codec_type === 'audio')
    audioCodec = String(stream?.codec_name ?? '').toLowerCase()
  } catch (error) {
    log.debug(`[FFmpeg] ffprobe audio failed, will fallback to aac encode: ${String(error)}`)
  }

  const shouldCopyAudio = audioCodec === 'aac'
  log.debug('[FFmpeg] mergeMediaTracks', { audioCodec, shouldCopyAudio, videoPath, audioPath, outputPath })

  const args = [
    '-y',
    '-v',
    'error',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    shouldCopyAudio ? 'copy' : 'aac',
    '-shortest',
    outputPath
  ]
  await runProcess(getFfmpegPath(), args, { timeoutMs })
}

const parseDuration = (raw: unknown): number => {
  if (!raw || raw === 'N/A') return 0
  const num = Number(raw)
  return Number.isFinite(num) ? num : 0
}

const md5 = (input: string | Buffer): string => createHash('md5').update(input).digest('hex')

const md5FileChunk = async (filePath: string, start: number, length: number): Promise<string> => {
  if (length <= 0) return md5('')
  const handle = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buf, 0, length, start)
    return md5(bytesRead === length ? buf : buf.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

const buildFileFingerprint = async (
  filePath: string,
  info: { size: number; duration: number; width: number; height: number }
): Promise<string> => {
  const size = Math.max(0, Math.floor(info.size || 0))
  const duration = Number.isFinite(info.duration) ? info.duration : 0
  const width = Math.max(0, Math.floor(info.width || 0))
  const height = Math.max(0, Math.floor(info.height || 0))

  const firstLen = Math.min(FINGERPRINT_CHUNK_BYTES, size)
  const firstHash = await md5FileChunk(filePath, 0, firstLen)

  const lastHash =
    size <= FINGERPRINT_CHUNK_BYTES
      ? firstHash
      : await md5FileChunk(
          filePath,
          Math.max(0, size - FINGERPRINT_CHUNK_BYTES),
          Math.min(FINGERPRINT_CHUNK_BYTES, size)
        )

  // fingerprint = hash(fileSize + duration + width + height + hash(first 1MB) + hash(last 1MB))
  return md5(`${size}|${duration}|${width}|${height}|${firstHash}|${lastHash}`)
}

const ffprobe = (source: string, header?: Record<string, string>): Promise<ProbeMetadata> =>
  runFfprobe(
    source,
    {
      'User-Agent': DEFAULT_USER_AGENT,
      ...(header ?? {})
    },
    DEFAULT_TIMEOUT_MS
  ) as Promise<ProbeMetadata>

const getMimeExt = (filePath: string): string => {
  const ext = path.extname(filePath).slice(1).toLowerCase() || 'jpeg'
  return ext === 'jpg' ? 'jpeg' : ext
}

const isAttachedPictureStream = (stream?: ProbeStream): boolean => {
  if (!stream) return false
  if (stream.disposition?.attached_pic === 1 || stream.disposition?.attached_pic === true) return true

  const codecName = String(stream.codec_name ?? '').toLowerCase()
  const codecTag = String(stream.codec_tag_string ?? '').toLowerCase()
  return ['mjpeg', 'png', 'webp'].includes(codecName) || codecTag === 'mp4a'
}

const detectFileType = (filePath: string, metadata: ProbeMetadata): AnalyzeResult['type'] => {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const formatName = metadata.format?.format_name || ''
  const duration = parseDuration(metadata.format?.duration)

  const videoStreams = metadata.streams?.filter((s) => s.codec_type === 'video' && !isAttachedPictureStream(s)) || []
  const audioStreams = metadata.streams?.filter((s) => s.codec_type === 'audio') || []

  const isImageByFormat =
    IMAGE_EXT.has(ext) ||
    formatName.includes('image') ||
    formatName.includes('png') ||
    formatName.includes('jpeg') ||
    formatName.includes('gif') ||
    formatName.includes('webp')

  if (isImageByFormat && videoStreams.length === 1) return 'image'
  if (videoStreams.length > 0 && duration > 0) return 'video'
  if (audioStreams.length > 0 && videoStreams.length === 0) return 'audio'
  return 'other'
}

const getFirstFrameToBase64 = (source: string, header?: Record<string, string>): Promise<string> =>
  captureVideoFrame(
    source,
    {
      'User-Agent': DEFAULT_USER_AGENT,
      ...(header ?? {})
    },
    DEFAULT_TIMEOUT_MS
  ).then((buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`)

export const analyzeMedia = async (input: AnalyzeInput): Promise<AnalyzeResult> => {
  const isUrl = isHttpUrl(input.path)
  if (!isUrl) {
    try {
      await fs.access(input.path)
    } catch {
      throw new Error('文件不存在')
    }
  }

  const metadata = await ffprobe(input.path, input.header)
  const stats = isUrl ? { size: 0 } : await fs.stat(input.path)

  const videoStream = metadata.streams?.find((s) => s.codec_type === 'video')
  const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio')
  const fileType = detectFileType(input.path, metadata)
  const duration = parseDuration(metadata.format?.duration)

  let fingerprint: string | undefined
  if (!isUrl) {
    try {
      fingerprint = await buildFileFingerprint(input.path, {
        size: stats.size,
        duration,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0
      })
    } catch (err) {
      log.error('Failed to build fingerprint:', err)
    }
  }

  const result: AnalyzeResult = {
    type: fileType,
    size: stats.size,
    width: videoStream?.width,
    height: videoStream?.height,
    duration: duration || undefined,
    format: metadata.format?.format_name,
    videoCodec: videoStream?.codec_name,
    audioCodec: audioStream?.codec_name,
    md5: fingerprint
  }

  if (fileType === 'image') {
    if (isUrl) {
      result.cover = input.path
    } else {
      try {
        const base64 = await fs.readFile(input.path, { encoding: 'base64' })
        result.cover = `data:image/${getMimeExt(input.path)};base64,${base64}`
      } catch (err) {
        log.error('Image read error:', err)
      }
    }
  }

  if (fileType === 'video') {
    try {
      result.cover = await getFirstFrameToBase64(input.path, input.header)
    } catch (err) {
      log.error('Failed to capture video cover:', err)
    }
  }

  return result
}
