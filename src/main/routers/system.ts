import { publicProcedure, trpc } from '@shared/routers/trpc'
import { app, shell, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import fs from 'fs'

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
    await shell.openExternal(input.url)
    return { success: true }
  }),

  /**
   * 显示文件打开对话框
   */
  showOpenDialog: publicProcedure.input(z.any()).mutation(async ({ input }) => {
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
      await shell.openPath(input)
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

