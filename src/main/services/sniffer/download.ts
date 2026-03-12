import { app } from 'electron'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { db } from '@main/db'
import { configs } from '@shared/db/config-schema'
import { resources } from '@shared/db/resource-schema'
import { eq } from 'drizzle-orm'
import log from '../logger'
import { mergeMediaTracks } from '../ffmpeg'
import { analyzeMedia } from '../ffmpeg'
import { headRequest, requestWithRedirect } from './http'
import { DEFAULT_USER_AGENT } from './constants'
import {
  extFromUrl,
  filenameFromContentDisposition,
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
  const duration = parseDurationText(resource.duration)
  const { width, height } = parseResolutionText(resource.resolution)

  // 默认优先复用嗅探阶段/HEAD 阶段已有数据，避免对本地文件做 ffprobe + md5（很重）
  const baseMeta: any = {
    type: resource.type,
    size: baseSize,
    width,
    height,
    duration
  }

  const cover = resource.type === 'image' ? buildLocalPreviewProxyUrl(localPath) : resource.thumbnailUrl || undefined

  // 缺关键字段时，只对本地文件做补充分析。
  const shouldFallbackAnalyze =
    resource.type !== 'image' && (!cover || (!baseMeta.duration && !baseMeta.width && !baseMeta.height))

  if (shouldFallbackAnalyze) {
    try {
      const analyzed = await analyzeMedia({ path: localPath })
      const merged = {
        ...analyzed,
        ...baseMeta,
        size: baseSize || analyzed.size,
        cover: cover || analyzed.cover
      }
      return { meta: merged, cover: cover || analyzed.cover }
    } catch (error) {
      log.debug(`[Sniffer] Local analyze skipped/failed (${localPath}): ${String(error)}`)
    }
  }

  baseMeta.cover = cover
  return { meta: baseMeta, cover }
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
  suffix = ''
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
  const head = await headRequest(resource.url, headers)

  const fileNameBase =
    filenameFromContentDisposition(head.contentDisposition) ||
    `${sanitizeFilename(resource.title || titleFromUrl(resource.url))}${suffix}`

  const ext =
    path.extname(fileNameBase) ||
    extFromUrl(head.finalUrl || resource.url) ||
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
    finalUrl: head.finalUrl || resource.url,
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
      const baseSize = outputStat?.size ?? 0
      const duration = parseDurationText(task.video.duration)
      const { width, height } = parseResolutionText(task.video.resolution)
      const baseMeta: any = {
        type: 'video',
        size: baseSize,
        width,
        height,
        duration
      }

      let cover = task.video.thumbnailUrl
      let meta: any = { ...baseMeta, cover }
      const shouldFallbackAnalyze = !cover || (!baseMeta.duration && !baseMeta.width && !baseMeta.height)
      if (shouldFallbackAnalyze) {
        try {
          const analyzed = await analyzeMedia({ path: outputPath })
          cover = cover || analyzed.cover
          meta = {
            ...analyzed,
            ...baseMeta,
            size: baseSize || analyzed.size,
            cover
          }
        } catch (error) {
          log.debug(`[Sniffer] Local analyze skipped/failed (${outputPath}): ${String(error)}`)
        }
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
