import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { base } from './base'

export const tagTypeSchema = z.enum(['resource', 'bookmark'])

export const tags = sqliteTable(
  'tags',
  {
    ...base,
    name: text('name').notNull(),
    type: text('type').notNull()
  },
  (table) => [uniqueIndex('tags_type_name_unique').on(table.type, table.name), index('tags_type_idx').on(table.type)]
)

export const tagMaps = sqliteTable(
  'tag_maps',
  {
    mapId: integer('map_id').notNull(),
    tagId: integer('tag_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => [
    primaryKey({ columns: [table.mapId, table.tagId] }),
    index('tag_maps_map_id_idx').on(table.mapId),
    index('tag_maps_tag_id_idx').on(table.tagId)
  ]
)

export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert
export type TagMap = typeof tagMaps.$inferSelect
export type NewTagMap = typeof tagMaps.$inferInsert
export type TagType = z.infer<typeof tagTypeSchema>

const baseUpdateSchema = createUpdateSchema(tags).omit({
  createdAt: true,
  updatedAt: true
})

export const tagCreateSchema = createInsertSchema(tags)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true
  })
  .required({
    name: true,
    type: true
  })

export const tagUpdateSchema = baseUpdateSchema.required({
  id: true,
  name: true,
  type: true
})

export const tagSelectSchema = createSelectSchema(tags)
