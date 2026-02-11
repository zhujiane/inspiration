import { text, integer } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { randomUUID } from 'crypto'

export const base = {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code')
    .notNull()
    .$defaultFn(() => randomUUID()),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
}

// 通用 ID 验证 schema
export const idSchema = z.object({
  id: z.number().int().positive()
})
