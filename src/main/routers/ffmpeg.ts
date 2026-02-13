import { publicProcedure, trpc } from '@shared/routers/trpc'
import { z } from 'zod'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import md5File from 'md5-file'
import fs from 'fs'
import path from 'path'
import log from '../logger'

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

function parseDuration(raw: any): number {
  if (!raw || raw === 'N/A') return 0
  const num = Number(raw)
  return Number.isFinite(num) ? num : 0
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'])
function detectFileType(filePath: string, metadata: any) {
  const ext = path.extname(filePath).slice(1).toLowerCase()

  const formatName = metadata.format?.format_name || ''
  const duration = parseDuration(metadata.format?.duration)

  const videoStreams = metadata.streams?.filter((s: any) => s.codec_type === 'video') || []

  const audioStreams = metadata.streams?.filter((s: any) => s.codec_type === 'audio') || []

  const isImageByFormat =
    IMAGE_EXT.has(ext) ||
    formatName.includes('image') ||
    formatName.includes('png') ||
    formatName.includes('jpeg') ||
    formatName.includes('gif') ||
    formatName.includes('webp')

  // 1️⃣ 明确图片
  if (isImageByFormat && videoStreams.length === 1) {
    return 'image'
  }

  // 2️⃣ 真视频（必须有 duration）
  if (videoStreams.length > 0 && duration > 0) {
    return 'video'
  }

  // 3️⃣ 纯音频
  if (audioStreams.length > 0 && videoStreams.length === 0) {
    return 'audio'
  }

  // 4️⃣ fallback
  return 'other'
}

async function getFirstFrameToBase64(input: { path: string }) {
  return await new Promise<string>((resolve, reject) => {
    let settled = false
    const buffers: Buffer[] = []

    const command = ffmpeg(input.path)
      .seekInput(0)
      .frames(1)
      .outputOptions(['-f image2', '-vcodec mjpeg', '-vf scale=320:-1'])

    // 监听 command 级别的 error
    command.on('error', (err) => {
      if (settled) return
      settled = true
      log.error('Video screenshot error:', err)
      reject(err)
    })

    // 监听 command 级别的 end（ffmpeg 进程结束时触发）
    command.on('end', () => {
      if (settled) return
      settled = true
      const buffer = Buffer.concat(buffers)
      resolve(`data:image/jpeg;base64,${buffer.toString('base64')}`)
    })

    // pipe() 返回可读流，收集数据
    const stream = command.pipe()
    stream.on('data', (chunk: Buffer) => buffers.push(chunk))

    // 也监听 stream 级别的 error，防止未处理异常
    stream.on('error', (err: Error) => {
      if (settled) return
      settled = true
      log.error('Video screenshot stream error:', err)
      reject(err)
    })
  })
}

export const ffmpegRouter = trpc.router({
  analyze: publicProcedure.input(z.object({ path: z.string() })).query(async ({ input }) => {
    if (!fs.existsSync(input.path)) {
      throw new Error('文件不存在')
    }

    // 1. Promisify ffprobe
    const metadata = await new Promise<any>((resolve, reject) => {
      ffmpeg.ffprobe(input.path, (err, data) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    const stats = fs.statSync(input.path)
    const md5 = await md5File(input.path)
    const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video')
    const audioStream = metadata.streams.find((s: any) => s.codec_type === 'audio')
    const fileType = detectFileType(input.path, metadata)

    const result: any = {
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

    // 2. 处理图片封面
    if (fileType === 'image') {
      try {
        const base64 = fs.readFileSync(input.path, { encoding: 'base64' })
        const ext = path.extname(input.path).slice(1).toLowerCase() || 'jpeg'
        const mimeExt = ext === 'jpg' ? 'jpeg' : ext
        result.cover = `data:image/${mimeExt};base64,${base64}`
      } catch (err) {
        log.error('Image read error:', err)
      }
    }

    // 3. 处理视频封面 (使用 Buffer 流并明确 await)
    if (fileType === 'video') {
      try {
        const coverBase64 = await getFirstFrameToBase64(input)
        result.cover = coverBase64
      } catch (err) {
        // 如果截取封面失败，仅打印错误而不中断整体流程
        log.error('Failed to capture video cover:', err)
      }
    }

    return result
  })
})
