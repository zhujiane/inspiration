import { createTRPCClient, TRPCClientError } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter } from '@main/router'

type TrpcIpcResponse = {
  result?: unknown
  error?: object
}

const isTrpcIpcResponse = (value: unknown): value is TrpcIpcResponse =>
  typeof value === 'object' && value !== null && ('result' in value || 'error' in value)

const toTrpcClientErrorInput = (value: unknown): object | Error => {
  if (value instanceof Error) return value
  if (typeof value === 'object' && value !== null) return value
  return { message: String(value) }
}

// 创建 tRPC 客户端，使用自定义 IPC link
export const trpc = createTRPCClient<AppRouter>({
  links: [
    () =>
      ({ op }) =>
        observable((observer) => {
          let active = true
          const { path, input, type } = op
          window.trpc
            .invoke({ path, input, type })
            .then((rawResponse: unknown) => {
              if (!active) return
              if (!isTrpcIpcResponse(rawResponse)) {
                observer.error(new TRPCClientError('Invalid tRPC IPC response'))
                return
              }

              const response = rawResponse
              if (response.error) {
                observer.error(TRPCClientError.from(response.error))
              } else {
                observer.next({ result: { data: response.result as any } })
                observer.complete()
              }
            })
            .catch((err: unknown) => {
              if (!active) return
              observer.error(TRPCClientError.from(toTrpcClientErrorInput(err)))
            })

          return () => {
            active = false
          }
        })
  ]
})

// 导出类型以便在组件中使用
export type { AppRouter }
