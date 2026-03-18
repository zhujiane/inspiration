import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import ffmpegStatic from 'ffmpeg-static'
import type {
  BatchVideoProcessInput,
  BatchVideoProcessStatus,
  BatchVideoProcessResultItem,
  BatchVideoTaskInput,
  VideoAdapterInfo,
  VideoAdapterKind,
  VideoAdapterVendor,
  VideoProcessingCapability,
  VideoProcessingEncoder,
  VideoProcessingStrategy
} from '@shared/ffmpeg/batch-video'
import log from './logger'

type SpawnResult = {
  stdout: Buffer
  stderr: string
  code: number | null
}

type RawVideoController = {
  Name?: string
  AdapterCompatibility?: string
  VideoProcessor?: string
  PNPDeviceID?: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const isHttpUrl = (input: string): boolean => input.startsWith('http://') || input.startsWith('https://')

export const getFfmpegPath = (): string => {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg binary is not available')
  }

  const unpackedPath = ffmpegStatic.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  if (unpackedPath !== ffmpegStatic) {
    if (fs.existsSync(unpackedPath)) {
      log.info(`[FFmpeg] using unpacked binary: ${unpackedPath}`)
      return unpackedPath
    }
    throw new Error(`ffmpeg unpacked binary not found: ${unpackedPath}`)
  }

  if (fs.existsSync(ffmpegStatic)) {
    log.info(`[FFmpeg] using binary: ${ffmpegStatic}`)
    return ffmpegStatic
  }

  throw new Error(`ffmpeg binary not found: ${ffmpegStatic}`)
}

const assertLocalPath = (source: string): void => {
  if (isHttpUrl(source)) {
    throw new Error('仅支持本地文件')
  }
}

const runProcess = (
  binaryPath: string,
  args: string[],
  options?: {
    timeoutMs?: number
    stdoutLimitBytes?: number
    allowNonZeroExit?: boolean
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
        if (code === 0 || options?.allowNonZeroExit) {
          resolve({ stdout, stderr, code })
          return
        }
        reject(new Error(stderr || `${binaryPath} exited with code ${code}`))
      })
    })
  })

export type LocalMediaMeta = {
  type: 'image' | 'video' | 'audio' | 'other'
  size?: number
  width?: number
  height?: number
  duration?: number
  container?: string
  mimeType?: string
  videoCodec?: string
  audioCodec?: string
  browserPlayable?: boolean
}

const parseDurationToSeconds = (raw: string): number | undefined => {
  const match = raw.match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (![hours, minutes, seconds].every((value) => Number.isFinite(value) && value >= 0)) {
    return undefined
  }
  return hours * 3600 + minutes * 60 + seconds
}

const parseResolution = (raw: string): { width?: number; height?: number } => {
  const match = raw.match(/(\d+)\s*x\s*(\d+)(?:[\s,\\[]|$)/i)
  if (!match) return {}
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {}
  }
  return { width, height }
}

const parseVideoStreamMeta = (line: string): Pick<LocalMediaMeta, 'width' | 'height'> => {
  const { width, height } = parseResolution(line)
  return { width, height }
}

