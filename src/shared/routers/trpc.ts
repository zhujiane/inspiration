import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

/**
 * 业务异常类
 * 用于在业务逻辑中抛出已知的异常，包含错误消息和业务错误码
 */
export class BizError extends Error {
  constructor(
    public message: string,
    public code: number = 500
  ) {
    super(message)
    this.name = 'BizError'
    // 显式设置原型，确保 instanceof 正常工作
    Object.setPrototypeOf(this, BizError.prototype)
  }
}

// 初始化 tRPC
export const trpc = initTRPC.create({
  // 错误格式化器：将错误信息转换成前端易于处理的格式
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // 如果是 BizError，则透传业务错误码
        bizCode: error.cause instanceof BizError ? error.cause.code : undefined
      }
    }
  }
})

/**
 * 异常捕获中间件
 * 用于记录错误日志并统一处理非 TRPCError 类型的异常
 */
const errorMiddleware = trpc.middleware(async ({ next, path, type }) => {
  try {
    const result = await next()
    if (!result.ok) {
      console.error(`[tRPC Error Log] ${type} ${path}:`, result.error)
    }
    return result
  } catch (error) {
    // 捕获未预期的异常
    console.error(`[Unexpected Error] ${type} ${path}:`, error)

    if (error instanceof BizError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
        cause: error
      })
    }

    if (error instanceof TRPCError) {
      throw error
    }

    // 将其他未知异常转换为通用的 INTERNAL_SERVER_ERROR
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'An unknown error occurred',
      cause: error
    })
  }
})

// 导出基础路由和过程，默认应用异常捕获中间件
export const publicProcedure = trpc.procedure.use(errorMiddleware)

export const idSchema = z.object({
  id: z.number().int().positive()
})
