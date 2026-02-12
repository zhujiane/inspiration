import { publicProcedure, trpc } from '@shared/routers/trpc'
import { app, shell, BrowserWindow } from 'electron'
import { z } from 'zod'

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
  openExternal: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      await shell.openExternal(input.url)
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
