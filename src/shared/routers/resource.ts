import { db } from '@main/db'
import { type NewResource, resourceCreateSchema, resources, resourceUpdateSchema } from '../db/resource-schema'
import { BizError, publicProcedure, trpc } from './trpc'
import { desc, eq, like, or, sql } from 'drizzle-orm'
import { idSchema } from '../db/base'
import { z } from 'zod'

const resourceListSchema = z.object({
  keyword: z.string().trim().optional().default(''),
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(10)
})

// Resource CRUD 路由
export const resourceRouter = trpc.router({
  // 获取所有资源
  list: publicProcedure.input(resourceListSchema).query(async ({ input }) => {
    const keyword = input.keyword.trim()
    const page = input.page
    const pageSize = input.pageSize
    const offset = (page - 1) * pageSize
    const where = keyword
      ? or(
          like(resources.name, `%${keyword}%`),
          like(resources.type, `%${keyword}%`),
          like(resources.description, `%${keyword}%`)
        )
      : undefined

    const [items, totalResult] = await Promise.all([
      db.select().from(resources).where(where).orderBy(desc(resources.id)).limit(pageSize).offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(resources)
        .where(where)
    ])

    return {
      items,
      total: totalResult[0]?.count ?? 0,
      page,
      pageSize
    }
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
    const data: NewResource = input
    const result = await db.insert(resources).values(data).returning()
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
