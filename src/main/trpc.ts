import { ipcMain } from 'electron'
import { appRouter } from './router'
import log from './logger'

interface TrpcRequestPayload {
  path: string
  input: unknown
}

const toTrpcError = (error: unknown) => ({
  message: error instanceof Error ? error.message : 'Unknown error',
  data: (error as any)?.data || {}
})

/**
 * 设置自定义 tRPC IPC 处理器
 * 这种方式取代了 electron-trpc，更加轻量且易于控制
 */
export function setupTRPC(): void {
  ipcMain.handle('trpc-request', async (_event, payload: TrpcRequestPayload) => {
    const { path, input } = payload || {}
    if (!path || typeof path !== 'string') {
      return { error: { message: 'Invalid tRPC request path', data: {} } }
    }

    const startTime = Date.now()
    log.info(`[tRPC Request] ${path}`, { input })
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
      const duration = Date.now() - startTime
      log.debug(`[tRPC Success] ${path} - ${duration}ms`)
      return { result }
    } catch (error) {
      const duration = Date.now() - startTime
      log.error(`[tRPC Error] ${path} - ${duration}ms`, {
        error: error instanceof Error ? error.stack : error,
        input
      })
      return { error: toTrpcError(error) }
    }
  })
}
