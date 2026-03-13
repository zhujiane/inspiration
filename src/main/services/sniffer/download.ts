import { spawn } from 'child_process'
import { app } from 'electron'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { db } from '@main/db'
import ffmpegStatic from 'ffmpeg-static'
import { configs } from '@shared/db/config-schema'
import { resources } from '@shared/db/resource-schema'
import { eq } from 'drizzle-orm'
import { captureVideoFrameBase64, inspectLocalMedia, mergeMediaTracks } from '../ffmpeg'
import { headRequest, requestWithRedirect } from './http'
import { DEFAULT_USER_AGENT } from './constants'
import {
  extFromUrl,
  filenameFromContentDisposition,
  getHeaderValue,
  guessExtensionFromContentType,
  inferPlatform,
  mapResourceType,
  sanitizeFilename,
  sanitizeHeaders,
  titleFromUrl
} from './utils'
import { broadcastDownloadProgress } from './broadcast'
import type {
  SnifferDownloadProgressPayload,
  SnifferDownloadResourceInput,
  SnifferMergeTaskInput
} from '../../types/sniffer-types'

const DOWNLOAD_TIMEOUT_MS = 60_000
const FFMPEG_DOWNLOAD_TIMEOUT_MS = 30 * 60_000
const HLS_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl'
])
const MAX_CONCURRENT_HLS_DOWNLOADS = 1

let activeHlsDownloads = 0
const pendingHlsDownloadResolvers: Array<() => void> = []

function isHlsContentType(contentType?: string): boolean {
  if (!contentType) return false
  return HLS_CONTENT_TYPES.has(contentType.toLowerCase().split(';')[0].trim())
}

function isHlsResource(resource: SnifferDownloadResourceInput): boolean {
  return isHlsContentType(resource.contentType) || /\.m3u8(?:$|[?#])/i.test(resource.url)
}

async function withHlsDownloadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeHlsDownloads >= MAX_CONCURRENT_HLS_DOWNLOADS) {
    await new Promise<void>((resolve) => {
      pendingHlsDownloadResolvers.push(resolve)
    })
  }

  activeHlsDownloads++
  try {
    return await task()
  } finally {
    activeHlsDownloads = Math.max(0, activeHlsDownloads - 1)
    const nextResolver = pendingHlsDownloadResolvers.shift()
    nextResolver?.()
  }
}

async function readResponseText(response: NodeJS.ReadableStream, maxBytes = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      throw new Error('Manifest is too large to inspect')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function inspectHlsManifest(
  url: string,
  headers: Record<string, string>
): Promise<{ finalUrl: string; contentType: string; isLive: boolean }> {
  const { response, finalUrl } = await withRetry(
    () => requestWithRedirect(url, { method: 'GET', headers, timeout: DOWNLOAD_TIMEOUT_MS }),
    { retries: 2, delayMs: 1_000 }
  )

  const manifestText = await readResponseText(response)
  const contentType = String(response.headers['content-type'] || '')
  const normalizedManifest = manifestText.toUpperCase()
  const isVodManifest =
    normalizedManifest.includes('#EXT-X-ENDLIST') || normalizedManifest.includes('#EXT-X-PLAYLIST-TYPE:VOD')

  return {
    finalUrl,
    contentType,
    isLive: !isVodManifest
  }
}

function getFfmpegPath(): string {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg binary is not available')
  }
  return ffmpegStatic
}

function buildFfmpegInputArgs(headers: Record<string, string>): string[] {
  const args: string[] = []
  const userAgent = getHeaderValue(headers, 'user-agent') || DEFAULT_USER_AGENT
  const referer = getHeaderValue(headers, 'referer')
  const headerLines = Object.entries(headers)
    .filter(([key]) => {
      const normalizedKey = key.toLowerCase()
      return normalizedKey !== 'user-agent' && normalizedKey !== 'referer'
    })
    .map(([key, value]) => `${key}: ${value}`)

  args.push('-user_agent', userAgent)
  if (referer) {
    args.push('-referer', referer)
  }
  if (headerLines.length > 0) {
    args.push('-headers', `${headerLines.join('\r\n')}\r\n`)
  }

  return args
}

