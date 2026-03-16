import { db } from '@main/db'
import { resourceCreateSchema, resources, resourceUpdateSchema } from '../db/resource-schema'
import { BizError, publicProcedure, trpc } from './trpc'
import { eq, desc } from 'drizzle-orm'
import { idSchema } from '../db/base'

// Resource CRUD 路由
export const resourceRouter = trpc.router({
  // 获取所有资源
  list: publicProcedure.query(async () => {
    const result = await db.select().from(resources).orderBy(desc(resources.id))

    return result
  }),

  // 根据 ID 获取单个资源
  get: publicProcedure.input(idSchema).query(async ({ input }) => {
    const result = await db.select().from(resources).where(eq(resources.id, input.id)).limit(1)
    if (result.length === 0) {
      throw new BizError('资源不存在', 404)
    }
    return result[0]
  }),

  // 创建资源
  create: publicProcedure.input(resourceCreateSchema).mutation(async ({ input }) => {
    const result = await db.insert(resources).values(input).returning()
    return result[0]
  }),

  // 更新资源
  update: publicProcedure.input(resourceUpdateSchema).mutation(async ({ input }) => {
    const { id, ...data } = input
    const result = await db.update(resources).set(data).where(eq(resources.id, id)).returning()
    if (result.length === 0) {
      throw new BizError('资源不存在', 404)
    }
    return result[0]
  }),

  // 删除资源
  delete: publicProcedure.input(idSchema).mutation(async ({ input }) => {
    const result = await db.delete(resources).where(eq(resources.id, input.id)).returning()
    if (result.length === 0) {
      throw new BizError('资源不存在', 404)
    }
    return { success: true }
  })
})
