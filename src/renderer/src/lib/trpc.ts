import { createTRPCProxyClient, TRPCClientError } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter } from '@shared/routers/router'

// 创建 tRPC 客户端，使用自定义 IPC link
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    () =>
      ({ op }) =>
        observable((observer) => {
          const { path, input, type } = op
          window.trpc
            .invoke('trpc-request', { path, input, type })
            .then((response: any) => {
              if (response.error) {
                observer.error(TRPCClientError.from(response.error))
              } else {
                observer.next({ result: { data: response.result } })
                observer.complete()
              }
            })
            .catch((err: any) => {
              observer.error(TRPCClientError.from(err))
            })
        })
  ]
})

// 导出类型以便在组件中使用
export type { AppRouter }
