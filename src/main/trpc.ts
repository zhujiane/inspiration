import { createIPCHandler } from 'electron-trpc/main'
import type { BrowserWindow } from 'electron'
import { appRouter } from '@shared/routers/router'

// 在 main 进程中创建 tRPC IPC handler
let handler: ReturnType<typeof createIPCHandler<typeof appRouter>> | undefined

export function setupTRPC(windows?: BrowserWindow[]): void {
  if (!handler) {
    handler = createIPCHandler({ router: appRouter, windows })
    return
  }

  if (windows?.length) {
    for (const win of windows) handler.attachWindow(win)
  }
}
