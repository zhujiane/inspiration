import { publicProcedure, trpc } from '@shared/routers/trpc'
import { app, shell, BrowserWindow, dialog, nativeImage } from 'electron'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { captureVideoFrameBase64, inspectLocalMedia } from '../services/ffmpeg'

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

const createFileDataUrl = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase()
  const mimeType =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.bmp'
              ? 'image/bmp'
              : ext === '.svg'
                ? 'image/svg+xml'
                : 'application/octet-stream'
  const content = fs.readFileSync(filePath)
  return `data:${mimeType};base64,${content.toString('base64')}`
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
        cover: createFileDataUrl(input.filePath)
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
    const cover = meta.type === 'video' ? await captureVideoFrameBase64(input.filePath) : undefined
    return {
      ...meta,
      size: stat.size,
      cover
    }
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