async function runFfmpegDownload(args: string[], timeoutMs = FFMPEG_DOWNLOAD_TIMEOUT_MS): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpegPath = getFfmpegPath()
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    const stderrChunks: Buffer[] = []
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
        reject(new Error('ffmpeg download timeout'))
      })
    }, timeoutMs)

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      finish(() => reject(error))
    })

    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve()
          return
        }
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
        reject(new Error(stderr || `ffmpeg exited with code ${code}`))
      })
    })
  })
}

async function downloadHlsResource(
  resource: SnifferDownloadResourceInput,
  suffix = ''
): Promise<{ filePath: string; fileName: string; finalUrl: string }> {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...(sanitizeHeaders(resource.requestHeaders) ?? {})
  }

  const manifest = await inspectHlsManifest(resource.url, headers)
  if (manifest.isLive) {
    throw new Error('暂不支持直播 m3u8 下载，请使用回放/VOD 链接后重试')
  }

  const targetExt = resource.type === 'audio' ? '.m4a' : '.mp4'
  const { filePath, fileName, finalUrl } = await resolveDownloadTarget(resource, suffix, {
    preferredExtension: targetExt,
    finalUrl: manifest.finalUrl,
    head: {
      contentType: manifest.contentType || resource.contentType || 'application/vnd.apple.mpegurl',
      contentLength: 0,
      acceptRanges: false
    }
  })

  await withHlsDownloadSlot(async () => {
    const ffmpegArgs = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...buildFfmpegInputArgs(headers),
      '-i',
      manifest.finalUrl
    ]

    if (resource.type === 'audio') {
      ffmpegArgs.push('-map', '0:a:0?', '-vn')
    }

    ffmpegArgs.push('-c', 'copy', filePath)
    await runFfmpegDownload(ffmpegArgs)
  })

  return { filePath, fileName, finalUrl }
}

function parseDurationText(raw?: string): number | undefined {
  if (!raw) return undefined
  const parts = raw
    .trim()
    .split(':')
    .map((p) => Number(p))
  if (parts.length < 2 || parts.length > 3) return undefined
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function parseResolutionText(raw?: string): { width?: number; height?: number } {
  if (!raw) return {}
  const match = raw.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return {}
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {}
  return { width, height }
}

function buildLocalPreviewProxyUrl(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/')
  const fileUrl = normalized.startsWith('file://') ? normalized : `file:///${normalized}`
  const search = new URLSearchParams()
  search.set('url', fileUrl)
  return `sniffer-media://preview?${search.toString()}`
}

async function buildLibraryMeta(
  resource: SnifferDownloadResourceInput,
  localPath: string
): Promise<{ meta: any; cover?: string }> {
  const stat = await fs.stat(localPath).catch(() => null)
  const baseSize = stat?.size ?? 0
  const analyzedMeta =
    resource.type === 'video' || resource.type === 'audio' ? await inspectLocalMedia(localPath) : null
  const fallbackDuration = parseDurationText(resource.duration)
  const fallbackResolution = parseResolutionText(resource.resolution)

  const cover =
    resource.type === 'image'
      ? buildLocalPreviewProxyUrl(localPath)
      : resource.type === 'video'
        ? (await captureVideoFrameBase64(localPath).catch(() => undefined)) || resource.thumbnailUrl || undefined
        : resource.thumbnailUrl || undefined

  const meta: any = {
    type: analyzedMeta?.type || resource.type,
    size: baseSize,
    width: analyzedMeta?.width ?? fallbackResolution.width,
    height: analyzedMeta?.height ?? fallbackResolution.height,
    duration: analyzedMeta?.duration ?? fallbackDuration,
    cover
  }

  return { meta, cover }
}

async function withRetry<T>(fn: () => Promise<T>, options?: { retries?: number; delayMs?: number }): Promise<T> {
  const retries = options?.retries ?? 2
  const delayMs = options?.delayMs ?? 1_000

  let attempt = 0
  // 简单重试：网络抖动时提升成功率
  for (;;) {
    try {
      return await fn()
    } catch (error) {
      attempt++
      if (attempt > retries) {
        throw error
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
}

async function getConfigValue(key: string): Promise<string> {
  const [config] = await db.select().from(configs).where(eq(configs.key, key)).limit(1)
  return config?.value?.trim() ?? ''
}

async function getMaxConcurrentDownloads(): Promise<number> {
  const rawValue = await getConfigValue('download.maxConcurrent')
  const parsedValue = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 3
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const workerCount = Math.max(1, Math.min(limit, items.length))
  let currentIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = currentIndex++
        if (index >= items.length) return
        await worker(items[index], index)
      }
    })
  )
}

