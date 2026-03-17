import { trpc } from './trpc'
import { resourceRouter } from './resource'
import { bookmarkRouter } from './bookmark'
import { configRouter } from './config'
import { tagRouter } from './tag'

// 主路由
export const appRouter = trpc.router({
  resource: resourceRouter,
  bookmark: bookmarkRouter,
  config: configRouter,
  tag: tagRouter
})

export type AppRouter = typeof appRouter
export * from './trpc'
