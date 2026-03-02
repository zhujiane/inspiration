import { publicProcedure, trpc } from '@shared/routers/trpc'
import { app, shell, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import fs from 'fs'

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