const parseContainer = (stderr: string): string | undefined => {
  const match = stderr.match(/Input #0,\s*([^,]+(?:,[^,]+)*),\s*from\s+/i)
  return match?.[1]?.trim() || undefined
}

const parseStreamCodec = (line?: string, streamType?: 'Video' | 'Audio'): string | undefined => {
  if (!line || !streamType) return undefined
  const match = line.match(new RegExp(`${streamType}:\\s*([^,\\s]+)`, 'i'))
  return match?.[1]?.trim().toLowerCase() || undefined
}

const getMimeTypeFromMeta = (meta: Pick<LocalMediaMeta, 'type' | 'container'>): string | undefined => {
  const container = meta.container?.toLowerCase() || ''
  if (meta.type === 'video') {
    if (container.includes('mp4') || container.includes('mov')) return 'video/mp4'
    if (container.includes('matroska') || container.includes('mkv')) return 'video/x-matroska'
    if (container.includes('webm')) return 'video/webm'
    if (container.includes('mpegts')) return 'video/mp2t'
    if (container.includes('avi')) return 'video/x-msvideo'
  }
  if (meta.type === 'audio') {
    if (container.includes('mp3')) return 'audio/mpeg'
    if (container.includes('m4a') || container.includes('mp4') || container.includes('mov')) return 'audio/mp4'
    if (container.includes('aac')) return 'audio/aac'
    if (container.includes('wav')) return 'audio/wav'
    if (container.includes('ogg')) return 'audio/ogg'
    if (container.includes('flac')) return 'audio/flac'
  }
  return undefined
}

const isChromiumPlayableMedia = (
  meta: Pick<LocalMediaMeta, 'type' | 'container' | 'videoCodec' | 'audioCodec'>
): boolean => {
  const container = meta.container?.toLowerCase() || ''
  const videoCodec = meta.videoCodec?.toLowerCase() || ''
  const audioCodec = meta.audioCodec?.toLowerCase() || ''

  if (meta.type === 'audio') {
    return /^(aac|mp3|opus|vorbis|flac|pcm_|alac)/.test(audioCodec)
  }

  if (meta.type !== 'video') return true

  const videoSupported = /^(h264|avc1|vp8|vp9|av1|theora)/.test(videoCodec)
  const audioSupported = !audioCodec || /^(aac|mp3|opus|vorbis|flac|pcm_|alac)/.test(audioCodec)
  const containerSupported =
    container.includes('mp4') ||
    container.includes('mov') ||
    container.includes('matroska') ||
    container.includes('mkv') ||
    container.includes('webm')

  return videoSupported && audioSupported && containerSupported
}

const parseFfmpegInspectOutput = (stderr: string): LocalMediaMeta => {
  const durationMatch = stderr.match(/Duration:\s*([0-9:.]+)/i)
  const duration = parseDurationToSeconds(durationMatch?.[1] || '')
  const container = parseContainer(stderr)
  const streamLines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^Stream #/i.test(line))

  const videoLine = streamLines.find((line) => /Video:/i.test(line))
  const audioLine = streamLines.find((line) => /Audio:/i.test(line))

  if (videoLine) {
    const videoMeta = parseVideoStreamMeta(videoLine)
    const videoCodec = parseStreamCodec(videoLine, 'Video')
    const audioCodec = parseStreamCodec(audioLine, 'Audio')
    const meta: LocalMediaMeta = {
      type: 'video',
      duration,
      container,
      videoCodec,
      audioCodec,
      ...videoMeta
    }
    return {
      ...meta,
      mimeType: getMimeTypeFromMeta(meta),
      browserPlayable: isChromiumPlayableMedia(meta)
    }
  }

  if (audioLine) {
    const audioCodec = parseStreamCodec(audioLine, 'Audio')
    const meta: LocalMediaMeta = {
      type: 'audio',
      duration,
      container,
      audioCodec
    }
    return {
      ...meta,
      mimeType: getMimeTypeFromMeta(meta),
      browserPlayable: isChromiumPlayableMedia(meta)
    }
  }

  return { type: 'other', duration, container, mimeType: getMimeTypeFromMeta({ type: 'other', container }) }
}

export const inspectLocalMedia = async (source: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<LocalMediaMeta> => {
  assertLocalPath(source)
  const args = ['-hide_banner', '-i', source]
  const { stderr } = await runProcess(getFfmpegPath(), args, {
    timeoutMs,
    allowNonZeroExit: true
  })
  return parseFfmpegInspectOutput(stderr)
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

export const captureVideoFrameBase64 = async (
  source: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string | undefined> => {
  const buffer = await captureVideoFrame(source, undefined, timeoutMs).catch((error) => {
    log.debug(`[FFmpeg] captureVideoFrameBase64 failed: ${String(error)}`)
    return null
  })

  if (!buffer || buffer.length === 0) return undefined
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}

export const mergeMediaTracks = async (
  videoPath: string,
  audioPath: string,
  outputPath: string,
  timeoutMs = 120_000
): Promise<void> => {
  const runMerge = async (videoCodec: 'copy' | 'libx264', audioCodec: 'copy' | 'aac'): Promise<void> => {
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
      videoCodec,
      '-c:a',
      audioCodec,
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath
    ]

    if (videoCodec === 'libx264') {
      args.splice(args.length - 3, 0, '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
    }

    log.debug('[FFmpeg] mergeMediaTracks', { videoCodec, audioCodec, videoPath, audioPath, outputPath })
    await runProcess(getFfmpegPath(), args, { timeoutMs })
  }

  try {
    await runMerge('copy', 'copy')
  } catch (error) {
    log.debug(`[FFmpeg] merge copy audio failed, fallback to aac encode: ${String(error)}`)
    await runMerge('copy', 'aac')
  }

  const mergedMeta = await inspectLocalMedia(outputPath, timeoutMs).catch((error) => {
    log.debug(`[FFmpeg] inspect merged media failed: ${String(error)}`)
    return null
  })

  if (mergedMeta?.type === 'video' && mergedMeta.browserPlayable === false) {
    log.debug('[FFmpeg] merged media is not Chromium-playable, fallback to h264/aac transcode', {
      outputPath,
      container: mergedMeta.container,
      videoCodec: mergedMeta.videoCodec,
      audioCodec: mergedMeta.audioCodec
    })
    await runMerge('libx264', 'aac')
  }
}

const normalizeVideoVendor = (input: string): VideoAdapterVendor => {
  const value = input.toLowerCase()
  if (value.includes('nvidia')) return 'nvidia'
  if (value.includes('intel')) return 'intel'
  if (value.includes('amd') || value.includes('advanced micro') || value.includes('radeon') || value.includes('ati')) {
    return 'amd'
  }
  return 'other'
}

const isVirtualVideoAdapter = (input: string): boolean =>
  /(virtual|remote|displaylink|basic render|gameviewer)/i.test(input)

const detectVideoAdapterKind = (vendor: VideoAdapterVendor, name: string, pnpDeviceId = ''): VideoAdapterKind => {
  const signature = `${name} ${pnpDeviceId}`
  if (isVirtualVideoAdapter(signature)) return 'virtual'
  if (vendor === 'intel') return 'integrated'
  if (vendor === 'nvidia') return 'discrete'
  if (vendor === 'amd') {
    if (/(radeon\(tm\)? graphics|vega|apu)/i.test(signature)) return 'integrated'
    return 'discrete'
  }
  return 'unknown'
}

const parseCommandOutputAsJson = <T>(stdout: Buffer): T | null => {
  const raw = stdout.toString('utf8').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    log.warn('[FFmpeg] failed to parse json output', { error: String(error), raw })
    return null
  }
}

const detectWindowsVideoAdapters = async (): Promise<VideoAdapterInfo[]> => {
  const command = [
    '$items = Get-CimInstance Win32_VideoController |',
    'Select-Object Name, AdapterCompatibility, VideoProcessor, PNPDeviceID;',
    '$items | ConvertTo-Json -Depth 3'
  ].join(' ')

  const { stdout } = await runProcess(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeoutMs: 10_000 }
  )

  const parsed = parseCommandOutputAsJson<RawVideoController | RawVideoController[]>(stdout)
  const controllers = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  return controllers
    .map((item) => {
      const name = item.Name?.trim() || item.VideoProcessor?.trim() || 'Unknown GPU'
      const vendor = normalizeVideoVendor(`${item.AdapterCompatibility || ''} ${name}`)
      const kind = detectVideoAdapterKind(vendor, name, item.PNPDeviceID)
      return {
        name,
        vendor,
        kind,
        isVirtual: kind === 'virtual',
        isPreferred: false
      } satisfies VideoAdapterInfo
    })
    .filter((item) => item.name)
}

const detectVideoAdapters = async (): Promise<VideoAdapterInfo[]> => {
  if (process.platform !== 'win32') return []
  try {
    return await detectWindowsVideoAdapters()
  } catch (error) {
    log.warn(`[FFmpeg] detect video adapters failed: ${String(error)}`)
    return []
  }
}

const detectAvailableVideoEncoders = async (): Promise<string[]> => {
  try {
    const { stdout } = await runProcess(getFfmpegPath(), ['-hide_banner', '-encoders'], {
      timeoutMs: 10_000,
      stdoutLimitBytes: 1024 * 1024
    })
    const raw = stdout.toString('utf8')
    const knownEncoders = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264', 'libvpx-vp9']
    return knownEncoders.filter((encoder) => new RegExp(`\\b${encoder}\\b`, 'i').test(raw))
  } catch (error) {
    log.warn(`[FFmpeg] detect encoders failed: ${String(error)}`)
    return ['libx264', 'libvpx-vp9']
  }
}

const buildStrategyDescription = (
  encoder: VideoProcessingEncoder,
  deviceName?: string,
  deviceKind?: VideoAdapterKind
): { title: string; description: string } => {
  if (encoder === 'h264_nvenc') {
    return {
      title: 'NVIDIA NVENC',
      description: `${deviceName || 'NVIDIA 显卡'}${deviceKind === 'discrete' ? '（独显）' : ''}负责 H.264 编码，适合高吞吐批量处理。`
    }
  }
  if (encoder === 'h264_qsv') {
    return {
      title: 'Intel Quick Sync',
      description: `${deviceName || 'Intel 核显'}负责 H.264 编码，适合低占用、稳定的批量转码。`
    }
  }
  if (encoder === 'h264_amf') {
    return {
      title: 'AMD AMF',
      description: `${deviceName || 'AMD 显卡'}负责 H.264 编码，优先利用本机 GPU 编码通道。`
    }
  }
  return {
    title: 'CPU x264',
    description: '未检测到可用硬件编码器，回退到 libx264 软件编码。'
  }
}

const mapNvencPreset = (preset: 'fast' | 'medium' | 'slow'): string => {
  if (preset === 'fast') return 'p3'
  if (preset === 'slow') return 'p7'
  return 'p5'
}

const mapAmfQuality = (preset: 'fast' | 'medium' | 'slow'): string => {
  if (preset === 'fast') return 'speed'
  if (preset === 'slow') return 'quality'
  return 'balanced'
}

const formatCommandPreview = (args: string[]): string => `ffmpeg ${args.join(' ')}`

const createVideoEncodeArgs = (
  strategy: VideoProcessingStrategy,
  crf: number,
  preset: 'fast' | 'medium' | 'slow',
  keepAudio = true,
  includeFaststart = true
): string[] => {
  const audioArgs = keepAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']
  const faststartArgs = includeFaststart ? ['-movflags', '+faststart'] : []

  if (strategy.encoder === 'h264_nvenc') {
    return [
      '-c:v',
      'h264_nvenc',
      '-preset',
      mapNvencPreset(preset),
      '-rc',
      'vbr',
      '-cq',
      String(crf),
      '-b:v',
      '0',
      '-pix_fmt',
      'yuv420p',
      ...audioArgs,
      ...faststartArgs
    ]
  }

  if (strategy.encoder === 'h264_qsv') {
    return [
      '-c:v',
      'h264_qsv',
      '-global_quality',
      String(crf),
      '-look_ahead',
      '0',
      '-pix_fmt',
      'nv12',
      ...audioArgs,
      ...faststartArgs
    ]
  }

  if (strategy.encoder === 'h264_amf') {
    return [
      '-c:v',
      'h264_amf',
      '-usage',
      'transcoding',
      '-quality',
      mapAmfQuality(preset),
      '-rc',
      'cqp',
      '-qp_i',
      String(crf),
      '-qp_p',
      String(crf),
      '-pix_fmt',
      'nv12',
      ...audioArgs,
      ...faststartArgs
    ]
  }

  return [
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    ...audioArgs,
    ...faststartArgs
  ]
}

const getPreferredVideoProcessingStrategy = (
  adapters: VideoAdapterInfo[],
  availableEncoders: string[]
): VideoProcessingStrategy => {
  const candidates = adapters.filter((item) => !item.isVirtual)
  const rankedCandidates: Array<{ adapter: VideoAdapterInfo; encoder: VideoProcessingEncoder; rank: number }> = []

  for (const adapter of candidates) {
    if (adapter.vendor === 'nvidia' && availableEncoders.includes('h264_nvenc')) {
      rankedCandidates.push({ adapter, encoder: 'h264_nvenc', rank: adapter.kind === 'discrete' ? 100 : 90 })
    }
    if (adapter.vendor === 'amd' && availableEncoders.includes('h264_amf')) {
      rankedCandidates.push({ adapter, encoder: 'h264_amf', rank: adapter.kind === 'discrete' ? 80 : 70 })
    }
    if (adapter.vendor === 'intel' && availableEncoders.includes('h264_qsv')) {
      rankedCandidates.push({ adapter, encoder: 'h264_qsv', rank: adapter.kind === 'integrated' ? 60 : 50 })
    }
  }

  const preferred = rankedCandidates.sort((left, right) => right.rank - left.rank)[0]
  if (preferred) {
    const detail = buildStrategyDescription(preferred.encoder, preferred.adapter.name, preferred.adapter.kind)
    return {
      acceleration: 'gpu',
      encoder: preferred.encoder,
      vendor: preferred.adapter.vendor,
      deviceName: preferred.adapter.name,
      deviceKind: preferred.adapter.kind,
      title: detail.title,
      description: detail.description,
      ffmpegArgs: createVideoEncodeArgs(
        {
          acceleration: 'gpu',
          encoder: preferred.encoder,
          vendor: preferred.adapter.vendor,
          deviceName: preferred.adapter.name,
          deviceKind: preferred.adapter.kind,
          title: detail.title,
          description: detail.description,
          ffmpegArgs: [],
          commandExample: ''
        },
        23,
        'medium'
      ),
      commandExample: ''
    }
  }

  const fallback = buildStrategyDescription('libx264')
  return {
    acceleration: 'cpu',
    encoder: 'libx264',
    vendor: 'cpu',
    title: fallback.title,
    description: fallback.description,
    ffmpegArgs: createVideoEncodeArgs(
      {
        acceleration: 'cpu',
        encoder: 'libx264',
        vendor: 'cpu',
        title: fallback.title,
        description: fallback.description,
        ffmpegArgs: [],
        commandExample: ''
      },
      23,
      'medium'
    ),
    commandExample: ''
  }
}

let capabilityCache: VideoProcessingCapability | null = null
let capabilityPromise: Promise<VideoProcessingCapability> | null = null

export const getVideoProcessingCapability = async (): Promise<VideoProcessingCapability> => {
  if (capabilityCache) return capabilityCache
  if (capabilityPromise) return capabilityPromise

  capabilityPromise = (async () => {
    const [adapters, availableEncoders] = await Promise.all([detectVideoAdapters(), detectAvailableVideoEncoders()])
    const preferredStrategy = getPreferredVideoProcessingStrategy(adapters, availableEncoders)
    const preferredName = preferredStrategy.deviceName
    const normalizedAdapters = adapters.map((adapter) => ({
      ...adapter,
      isPreferred: Boolean(
        preferredName && adapter.name === preferredName && adapter.vendor === preferredStrategy.vendor
      )
    }))

    const capability: VideoProcessingCapability = {
      platform: process.platform,
      detectedAt: new Date().toISOString(),
      availableEncoders,
      adapters: normalizedAdapters,
      preferredStrategy: {
        ...preferredStrategy,
        commandExample: formatCommandPreview(['-y', '-i', 'input.mp4', ...preferredStrategy.ffmpegArgs, 'output.mp4'])
      }
    }

    capabilityCache = capability
    capabilityPromise = null
    return capability
  })().catch((error) => {
    capabilityPromise = null
    throw error
  })

  return capabilityPromise
}

const BATCH_TIMEOUT_MS = 20 * 60 * 1000

const sanitizeNamePart = (value: string): string => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'output'

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true })
}