async function ensureDownloadDir(): Promise<string> {
  const configuredPath = await getConfigValue('download.path')
  const downloadDir = configuredPath || path.join(app.getPath('downloads'), 'download')
  await fs.mkdir(downloadDir, { recursive: true })
  return downloadDir
}

async function ensureUniqueFilePath(targetPath: string): Promise<string> {
  const parsed = path.parse(targetPath)
  let nextPath = targetPath
  let counter = 1

  while (true) {
    try {
      await fs.access(nextPath)
      nextPath = path.join(parsed.dir, `${parsed.name}(${counter++})${parsed.ext}`)
    } catch {
      return nextPath
    }
  }
}

async function safeUnlink(targetPath: string): Promise<void> {
  try {
    await fs.unlink(targetPath)
  } catch {}
}

async function safeRm(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true })
  } catch {}
}

async function singleStreamDownload(url: string, headers: Record<string, string>, targetPath: string): Promise<void> {
  const tempPath = `${targetPath}.part`
  await safeUnlink(tempPath)
  try {
    const { response } = await withRetry(
      () => requestWithRedirect(url, { method: 'GET', headers, timeout: DOWNLOAD_TIMEOUT_MS }),
      { retries: 2, delayMs: 1_000 }
    )
    await pipeline(response, createWriteStream(tempPath))
    await fs.rename(tempPath, targetPath)
  } catch (error) {
    await safeUnlink(tempPath)
    throw error
  }
}

async function concatenateFiles(partPaths: string[], outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath)
    let index = 0

    const pipeNext = () => {
      if (index >= partPaths.length) {
        output.end(() => resolve())
        return
      }

      const input = createReadStream(partPaths[index++])
      input.on('error', reject)
      input.on('end', pipeNext)
      input.pipe(output, { end: false })
    }

    output.on('error', reject)
    pipeNext()
  })
}

async function chunkedDownload(
  url: string,
  headers: Record<string, string>,
  targetPath: string,
  contentLength: number,
  chunkCount: number
): Promise<void> {
  const tempDir = `${targetPath}.chunks`
  const partPaths: string[] = []
  await safeRm(tempDir)
  await fs.mkdir(tempDir, { recursive: true })

  try {
    const chunkSize = Math.ceil(contentLength / chunkCount)
    await Promise.all(
      Array.from({ length: chunkCount }, async (_, index) => {
        const start = index * chunkSize
        const end = Math.min(contentLength - 1, start + chunkSize - 1)
        const partPath = path.join(tempDir, `part-${index}.tmp`)
        partPaths[index] = partPath
        const { response } = await withRetry(
          () =>
            requestWithRedirect(url, {
              method: 'GET',
              headers: {
                ...headers,
                Range: `bytes=${start}-${end}`
              },
              timeout: DOWNLOAD_TIMEOUT_MS
            }),
          { retries: 2, delayMs: 1_000 }
        )
        await pipeline(response, createWriteStream(partPath))
      })
    )

    const tempTargetPath = `${targetPath}.part`
    await safeUnlink(tempTargetPath)
    await concatenateFiles(partPaths, tempTargetPath)
    await fs.rename(tempTargetPath, targetPath)
  } catch (error) {
    await safeUnlink(`${targetPath}.part`)
    throw error
  } finally {
    await safeRm(tempDir)
  }
}

