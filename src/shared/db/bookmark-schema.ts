import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { base } from './base'

export const bookmarks = sqliteTable('bookmarks', {
  ...base,
  name: text('name').notNull(),
  order: integer('order').notNull().default(0),
  parentId: integer('parent_id').notNull().default(0),
  type: integer('type').notNull().default(0), // 1=group, 2=url, 3=app
  url: text('url'),
  storage: text('storage'), // 浏览器的session ，cookie ，localstorage ，转成json
  userDataPath: text('userDataPath'), // 浏览器持久化到本地的路径
  status: integer('status').notNull().default(0), // 待定
  description: text('description')
})

export type Bookmark = typeof bookmarks.$inferSelect
export type NewBookmark = typeof bookmarks.$inferInsert

// 基于 drizzle-zod 的更新 schema，去掉自动维护的时间字段
const baseUpdateSchema = createUpdateSchema(bookmarks).omit({
  createdAt: true,
  updatedAt: true
})

// 更新时：必须带 id，其它字段可选
export const bookmarkUpdateSchema = baseUpdateSchema.required({
  id: true
})

// 创建时：不带 id，且 name / type 必填
export const bookmarkCreateSchema = baseUpdateSchema.omit({ id: true }).required({
  name: true,
})
export const bookmarkSelectSchema = createSelectSchema(bookmarks)
