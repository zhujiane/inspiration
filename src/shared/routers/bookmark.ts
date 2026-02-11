import { db } from '@main/db'
import { bookmarkCreateSchema, bookmarks, bookmarkUpdateSchema } from '../db/bookmark-schema'
import { BizError, publicProcedure, trpc } from './trpc'
import { eq } from 'drizzle-orm'
import { idSchema } from '../db/base'

// Bookmark CRUD 路由
export const bookmarkRouter = trpc.router({
  // 获取所有书签
  list: publicProcedure.query(async () => {
    const result = await db.select().from(bookmarks)
    return result
  }),

  // 根据 ID 获取单个书签
  get: publicProcedure.input(idSchema).query(async ({ input }) => {
    const result = await db.select().from(bookmarks).where(eq(bookmarks.id, input.id)).limit(1)
    if (result.length === 0) {
      throw new BizError('书签不存在', 404)
    }
    return result[0]
  }),

  // 创建书签
  create: publicProcedure.input(bookmarkCreateSchema).mutation(async ({ input }) => {
    const result = await db.insert(bookmarks).values(input).returning()
    return result[0]
  }),

  // 更新书签
  update: publicProcedure.input(bookmarkUpdateSchema).mutation(async ({ input }) => {
    const { id, ...data } = input
    const result = await db.update(bookmarks).set(data).where(eq(bookmarks.id, id)).returning()
    if (result.length === 0) {
      throw new BizError('书签不存在', 404)
    }
    return result[0]
  }),

  // 删除书签
  delete: publicProcedure.input(idSchema).mutation(async ({ input }) => {
    const result = await db.delete(bookmarks).where(eq(bookmarks.id, input.id)).returning()
    if (result.length === 0) {
      throw new BizError('书签不存在', 404)
    }
    return { success: true }
  })
})