async function resolveDownloadTarget(
  resource: SnifferDownloadResourceInput,
  suffix = '',
  options?: {
    preferredExtension?: string
    finalUrl?: string
    head?: {
      contentType: string
      contentLength: number
      acceptRanges: boolean
      contentDisposition?: string
      finalUrl?: string
    }
  }
): Promise<{
  downloadDir: string
  filePath: string
  fileName: string
  finalUrl: string
  head: { contentType: string; contentLength: number; acceptRanges: boolean; contentDisposition?: string }
}> {
  const downloadDir = await ensureDownloadDir()
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...(sanitizeHeaders(resource.requestHeaders) ?? {})
  }
  const head = options?.head ?? (await headRequest(resource.url, headers))
  const finalUrl = options?.finalUrl || head.finalUrl || resource.url

  const fileNameBase =
    filenameFromContentDisposition(head.contentDisposition) ||
    `${sanitizeFilename(resource.title || titleFromUrl(resource.url))}${suffix}`

  const ext =
    options?.preferredExtension ||
    path.extname(fileNameBase) ||
    extFromUrl(finalUrl) ||
    extFromUrl(resource.url) ||
    guessExtensionFromContentType(resource.contentType || head.contentType) ||
    (resource.type === 'video' ? '.mp4' : resource.type === 'audio' ? '.m4a' : '.jpg')

  const normalizedBase = path.basename(fileNameBase, path.extname(fileNameBase))
  const fileName = `${sanitizeFilename(normalizedBase)}${ext}`
  const filePath = await ensureUniqueFilePath(path.join(downloadDir, fileName))

  return {
    downloadDir,
    fileName: path.basename(filePath),
    filePath,
    finalUrl,
    head: {
      contentType: head.contentType,
      contentLength: head.contentLength,
      acceptRanges: head.acceptRanges,
      contentDisposition: head.contentDisposition
    }
  }
}

export async function downloadRemoteResource(
  resource: SnifferDownloadResourceInput,
  suffix = ''
): Promise<{ filePath: string; fileName: string; finalUrl: string }> {
  if (isHlsResource(resource)) {
    return downloadHlsResource(resource, suffix)
  }

  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...(sanitizeHeaders(resource.requestHeaders) ?? {})
  }

  const { filePath, fileName, finalUrl, head } = await resolveDownloadTarget(resource, suffix)

  if (head.acceptRanges && head.contentLength > 8 * 1024 * 1024) {
    const chunkCount = Math.min(4, Math.max(2, Math.ceil(head.contentLength / (16 * 1024 * 1024))))
    await chunkedDownload(finalUrl, headers, filePath, head.contentLength, chunkCount)
  } else {
    await singleStreamDownload(finalUrl, headers, filePath)
  }

  return { filePath, fileName, finalUrl }
}

export async function addDownloadedResourceToLibrary(
  resource: SnifferDownloadResourceInput,
  localPath: string,
  sourceUrl: string
): Promise<any> {
  const { meta, cover } = await buildLibraryMeta(resource, localPath)
  const created = await db
    .insert(resources)
    .values({
      name: path.basename(localPath),
      type: mapResourceType(resource.type),
      url: sourceUrl,
      localPath,
      cover,
      platform: inferPlatform(resource.pageUrl, sourceUrl),
      metadata: JSON.stringify(meta),
      description: `嗅探下载: ${resource.pageUrl || sourceUrl}`
    })
    .returning()
  return created[0]
}

export async function mergeAudioVideo(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  await mergeMediaTracks(videoPath, audioPath, outputPath)
}

