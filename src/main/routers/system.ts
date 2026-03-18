import { publicProcedure, trpc } from '@shared/routers/trpc'
import { batchVideoProcessSchema } from '@shared/ffmpeg/batch-video'
import type { BatchVideoProcessStatus } from '@shared/ffmpeg/batch-video'
import { app, shell, BrowserWindow, dialog, nativeImage } from 'electron'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  captureVideoFrameBase64,
  getVideoProcessingCapability,
  inspectLocalMedia,
  runBatchVideoProcess
} from '../services/ffmpeg'

const showOpenDialogSchema = z
  .object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
    buttonLabel: z.string().optional(),
    message: z.string().optional(),
    securityScopedBookmarks: z.boolean().optional(),
    filters: z
      .array(
        z.object({
          name: z.string(),
          extensions: z.array(z.string())
        })
      )
      .optional(),
    properties: z
      .array(
        z.enum([
          'openFile',
          'openDirectory',
          'multiSelections',
          'showHiddenFiles',
          'createDirectory',
          'promptToCreate',
          'noResolveAliases',
          'treatPackageAsDirectory',
          'dontAddToRecent'
        ])
      )
      .optional()
  })
  .passthrough()

const isAllowedExternalUrl = (url: string): boolean => {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const LOCAL_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])
const LOCAL_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg'])
const batchVideoTaskStore = new Map<string, BatchVideoProcessStatus>()
const BATCH_VIDEO_TASK_TTL_MS = 30 * 60 * 1000

const scheduleBatchVideoTaskCleanup = (taskId: string): void => {
  setTimeout(() => {
    batchVideoTaskStore.delete(taskId)
  }, BATCH_VIDEO_TASK_TTL_MS).unref?.()
}

export const systemRouter = trpc.router({
  /**
   * 获取应用版本号
   */
  getVersion: publicProcedure.query(() => {
    return app.getVersion()
  }),

  /**
   * 在浏览器中打开外部链接
   */
  openExternal: publicProcedure.input(z.object({ url: z.string().url() })).mutation(async ({ input }) => {
    if (!isAllowedExternalUrl(input.url)) {
      throw new Error('仅支持打开 http/https 链接')
    }
    await shell.openExternal(input.url)
    return { success: true }
  }),

  /**
   * 显示文件打开对话框
   */
  showOpenDialog: publicProcedure.input(showOpenDialogSchema).mutation(async ({ input }) => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (!focusedWindow) return []
    const result = await dialog.showOpenDialog(focusedWindow, input)
    return result.filePaths
  }),

  /**
   * 打开本地文件
   */
  openFile: publicProcedure.input(z.string()).mutation(async ({ input }) => {
    if (input) {
      const openError = await shell.openPath(input)
      if (openError) {
        throw new Error(openError)
      }
    }
    return { success: true }
  }),

  // 打开本地文件所在文件夹
  openFolder: publicProcedure.input(z.object({ path: z.string() })).mutation(async ({ input }) => {
    if (fs.existsSync(input.path)) {
      shell.showItemInFolder(input.path)
      return { success: true }
    }
    throw new Error('文件不存在')
  }),

  getLocalMediaMeta: publicProcedure.input(z.object({ filePath: z.string() })).mutation(async ({ input }) => {
    if (!fs.existsSync(input.filePath)) {
      throw new Error('文件不存在')
    }

    const stat = fs.statSync(input.filePath)
    if (!stat.isFile()) {
      throw new Error('目标不是文件')
    }

    const extension = path.extname(input.filePath).toLowerCase()
    if (LOCAL_IMAGE_EXTENSIONS.has(extension)) {
      const image = nativeImage.createFromPath(input.filePath)
      const imageSize = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
      return {
        type: 'image' as const,
        size: stat.size,
        width: imageSize.width || undefined,
        height: imageSize.height || undefined,
        cover: image.isEmpty() ? undefined : image.toDataURL()
      }
    }

    if (LOCAL_AUDIO_EXTENSIONS.has(extension)) {
      const meta = await inspectLocalMedia(input.filePath)
      return {
        ...meta,
        type: meta.type === 'audio' ? 'audio' : 'other',
        size: stat.size
      }
    }

    const meta = await inspectLocalMedia(input.filePath)
    const cover =
      meta.type === 'video' ? await captureVideoFrameBase64(input.filePath).catch(() => undefined) : undefined
    return {
      ...meta,
      size: stat.size,
      cover
    }
  }),

  getVideoProcessingCapability: publicProcedure.query(async () => {
    return getVideoProcessingCapability()
  }),

  batchProcessVideo: publicProcedure.input(batchVideoProcessSchema).mutation(async ({ input }) => {
    const taskId = randomUUID()
    const capability = await getVideoProcessingCapability()
    const initialStatus: BatchVideoProcessStatus = {
      taskId,
      state: 'pending',
      outputDir: input.outputDir,
      totalItems: input.items.length,
      completedItems: 0,
      successCount: 0,
      errorCount: 0,
      percent: 0,
      message: '任务已创建，等待 FFmpeg 启动。',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      results: [],
      capability
    }

    batchVideoTaskStore.set(taskId, initialStatus)
    scheduleBatchVideoTaskCleanup(taskId)

    void runBatchVideoProcess(input, {
      taskId,
      capability,
      onProgress: (status) => {
        batchVideoTaskStore.set(taskId, status)
      }
    }).catch((error) => {
      const currentStatus = batchVideoTaskStore.get(taskId) || initialStatus
      batchVideoTaskStore.set(taskId, {
        ...currentStatus,
        state: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    })

    return {
      taskId,
      status: initialStatus
    }
  }),

  getBatchVideoProcessStatus: publicProcedure
    .input(
      z.object({
        taskId: z.string().trim().min(1)
      })
    )
    .query(({ input }) => {
      const task = batchVideoTaskStore.get(input.taskId)
      if (!task) {
        throw new Error('批处理任务不存在或已过期')
      }
      return task
    }),

  clearBatchVideoProcessStatus: publicProcedure
    .input(
      z.object({
        taskId: z.string().trim().min(1)
      })
    )
    .mutation(({ input }) => {
      batchVideoTaskStore.delete(input.taskId)
      return { success: true }
    }),

  /**
   * 最小化窗口
   */
  minimize: publicProcedure.mutation(() => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.minimize()
    return { success: true }
  }),

  /**
   * 最大化/取消最大化窗口
   */
  maximize: publicProcedure.mutation(() => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
    return { success: true }
  }),

  /**
   * 关闭窗口
   */
  close: publicProcedure.mutation(() => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.close()
    return { success: true }
  })
})
