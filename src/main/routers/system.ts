import { publicProcedure, trpc } from '@shared/routers/trpc'
import { app, shell } from 'electron'
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
    })
})
