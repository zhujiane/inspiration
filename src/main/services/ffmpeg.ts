import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import log from './logger'

type SpawnResult = {
  stdout: Buffer
  stderr: string
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