export async function downloadSelectedTasks(resourcesToDownload: SnifferDownloadResourceInput[]): Promise<{
  success: true
  downloadedCount: number
  items: Array<
    | { id: string; success: true; filePath: string; finalUrl: string; libraryItem: any }
    | { id: string; success: false; errorMessage: string }
  >
}> {
  const maxConcurrent = await getMaxConcurrentDownloads()
  const downloadResults: Array<
    | { id: string; success: true; filePath: string; finalUrl: string; libraryItem: any }
    | { id: string; success: false; errorMessage: string }
  > = new Array(resourcesToDownload.length)

  await runWithConcurrencyLimit(resourcesToDownload, maxConcurrent, async (resource, index) => {
    const emitProgress = (partial: Partial<SnifferDownloadProgressPayload>) => {
      broadcastDownloadProgress({
        type: 'download',
        id: resource.id,
        phase: partial.phase ?? 'download',
        progress: partial.progress ?? 0,
        message: partial.message
      })
    }

    try {
      emitProgress({ phase: 'download', progress: 10, message: '开始下载' })
      const { filePath, finalUrl } = await downloadRemoteResource(resource)

      emitProgress({ phase: 'analyze', progress: 80, message: '整理媒体信息' })
      const libraryItem = await addDownloadedResourceToLibrary(resource, filePath, finalUrl)

      emitProgress({ phase: 'library', progress: 100, message: '已添加到素材库' })
      downloadResults[index] = {
        id: resource.id,
        success: true,
        filePath,
        finalUrl,
        libraryItem
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      emitProgress({ phase: 'download', progress: 0, message: errorMessage })
      downloadResults[index] = {
        id: resource.id,
        success: false,
        errorMessage
      }
    }
  })

  return {
    success: true,
    downloadedCount: downloadResults.filter((item) => item?.success).length,
    items: downloadResults
  }
}

export async function mergeSelectedTasks(tasks: SnifferMergeTaskInput[]): Promise<{
  success: true
  mergedCount: number
  items: Array<
    | { id: string; success: true; filePath: string; libraryItem: any }
    | { id: string; success: false; errorMessage: string }
  >
}> {
  const downloadDir = await ensureDownloadDir()
  const maxConcurrent = await getMaxConcurrentDownloads()
  const mergedResults: Array<
    | { id: string; success: true; filePath: string; libraryItem: any }
    | { id: string; success: false; errorMessage: string }
  > = new Array(tasks.length)

  await runWithConcurrencyLimit(tasks, maxConcurrent, async (task, index) => {
    const tempFiles: string[] = []
    try {
      const emitProgress = (partial: Partial<SnifferDownloadProgressPayload>) => {
        broadcastDownloadProgress({
          type: 'merge',
          id: task.id,
          phase: partial.phase ?? 'download',
          progress: partial.progress ?? 0,
          message: partial.message
        })
      }

      // 下载阶段：0-80
      emitProgress({ phase: 'download', progress: 5, message: '准备下载' })

      const videoPromise = downloadRemoteResource(task.video, `-video-${index + 1}`).then((result) => {
        emitProgress({ phase: 'video', progress: 40, message: '视频下载完成' })
        return result
      })

      const audioPromise = downloadRemoteResource(task.audio, `-audio-${index + 1}`).then((result) => {
        emitProgress({ phase: 'audio', progress: 80, message: '音频下载完成' })
        return result
      })

      const [videoDownloaded, audioDownloaded] = await Promise.all([videoPromise, audioPromise])
      tempFiles.push(videoDownloaded.filePath, audioDownloaded.filePath)

      const outputBaseName = sanitizeFilename(
        path.basename(task.video.title, path.extname(task.video.title)) || `merged-${index + 1}`
      )
      const outputName = `${outputBaseName}-merged-${index + 1}.mp4`
      const outputPath = await ensureUniqueFilePath(path.join(downloadDir, outputName))
      emitProgress({ phase: 'merge', progress: 85, message: '开始合并音视频' })
      await mergeAudioVideo(videoDownloaded.filePath, audioDownloaded.filePath, outputPath)

      emitProgress({ phase: 'analyze', progress: 90, message: '整理媒体信息' })

      const outputStat = await fs.stat(outputPath).catch(() => null)
      const analyzedMeta = await inspectLocalMedia(outputPath).catch(() => null)
      const fallbackDuration = parseDurationText(task.video.duration)
      const fallbackResolution = parseResolutionText(task.video.resolution)
      const cover = (await captureVideoFrameBase64(outputPath).catch(() => undefined)) || task.video.thumbnailUrl
      const meta: any = {
        type: 'video',
        size: outputStat?.size ?? 0,
        width: analyzedMeta?.width ?? fallbackResolution.width,
        height: analyzedMeta?.height ?? fallbackResolution.height,
        duration: analyzedMeta?.duration ?? fallbackDuration,
        cover
      }

      emitProgress({ phase: 'library', progress: 95, message: '写入素材库' })
      const [libraryItem] = await db
        .insert(resources)
        .values({
          name: path.basename(outputPath),
          type: '视频',
          url: task.video.url,
          localPath: outputPath,
          cover,
          platform: inferPlatform(task.video.pageUrl, task.video.url),
          metadata: JSON.stringify(meta),
          description: `嗅探合并: ${task.video.url}`
        })
        .returning()

      mergedResults[index] = { id: task.id, success: true, filePath: outputPath, libraryItem }
      emitProgress({ phase: 'library', progress: 100, message: '合并完成' })
    } catch (error) {
      mergedResults[index] = {
        id: task.id,
        success: false,
        errorMessage: (error as Error)?.message || '合并失败，未添加到素材库'
      }
    } finally {
      await Promise.all(tempFiles.map((tempPath) => safeUnlink(tempPath)))
    }
  })

  return {
    success: true,
    mergedCount: mergedResults.filter((item) => item?.success).length,
    items: mergedResults
  }
}
