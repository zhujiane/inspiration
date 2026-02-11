import { createTRPCClient } from '@trpc/client'
import { ipcLink } from 'electron-trpc/renderer'
import type { AppRouter } from '@shared/routers/router'

// 创建 tRPC 客户端，使用 electron-trpc 的 ipcLink
export const trpc = createTRPCClient<AppRouter>({
  links: [ipcLink()]
})

// 导出类型以便在组件中使用
export type { AppRouter }
