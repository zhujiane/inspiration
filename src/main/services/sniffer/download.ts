import { app } from 'electron'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { db } from '@main/db'
import { configs } from '@shared/db/config-schema'
import { resources } from '@shared/db/resource-schema'
import { eq } from 'drizzle-orm'
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
import type { SnifferDownloadResourceInput, SnifferMergeTaskInput } from '../../types/sniffer-types'

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
    const { response } = await requestWithRedirect(url, { method: 'GET', headers, timeout: 30_000 })
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
        const { response } = await requestWithRedirect(url, {
          method: 'GET',
          headers: {
            ...headers,
            Range: `bytes=${start}-${end}`
          },
          timeout: 30_000
        })
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
  const meta = await analyzeMedia({ path: localPath })
  const created = await db
    .insert(resources)
    .values({
      name: path.basename(localPath),
      type: mapResourceType(resource.type),
      url: sourceUrl,
      localPath,
      cover: meta.cover,
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
      const [videoDownloaded, audioDownloaded] = await Promise.all([
        downloadRemoteResource(task.video, `-video-${index + 1}`),
        downloadRemoteResource(task.audio, `-audio-${index + 1}`)
      ])
      tempFiles.push(videoDownloaded.filePath, audioDownloaded.filePath)

      const outputBaseName = sanitizeFilename(
        path.basename(task.video.title, path.extname(task.video.title)) || `merged-${index + 1}`
      )
      const outputName = `${outputBaseName}-merged-${index + 1}.mp4`
      const outputPath = await ensureUniqueFilePath(path.join(downloadDir, outputName))
      await mergeAudioVideo(videoDownloaded.filePath, audioDownloaded.filePath, outputPath)

      const meta = await analyzeMedia({ path: outputPath })
      const [libraryItem] = await db
        .insert(resources)
        .values({
          name: path.basename(outputPath),
          type: '视频',
          url: task.video.url,
          localPath: outputPath,
          cover: meta.cover,
          platform: inferPlatform(task.video.pageUrl, task.video.url),
          metadata: JSON.stringify(meta),
          description: `嗅探合并: ${task.video.url}`
        })
        .returning()

      mergedResults[index] = { id: task.id, success: true, filePath: outputPath, libraryItem }
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
