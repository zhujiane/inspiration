import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { base } from './base'

export const bookmarks = sqliteTable('bookmarks', {
  ...base,
  name: text('name').notNull(),
  order:integer('order').notNull().default(0),
  group: text('group'),
  groupOrder: integer('groupOrder').notNull().default(0),
  url: text('url'),
  storage: text('storage'),
  userDataPath: text('userDataPath'),
  status: integer('status').notNull().default(0),
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
