import { publicProcedure, trpc } from '@shared/routers/trpc'
import { z } from 'zod'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import md5File from 'md5-file'
import { promises as fs } from 'fs'
import path from 'path'
import log from '../core/logger'

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

type ProbeStream = {
  codec_type?: string
  width?: number
  height?: number
  codec_name?: string
  codec_tag_string?: string
  disposition?: {
    attached_pic?: number | boolean
  }
}

type ProbeMetadata = {
  format?: {
    format_name?: string
    duration?: string | number
  }
  streams?: ProbeStream[]
}

type AnalyzeResult = {
  type: 'image' | 'video' | 'audio' | 'other'
  size: number
  width?: number
  height?: number
  duration?: number
  format?: string
  videoCodec?: string
  audioCodec?: string
  md5?: string
  cover?: string
}

export type AnalyzeInput = {
  path: string
  header?: Record<string, string>
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'])
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const FFMPEG_TIMEOUT_MS = 15_000

const isHttpUrl = (input: string): boolean => input.startsWith('http://') || input.startsWith('https://')

const parseDuration = (raw: unknown): number => {
  if (!raw || raw === 'N/A') return 0
  const num = Number(raw)
  return Number.isFinite(num) ? num : 0
}

const toFfmpegHeaders = (header?: Record<string, string>): string | null => {
  const normalizedHeader = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...(header ?? {})
  }
  const lines = Object.entries(normalizedHeader)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${value.replace(/[\r\n]+/g, ' ').trim()}`)
    .join('\r\n')
  return lines ? `${lines}\r\n` : null
}

const createInputCommand = (source: string, header?: Record<string, string>) => {
  const command = ffmpeg().input(source)
  const headerLines = toFfmpegHeaders(header)
  if (headerLines) {
    command.inputOptions(['-headers', headerLines])
  }
  if (isHttpUrl(source)) {
    command.inputOptions([
      '-rw_timeout',
      String(FFMPEG_TIMEOUT_MS * 1000),
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1'
    ])
  }
  return command
}

const ffprobe = (source: string, header?: Record<string, string>): Promise<ProbeMetadata> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ffprobe timeout')), FFMPEG_TIMEOUT_MS)
    createInputCommand(source, header).ffprobe((err, data) => {
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(data as ProbeMetadata)
    })
  })

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
  new Promise((resolve, reject) => {
    let settled = false
    const buffers: Buffer[] = []

    const command = createInputCommand(source, header)
      .seekInput(0)
      .frames(1)
      .outputOptions(['-f image2', '-vcodec mjpeg', '-vf scale=320:-1'])
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      command.kill('SIGKILL')
      reject(new Error('ffmpeg screenshot timeout'))
    }, FFMPEG_TIMEOUT_MS)

    command.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log.error('Video screenshot error:', err)
      reject(err)
    })

    command.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(`data:image/jpeg;base64,${Buffer.concat(buffers).toString('base64')}`)
    })

    const stream = command.pipe()
    stream.on('data', (chunk: Buffer) => buffers.push(chunk))
    stream.on('error', (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log.error('Video screenshot stream error:', err)
      reject(err)
    })
  })

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
  const [stats, md5] = isUrl ? [{ size: 0 }, undefined] : await Promise.all([fs.stat(input.path), md5File(input.path)])

  const videoStream = metadata.streams?.find((s) => s.codec_type === 'video')
  const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio')
  const fileType = detectFileType(input.path, metadata)

  const result: AnalyzeResult = {
    type: fileType,
    size: stats.size,
    width: videoStream?.width,
    height: videoStream?.height,
    duration: metadata.format?.duration ? Number(metadata.format.duration) : undefined,
    format: metadata.format?.format_name,
    videoCodec: videoStream?.codec_name,
    audioCodec: audioStream?.codec_name,
    md5
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

export const ffmpegRouter = trpc.router({
  analyze: publicProcedure
    .input(z.object({ path: z.string(), header: z.record(z.string(), z.string()).optional() }))
    .query(async ({ input }) => analyzeMedia(input))
})