const getCrfByQuality = (quality: 'high' | 'balanced' | 'small'): number => {
  if (quality === 'high') return 20
  if (quality === 'small') return 29
  return 24
}

const getCompressionCrf = (level: 'light' | 'balanced' | 'aggressive'): number => {
  if (level === 'light') return 28
  if (level === 'aggressive') return 34
  return 31
}

const toSafeFilterPath = (filePath: string): string => filePath.replace(/\\/g, '/').replace(/:/g, '\\:')

const escapeDrawtextText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%')

const getDefaultFontFile = (): string | undefined => {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Windows\\Fonts\\msyh.ttc', 'C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\arial.ttf']
      : ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']

  return candidates.find((candidate) => fs.existsSync(candidate))
}

const buildOutputPath = (inputPath: string, outputDir: string, suffix: string, extension: string): string => {
  const baseName = sanitizeNamePart(path.parse(inputPath).name)
  return path.join(outputDir, `${baseName}__${suffix}.${extension}`)
}

const buildFrameOutputPattern = (inputPath: string, outputDir: string, format: 'jpg' | 'png'): string => {
  const baseName = sanitizeNamePart(path.parse(inputPath).name)
  return path.join(outputDir, `${baseName}__frames`, `${baseName}_%03d.${format}`)
}

const getOverlayPosition = (
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center',
  margin: number
): { x: string; y: string } => {
  if (position === 'topLeft') return { x: `${margin}`, y: `${margin}` }
  if (position === 'topRight') return { x: `main_w-overlay_w-${margin}`, y: `${margin}` }
  if (position === 'bottomLeft') return { x: `${margin}`, y: `main_h-overlay_h-${margin}` }
  if (position === 'center') return { x: '(main_w-overlay_w)/2', y: '(main_h-overlay_h)/2' }
  return { x: `main_w-overlay_w-${margin}`, y: `main_h-overlay_h-${margin}` }
}

