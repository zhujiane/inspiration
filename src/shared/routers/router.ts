import { trpc } from './trpc'
import { resourceRouter } from './resource'
import { bookmarkRouter } from './bookmark'

// 主路由
export const appRouter = trpc.router({
  resource: resourceRouter,
  bookmark: bookmarkRouter
})

export type AppRouter = typeof appRouter
export * from './trpc'
