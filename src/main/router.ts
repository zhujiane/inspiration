import { trpc } from '@shared/routers/trpc'
import { resourceRouter } from '@shared/routers/resource'
import { bookmarkRouter } from '@shared/routers/bookmark'
import { configRouter } from '@shared/routers/config'
import { systemRouter } from './routers/system'
import { ffmpegRouter } from './routers/ffmpeg'
import { snifferRouter } from './routers/sniffer'

/**
 * 主进程根路由
 * 组合了 shared 中的数据库路由和 main 中的 Electron 特有路由
 *
 * 这种结构保证了：
 * 1. 数据库逻辑 (shared) 可以被复用 (如果有 web 版的话)
 * 2. Electron 特有逻辑 (main) 保持在主进程，不会被打包到 shared 中
 */
export const appRouter = trpc.router({
  /**
   * 共享业务路由（与 web 侧保持一致）
   */
  resource: resourceRouter,
  bookmark: bookmarkRouter,
  config: configRouter,

  /**
   * 挂载 Electron 特有的子路由
   */
  system: systemRouter,
  ffmpeg: ffmpegRouter,
  sniffer: snifferRouter
})

export type AppRouter = typeof appRouter