const getTextPosition = (
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center',
  margin: number
): { x: string; y: string } => {
  if (position === 'topLeft') return { x: `${margin}`, y: `${margin}+text_h` }
  if (position === 'topRight') return { x: `w-text_w-${margin}`, y: `${margin}+text_h` }
  if (position === 'bottomLeft') return { x: `${margin}`, y: `h-${margin}` }
  if (position === 'center') return { x: '(w-text_w)/2', y: '(h+text_h)/2' }
  return { x: `w-text_w-${margin}`, y: `h-${margin}` }
}

const getRatioValue = (ratioPreset: '1:1' | '4:5' | '9:16' | '16:9'): number => {
  if (ratioPreset === '1:1') return 1
  if (ratioPreset === '4:5') return 4 / 5
  if (ratioPreset === '9:16') return 9 / 16
  return 16 / 9
}

const detectAutoCrop = async (inputPath: string): Promise<string | undefined> => {
  const { stderr } = await runProcess(
    getFfmpegPath(),
    ['-hide_banner', '-ss', '0', '-i', inputPath, '-t', '8', '-vf', 'cropdetect=24:16:0', '-f', 'null', '-'],
    {
      timeoutMs: 60_000,
      allowNonZeroExit: true
    }
  )
  const matches = [...stderr.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)]
  return matches.at(-1)?.[1]
}

