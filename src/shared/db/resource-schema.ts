import { randomUUID } from 'crypto'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod'


export const base={
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().$defaultFn(() => randomUUID()),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}

export const resources = sqliteTable('resources', {
  ...base,
  name: text('name').notNull(),
  type: text('type').notNull(),
  url: text('url'),
  description: text('description'),
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
export const resourceCreateSchema = baseUpdateSchema
  .omit({ id: true })
  .required({
    name: true,
    type: true
  })
export const resourceSelectSchema = createSelectSchema(resources)
