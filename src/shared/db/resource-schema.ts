import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { base } from './base'

export const resources = sqliteTable('resources', {
  ...base,
  name: text('name').notNull(),
  type: text('type').notNull(), // 视频，音频，文章，图片，文本，其他
  url: text('url'),
  description: text('description'),
  localPath: text('local_path'),
  platform: text('platform'),
  cover: text('cover'),
  metadata: text('metadata') // JSON string containing size, resolution, duration, codec, fps, audio params, etc.
})

export type Resource = typeof resources.$inferSelect
export type NewResource = typeof resources.$inferInsert

// 基于 drizzle-zod 的更新 schema，去掉自动维护的时间字段
const baseUpdateSchema = createUpdateSchema(resources).omit({
  createdAt: true,
  updatedAt: true
})

// 更新时：必须带 id，其它字段可选
export const resourceUpdateSchema = baseUpdateSchema.required({
  id: true
})

// 创建时：不带 id，且 name / type 必填
export const resourceCreateSchema = baseUpdateSchema.omit({ id: true }).required({
  name: true,
  type: true
})
export const resourceSelectSchema = createSelectSchema(resources)
