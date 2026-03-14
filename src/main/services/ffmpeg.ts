import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import log from './logger'

type SpawnResult = {
  stdout: Buffer
  stderr: string
  code: number | null
}

const DEFAULT_TIMEOUT_MS = 15_000
const isHttpUrl = (input: string): boolean => input.startsWith('http://') || input.startsWith('https://')

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

const parseFfmpegInspectOutput = (stderr: string): LocalMediaMeta => {
  const durationMatch = stderr.match(/Duration:\s*([0-9:.]+)/i)
  const duration = parseDurationToSeconds(durationMatch?.[1] || '')
  const streamLines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^Stream #/i.test(line))

  const videoLine = streamLines.find((line) => /Video:/i.test(line))
  const audioLine = streamLines.find((line) => /Audio:/i.test(line))

  if (videoLine) {
    const videoMeta = parseVideoStreamMeta(videoLine)
    return {
      type: 'video',
      duration,
      ...videoMeta
    }
  }

  if (audioLine) {
    return {
      type: 'audio',
      duration
    }
  }

  return { type: 'other', duration }
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