const SOFTWARE_STRATEGY: VideoProcessingStrategy = {
  acceleration: 'cpu',
  encoder: 'libx264',
  vendor: 'cpu',
  title: 'CPU x264',
  description: 'libx264 软件编码回退路径。',
  ffmpegArgs: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p'],
  commandExample: ''
}

const createMp4VideoArgs = (
  strategy: VideoProcessingStrategy,
  crf: number,
  preset: 'fast' | 'medium' | 'slow',
  keepAudio = true,
  includeFaststart = true
): string[] => createVideoEncodeArgs(strategy, crf, preset, keepAudio, includeFaststart)

type BuiltBatchCommand = {
  args: string[]
  outputPaths: string[]
  fallbackArgs?: string[]
  commandPreview: string
}

const buildBatchArgs = async (
  inputPath: string,
  outputPath: string,
  task: BatchVideoTaskInput,
  strategy: VideoProcessingStrategy
): Promise<BuiltBatchCommand> => {
  if (task.operation === 'transcode') {
    if (task.format === 'webm') {
      const args = [
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libvpx-vp9',
        '-crf',
        String(getCrfByQuality(task.quality)),
        '-b:v',
        '0',
        '-row-mt',
        '1',
        '-deadline',
        task.preset === 'slow' ? 'good' : 'realtime',
        '-c:a',
        'libopus',
        outputPath
      ]
      return {
        args,
        outputPaths: [outputPath],
        commandPreview: formatCommandPreview(args)
      }
    }

    const args = [
      '-y',
      '-i',
      inputPath,
      ...createMp4VideoArgs(strategy, getCrfByQuality(task.quality), task.preset, true, task.format !== 'mkv'),
      outputPath
    ]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? [
              '-y',
              '-i',
              inputPath,
              ...createMp4VideoArgs(
                SOFTWARE_STRATEGY,
                getCrfByQuality(task.quality),
                task.preset,
                true,
                task.format !== 'mkv'
              ),
              outputPath
            ]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.operation === 'compress') {
    const args = [
      '-y',
      '-i',
      inputPath,
      ...createMp4VideoArgs(strategy, getCompressionCrf(task.level), 'medium', task.keepAudio),
      outputPath
    ]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? [
              '-y',
              '-i',
              inputPath,
              ...createMp4VideoArgs(SOFTWARE_STRATEGY, getCompressionCrf(task.level), 'medium', task.keepAudio),
              outputPath
            ]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.operation === 'resize') {
    const scaleFilter =
      task.fitMode === 'contain'
        ? `scale=${task.width}:${task.height}:force_original_aspect_ratio=decrease,pad=${task.width}:${task.height}:(ow-iw)/2:(oh-ih)/2:color=black`
        : task.fitMode === 'cover'
          ? `scale=${task.width}:${task.height}:force_original_aspect_ratio=increase,crop=${task.width}:${task.height}`
          : `scale=${task.width}:${task.height}`

    const args = ['-y', '-i', inputPath, '-vf', scaleFilter, ...createMp4VideoArgs(strategy, 22, 'medium'), outputPath]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? [
              '-y',
              '-i',
              inputPath,
              '-vf',
              scaleFilter,
              ...createMp4VideoArgs(SOFTWARE_STRATEGY, 22, 'medium'),
              outputPath
            ]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.operation === 'crop') {
    let cropFilter = ''
    if (task.mode === 'autoBlackBars') {
      const detected = await detectAutoCrop(inputPath)
      if (!detected) throw new Error('未检测到可用裁剪区域')
      cropFilter = `crop=${detected}`
    } else if (task.mode === 'ratio') {
      if (!task.ratioPreset) throw new Error('缺少裁剪比例')
      const ratio = getRatioValue(task.ratioPreset)
      cropFilter = `crop='if(gte(iw/ih,${ratio}),ih*${ratio},iw)':'if(gte(iw/ih,${ratio}),ih,iw/${ratio})':'(iw-ow)/2':'(ih-oh)/2'`
    } else {
      if (!task.width || !task.height) throw new Error('缺少裁剪尺寸')
      cropFilter = `crop=${task.width}:${task.height}:${task.x ?? 0}:${task.y ?? 0}`
    }

    const args = ['-y', '-i', inputPath, '-vf', cropFilter, ...createMp4VideoArgs(strategy, 22, 'medium'), outputPath]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? [
              '-y',
              '-i',
              inputPath,
              '-vf',
              cropFilter,
              ...createMp4VideoArgs(SOFTWARE_STRATEGY, 22, 'medium'),
              outputPath
            ]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.operation === 'extractFrames') {
    const framePattern = outputPath
    ensureDir(path.dirname(framePattern))
    const frameFilter = task.captureMode === 'interval' ? `fps=1/${task.everySeconds ?? 3}` : `fps=${task.fps ?? 1}`
    const codecArgs = task.format === 'png' ? ['-c:v', 'png'] : ['-q:v', '2']
    const args = ['-y', '-i', inputPath, '-vf', frameFilter, ...codecArgs, framePattern]

    return {
      args,
      outputPaths: [path.dirname(framePattern)],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.operation === 'watermark') {
    if (task.watermarkType === 'text') {
      const text = task.text?.trim()
      if (!text) throw new Error('请输入水印文本')
      const fontFile = getDefaultFontFile()
      const position = getTextPosition(task.position, task.margin)
      const drawtextParts = [
        `text='${escapeDrawtextText(text)}'`,
        `fontcolor=white@${task.opacity}`,
        `fontsize=${task.fontSize ?? 28}`,
        `x=${position.x}`,
        `y=${position.y}`,
        'box=1',
        'boxcolor=black@0.25',
        'boxborderw=12'
      ]

      if (fontFile) {
        drawtextParts.unshift(`fontfile='${toSafeFilterPath(fontFile)}'`)
      }

      const args = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        `drawtext=${drawtextParts.join(':')}`,
        ...createMp4VideoArgs(strategy, 22, 'medium'),
        outputPath
      ]
      return {
        args,
        fallbackArgs:
          strategy.acceleration === 'gpu'
            ? [
                '-y',
                '-i',
                inputPath,
                '-vf',
                `drawtext=${drawtextParts.join(':')}`,
                ...createMp4VideoArgs(SOFTWARE_STRATEGY, 22, 'medium'),
                outputPath
              ]
            : undefined,
        outputPaths: [outputPath],
        commandPreview: formatCommandPreview(args)
      }
    }

    if (!task.imagePath || !fs.existsSync(task.imagePath)) {
      throw new Error('图片水印文件不存在')
    }

    const position = getOverlayPosition(task.position, task.margin)
    const scalePercent = (task.imageScalePercent ?? 18) / 100
    const filterComplex = [
      `[1:v][0:v]scale2ref=w=main_w*${scalePercent}:h=ow/mdar[wm][base]`,
      `[wm]format=rgba,colorchannelmixer=aa=${task.opacity}[wm2]`,
      `[base][wm2]overlay=${position.x}:${position.y}[outv]`
    ].join(';')

    const args = [
      '-y',
      '-i',
      inputPath,
      '-i',
      task.imagePath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[outv]',
      '-map',
      '0:a?',
      ...createMp4VideoArgs(strategy, 22, 'medium'),
      outputPath
    ]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? [
              '-y',
              '-i',
              inputPath,
              '-i',
              task.imagePath,
              '-filter_complex',
              filterComplex,
              '-map',
              '[outv]',
              '-map',
              '0:a?',
              ...createMp4VideoArgs(SOFTWARE_STRATEGY, 22, 'medium'),
              outputPath
            ]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.operation === 'trim') {
    const trimArgs =
      task.endMode === 'duration'
        ? ['-ss', task.startTime, '-t', task.duration || '00:00:05']
        : ['-ss', task.startTime, '-to', task.endTime || task.startTime]

    const args = ['-y', '-i', inputPath, ...trimArgs, ...createMp4VideoArgs(strategy, 20, 'medium'), outputPath]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? ['-y', '-i', inputPath, ...trimArgs, ...createMp4VideoArgs(SOFTWARE_STRATEGY, 20, 'medium'), outputPath]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  if (task.audioMode === 'remove') {
    const args = ['-y', '-i', inputPath, ...createMp4VideoArgs(strategy, 20, 'medium', false), outputPath]
    return {
      args,
      fallbackArgs:
        strategy.acceleration === 'gpu'
          ? ['-y', '-i', inputPath, ...createMp4VideoArgs(SOFTWARE_STRATEGY, 20, 'medium', false), outputPath]
          : undefined,
      outputPaths: [outputPath],
      commandPreview: formatCommandPreview(args)
    }
  }

  const format = task.format || 'mp3'
  const codecArgs =
    format === 'wav'
      ? ['-vn', '-c:a', 'pcm_s16le']
      : format === 'aac'
        ? ['-vn', '-c:a', 'aac', '-b:a', task.bitrate || '192k']
        : format === 'flac'
          ? ['-vn', '-c:a', 'flac']
          : ['-vn', '-c:a', 'libmp3lame', '-b:a', task.bitrate || '192k']
  const args = ['-y', '-i', inputPath, ...codecArgs, outputPath]

  return {
    args,
    outputPaths: [outputPath],
    commandPreview: formatCommandPreview(args)
  }
}

const getBatchOutputPath = (inputPath: string, outputDir: string, task: BatchVideoTaskInput): string => {
  if (task.operation === 'transcode') return buildOutputPath(inputPath, outputDir, 'transcode', task.format)
  if (task.operation === 'compress') return buildOutputPath(inputPath, outputDir, 'compress', 'mp4')
  if (task.operation === 'resize') return buildOutputPath(inputPath, outputDir, 'resize', 'mp4')
  if (task.operation === 'crop') return buildOutputPath(inputPath, outputDir, 'crop', 'mp4')
  if (task.operation === 'extractFrames') return buildFrameOutputPattern(inputPath, outputDir, task.format)
  if (task.operation === 'watermark') return buildOutputPath(inputPath, outputDir, 'watermark', 'mp4')
  if (task.operation === 'trim') return buildOutputPath(inputPath, outputDir, 'trim', 'mp4')
  if (task.audioMode === 'remove') return buildOutputPath(inputPath, outputDir, 'muted', 'mp4')
  return buildOutputPath(inputPath, outputDir, 'audio', task.format || 'mp3')
}

export const runBatchVideoProcess = async (
  input: BatchVideoProcessInput,
  options?: {
    capability?: VideoProcessingCapability
    taskId?: string
    onProgress?: (status: BatchVideoProcessStatus) => void
  }
): Promise<{ outputDir: string; results: BatchVideoProcessResultItem[] }> => {
  ensureDir(input.outputDir)

  const capability = options?.capability ?? (await getVideoProcessingCapability())
  const results: BatchVideoProcessResultItem[] = []
  const startedAt = new Date().toISOString()

  const emitProgress = (
    state: BatchVideoProcessStatus['state'],
    overrides?: Partial<
      Pick<
        BatchVideoProcessStatus,
        | 'completedItems'
        | 'currentCommand'
        | 'currentItemIndex'
        | 'currentItemName'
        | 'finishedAt'
        | 'message'
        | 'successCount'
        | 'errorCount'
      >
    >
  ): void => {
    if (!options?.onProgress || !options.taskId) return

    const successCount = overrides?.successCount ?? results.filter((item) => item.status === 'success').length
    const errorCount = overrides?.errorCount ?? results.filter((item) => item.status === 'error').length
    const completedItems = overrides?.completedItems ?? results.length
    const totalItems = input.items.length

    options.onProgress({
      taskId: options.taskId,
      state,
      outputDir: input.outputDir,
      totalItems,
      completedItems,
      successCount,
      errorCount,
      percent: totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0,
      currentItemIndex: overrides?.currentItemIndex,
      currentItemName: overrides?.currentItemName,
      currentCommand: overrides?.currentCommand,
      message: overrides?.message || '',
      startedAt,
      updatedAt: new Date().toISOString(),
      finishedAt: overrides?.finishedAt,
      results: [...results],
      capability
    })
  }

  emitProgress('running', { completedItems: 0, message: '批处理任务已开始，正在排队执行。' })

  for (const item of input.items) {
    try {
      if (!fs.existsSync(item.path)) {
        throw new Error('源文件不存在')
      }

      const outputPath = getBatchOutputPath(item.path, input.outputDir, input.task)
      ensureDir(path.dirname(outputPath))

      const { args, fallbackArgs, outputPaths, commandPreview } = await buildBatchArgs(
        item.path,
        outputPath,
        input.task,
        capability.preferredStrategy
      )
      const currentIndex = results.length + 1
      emitProgress('running', {
        completedItems: results.length,
        currentItemIndex: currentIndex,
        currentItemName: item.name,
        currentCommand: commandPreview,
        message: `正在处理第 ${currentIndex}/${input.items.length} 个视频`
      })
      log.info('[FFmpeg] batch process start', { inputPath: item.path, outputPath, task: input.task.operation })
      try {
        await runProcess(getFfmpegPath(), args, { timeoutMs: BATCH_TIMEOUT_MS })
      } catch (error) {
        if (!fallbackArgs) throw error
        log.warn('[FFmpeg] hardware encode failed, fallback to software encoder', {
          inputPath: item.path,
          task: input.task.operation,
          encoder: capability.preferredStrategy.encoder,
          error: String(error)
        })
        emitProgress('running', {
          completedItems: results.length,
          currentItemIndex: currentIndex,
          currentItemName: item.name,
          currentCommand: formatCommandPreview(fallbackArgs),
          message: `第 ${currentIndex}/${input.items.length} 个视频已回退到 CPU 编码`
        })
        await runProcess(getFfmpegPath(), fallbackArgs, { timeoutMs: BATCH_TIMEOUT_MS })
      }

      const existingOutputPaths =
        input.task.operation === 'extractFrames'
          ? outputPaths.flatMap((outputItem) => {
              if (!fs.existsSync(outputItem)) return []
              return fs
                .readdirSync(outputItem)
                .map((name) => path.join(outputItem, name))
                .filter((targetPath) => fs.statSync(targetPath).isFile())
            })
          : outputPaths.filter((targetPath) => fs.existsSync(targetPath))

      if (existingOutputPaths.length === 0) {
        throw new Error('未生成输出文件')
      }

      results.push({
        inputPath: item.path,
        inputName: item.name,
        outputPaths: existingOutputPaths,
        outputDir: input.outputDir,
        status: 'success'
      })
    } catch (error) {
      results.push({
        inputPath: item.path,
        inputName: item.name,
        outputPaths: [],
        outputDir: input.outputDir,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const completedItems = results.length
    const finishedCount = results.filter((item) => item.status === 'success').length
    const failedCount = completedItems - finishedCount
    emitProgress('running', {
      completedItems,
      successCount: finishedCount,
      errorCount: failedCount,
      currentItemIndex: completedItems < input.items.length ? completedItems + 1 : undefined,
      currentItemName: completedItems < input.items.length ? input.items[completedItems]?.name : undefined,
      currentCommand: undefined,
      message:
        completedItems < input.items.length
          ? `已完成 ${completedItems}/${input.items.length} 个视频`
          : '批处理已完成，正在整理结果。'
    })
  }

  const finishedAt = new Date().toISOString()
  const successCount = results.filter((item) => item.status === 'success').length
  const errorCount = results.length - successCount
  emitProgress(errorCount > 0 ? 'failed' : 'completed', {
    completedItems: results.length,
    successCount,
    errorCount,
    currentItemIndex: undefined,
    currentItemName: undefined,
    currentCommand: undefined,
    finishedAt,
    message: `批处理结束，成功 ${successCount} 个，失败 ${errorCount} 个。`
  })

  return {
    outputDir: input.outputDir,
    results
  }
}
