import { ipcMain } from 'electron'
import { appRouter } from './router'

/**
 * 设置自定义 tRPC IPC 处理器
 * 这种方式取代了 electron-trpc，更加轻量且易于控制
 */
export function setupTRPC(): void {
  ipcMain.handle('trpc-request', async (_event, { path, input }) => {
    try {
      // 创建一个内部调用者
      const caller = appRouter.createCaller({})
      
      // 处理嵌套路径，例如 "resource.list"
      const pathParts = path.split('.')
      let procedure: any = caller
      for (const part of pathParts) {
        if (procedure[part]) {
          procedure = procedure[part]
        } else {
          throw new Error(`Procedure not found: ${path}`)
        }
      }

      // 执行调用
      const result = await procedure(input)
      return { result }
    } catch (error) {
      console.error(`tRPC error at ${path}:`, error)
      return {
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          data: (error as any).data || {}
        }
      }
    }
  })
}
