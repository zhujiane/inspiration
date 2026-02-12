import { db } from '@main/db'
import { bookmarkCreateSchema, bookmarks, bookmarkUpdateSchema } from '../db/bookmark-schema'
import { BizError, publicProcedure, trpc } from './trpc'
import { eq } from 'drizzle-orm'
import { idSchema } from '../db/base'
import { z } from 'zod'

// 辅助函数：获取网页 Favicon 并转为 Base64
async function fetchFaviconAsBase64(url: string): Promise<string | null> {
  try {
    const domain = new URL(url).hostname
    const iconUrl = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=16`
    const response = await fetch(iconUrl)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    return `data:image/png;base64,${base64}`
  } catch (error) {
    console.error('Failed to fetch favicon:', error)
    return null
  }
}

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
    let icon = input.icon
    if (!icon) {
      if (input.type === 1) {
        // type=group: 随机颜色
        const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96']
        icon = colors[Math.floor(Math.random() * colors.length)]
      } else if (input.type === 2 && input.url) {
        // type=url: 取网站 icon 转 base64
        icon = (await fetchFaviconAsBase64(input.url)) || undefined
      } else if (input.type === 3) {
        // type=app: 默认 antd icon
        icon = 'AppstoreOutlined'
      }
    }

    const result = await db
      .insert(bookmarks)
      .values({ ...input, icon })
      .returning()
    return result[0]
  }),

  // 更新书签
  update: publicProcedure.input(bookmarkUpdateSchema).mutation(async ({ input }) => {
    const { id, ...data } = input

    // 如果提供了 URL 但没提供 icon，尝试重新获取 icon
    if (data.url && !data.icon) {
      data.icon = (await fetchFaviconAsBase64(data.url)) || undefined
    }

    const result = await db.update(bookmarks).set(data).where(eq(bookmarks.id, id)).returning()
    if (result.length === 0) {
      throw new BizError('书签不存在', 404)
    }
    return result[0]
  }),

  // 删除书签
  delete: publicProcedure.input(idSchema).mutation(async ({ input }) => {
    // 检查是否为系统默认项目
    const [bookmark] = await db.select().from(bookmarks).where(eq(bookmarks.id, input.id)).limit(1)
    
    if (bookmark && bookmark.isDefault === 1) {
      throw new BizError('系统默认项目，不能删除', 400)
    }

    const result = await db.delete(bookmarks).where(eq(bookmarks.id, input.id)).returning()
    if (result.length === 0) {
      throw new BizError('书签不存在', 404)
    }
    return { success: true }
  }),

  // 批量更新排序
  reorder: publicProcedure
    .input(
      z.array(
        z.object({
          id: z.number(),
          order: z.number().optional(),
          parentId: z.number().optional()
        })
      )
    )
    .mutation(async ({ input }) => {
      for (const item of input) {
        const { id, ...data } = item
        await db.update(bookmarks).set(data).where(eq(bookmarks.id, id))
      }
      return { success: true }
    })
})
