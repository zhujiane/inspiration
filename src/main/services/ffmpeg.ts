import { createHash } from 'crypto'
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import mediaInfoFactory, { isTrackType, type MediaInfo, type MediaInfoResult } from 'mediainfo.js'
import { promises as fs } from 'fs'
import path from 'path'
import log from './logger'
import type { AnalyzeInput, AnalyzeResult, ProbeMetadata, ProbeStream } from '../types/ffmpeg-types'

const mediaInfoWasmPath = require.resolve('mediainfo.js/MediaInfoModule.wasm')
let mediaInfoInstancePromise: Promise<MediaInfo<'object'>> | null = null

type SpawnResult = {
  stdout: Buffer
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const FINGERPRINT_CHUNK_BYTES = 1024 * 1024
const isHttpUrl = (input: string): boolean => input.startsWith('http://') || input.startsWith('https://')

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'])

const getFfmpegPath = (): string => {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg binary is not available')
  }
  return ffmpegStatic
}

const assertLocalPath = (source: string): void => {
  if (isHttpUrl(source)) {
    throw new Error('仅支持本地文件')
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout`))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

const getMediaInfo = async (): Promise<MediaInfo<'object'>> => {
  if (!mediaInfoInstancePromise) {
    mediaInfoInstancePromise = mediaInfoFactory<'object'>({
      format: 'object',
      locateFile: () => mediaInfoWasmPath
    })
  }

  return mediaInfoInstancePromise
}

const normalizeCodecName = (...values: Array<unknown>): string | undefined => {
  for (const value of values) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
    if (normalized) {
      return normalized
    }
  }
  return undefined
}

const convertMediaInfoToProbeMetadata = (result: MediaInfoResult): ProbeMetadata => {
  const tracks = result.media?.track ?? []
  const generalTrack = tracks.find((track) => isTrackType(track, 'General'))
  const primaryMediaTrack =
    tracks.find((track) => isTrackType(track, 'Video')) ||
    tracks.find((track) => isTrackType(track, 'Audio')) ||
    tracks.find((track) => isTrackType(track, 'Image'))

  const streams: ProbeStream[] = tracks.flatMap((track) => {
    if (isTrackType(track, 'Video')) {
      return [
        {
          codec_type: 'video',
          width: track.Width,
          height: track.Height,
          codec_name: normalizeCodecName(
            track.Format_Commercial_IfAny,
            track.Format,
            track.CodecID,
            track.CodecID_Hint
          ),
          codec_tag_string: normalizeCodecName(track.CodecID),
          disposition: {
            attached_pic: false
          }
        }
      ]
    }

    if (isTrackType(track, 'Audio')) {
      return [
        {
          codec_type: 'audio',
          codec_name: normalizeCodecName(
            track.Format_Commercial_IfAny,
            track.Format,
            track.CodecID,
            track.CodecID_Hint
          ),
          codec_tag_string: normalizeCodecName(track.CodecID)
        }
      ]
    }

    if (isTrackType(track, 'Image')) {
      return [
        {
          codec_type: 'video',
          width: track.Width,
          height: track.Height,
          codec_name: normalizeCodecName(track.Format_Commercial_IfAny, track.Format, track.CodecID),
          codec_tag_string: normalizeCodecName(track.CodecID),
          disposition: {
            attached_pic: false
          }
        }
      ]
    }

    return []
  })

  const durationSeconds =
    typeof generalTrack?.Duration === 'number' && Number.isFinite(generalTrack.Duration)
      ? generalTrack.Duration / 1000
      : undefined

  return {
    format: {
      format_name: normalizeCodecName(generalTrack?.Format, primaryMediaTrack?.Format),
      duration: durationSeconds
    },
    streams
  }
}

const runMediaInfo = async (source: string, timeoutMs: number): Promise<ProbeMetadata> => {
  const fileHandle = await fs.open(source, 'r')

  try {
    const stats = await fileHandle.stat()
    const mediaInfo = await getMediaInfo()
    const result = await withTimeout(
      mediaInfo.analyzeData(stats.size, async (size, offset) => {
        const targetSize = Math.max(0, Math.min(size, stats.size - offset))
        if (targetSize === 0) return new Uint8Array(0)

        const chunk = Buffer.allocUnsafe(targetSize)
        const { bytesRead } = await fileHandle.read(chunk, 0, targetSize, offset)
        return new Uint8Array(chunk.buffer, chunk.byteOffset, bytesRead)
      }),
      timeoutMs,
      'mediainfo'
    )

    return convertMediaInfoToProbeMetadata(result)
  } finally {
    await fileHandle.close()
  }
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
  _header?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<any> => {
  assertLocalPath(source)
  return runMediaInfo(source, timeoutMs)
}

export const captureVideoFrame = async (
  source: string,
  _header?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Buffer> => {
  assertLocalPath(source)
  const args = [
    '-v',
    'error',
    '-ss',
    '0',
    '-i',
    source,
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
  const runMerge = async (audioCodec: 'copy' | 'aac'): Promise<void> => {
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
      audioCodec,
      '-shortest',
      outputPath
    ]

    log.debug('[FFmpeg] mergeMediaTracks', { audioCodec, videoPath, audioPath, outputPath })
    await runProcess(getFfmpegPath(), args, { timeoutMs })
  }

  try {
    await runMerge('copy')
  } catch (error) {
    log.debug(`[FFmpeg] merge copy audio failed, fallback to aac encode: ${String(error)}`)
    await runMerge('aac')
  }
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

  return md5(`${size}|${duration}|${width}|${height}|${firstHash}|${lastHash}`)
}

const ffprobe = (source: string): Promise<ProbeMetadata> =>
  runFfprobe(source, undefined, DEFAULT_TIMEOUT_MS) as Promise<ProbeMetadata>

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

const getFirstFrameToBase64 = (source: string): Promise<string> =>
  captureVideoFrame(source, undefined, DEFAULT_TIMEOUT_MS).then(
    (buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`
  )

export const analyzeMedia = async (input: AnalyzeInput): Promise<AnalyzeResult> => {
  if (isHttpUrl(input.path)) {
    throw new Error('仅支持本地文件')
  }

  try {
    await fs.access(input.path)
  } catch {
    throw new Error('文件不存在')
  }

  const metadata = await ffprobe(input.path)
  const stats = await fs.stat(input.path)

  const videoStream = metadata.streams?.find((s) => s.codec_type === 'video')
  const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio')
  const fileType = detectFileType(input.path, metadata)
  const duration = parseDuration(metadata.format?.duration)
  let fingerprint: string | undefined

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
    try {
      const base64 = await fs.readFile(input.path, { encoding: 'base64' })
      result.cover = `data:image/${getMimeExt(input.path)};base64,${base64}`
    } catch (err) {
      log.error('Image read error:', err)
    }
  }

  if (fileType === 'video') {
    try {
      result.cover = await getFirstFrameToBase64(input.path)
    } catch (err) {
      log.error('Failed to capture video cover:', err)
    }
  }

  return result
}
