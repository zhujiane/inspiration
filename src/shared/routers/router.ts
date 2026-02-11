import { trpc } from './trpc'
import { resourceRouter } from './resource'

// 主路由
export const appRouter = trpc.router({
  resource: resourceRouter
})

export type AppRouter = typeof appRouter
export * from './trpc'
