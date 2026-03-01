import { trpc } from './trpc'
import { resourceRouter } from './resource'
import { bookmarkRouter } from './bookmark'
import { configRouter } from './config'

// 主路由
export const appRouter = trpc.router({
  resource: resourceRouter,
  bookmark: bookmarkRouter,
  config: configRouter
})

export type AppRouter = typeof appRouter
export * from './trpc'
