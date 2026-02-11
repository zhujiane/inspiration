import { trpc } from '@shared/routers/trpc'
import { appRouter as sharedRouter } from '@shared/routers/router'
import { systemRouter } from './routers/system'

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
   * 自动展开 sharedRouter 中的所有子路由 (resource, bookmark 等)
   */
  ...sharedRouter._def.procedures,
  
  /**
   * 挂载 Electron 特有的子路由
   */
  system: systemRouter
})

export type AppRouter = typeof appRouter
