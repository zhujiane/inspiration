import { db } from '@main/db'
import { and, desc, eq, inArray, like, not, or } from 'drizzle-orm'
import { z } from 'zod'
import { idSchema } from '../db/base'
import {
  type Tag,
  type TagType,
  tagCreateSchema,
  tagMaps,
  tagTypeSchema,
  tags,
  tagUpdateSchema
} from '../db/tag-schema'
import { BizError, publicProcedure, trpc } from './trpc'

const tagListSchema = z.object({
  type: tagTypeSchema.optional(),
  keyword: z.string().trim().optional().default('')
})

const mapTagSchema = z.object({
  type: tagTypeSchema,
  mapId: z.number().int().positive()
})

const setMapTagsSchema = mapTagSchema.extend({
  tagNames: z.array(z.string()).optional().default([])
})

const normalizeTagNames = (tagNames: string[]) => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const rawName of tagNames) {
    const name = rawName.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }

  return result
}

const ensureUniqueTag = async ({ id, name, type }: { id?: number; name: string; type: TagType }) => {
  const duplicated = await db
    .select()
    .from(tags)
    .where(and(eq(tags.type, type), eq(tags.name, name), id ? not(eq(tags.id, id)) : undefined))
    .limit(1)

  if (duplicated.length > 0) {
    throw new BizError('标签已存在', 400)
  }
}

export async function getTagsForMapIds(type: TagType, mapIds: number[]) {
  if (mapIds.length === 0) return {}

  const rows = await db
    .select({
      mapId: tagMaps.mapId,
      id: tags.id,
      code: tags.code,
      name: tags.name,
      type: tags.type,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt
    })
    .from(tagMaps)
    .innerJoin(tags, eq(tagMaps.tagId, tags.id))
    .where(and(eq(tags.type, type), inArray(tagMaps.mapId, mapIds)))
    .orderBy(desc(tags.id))

  return rows.reduce<Record<number, Tag[]>>((acc, row) => {
    if (!acc[row.mapId]) acc[row.mapId] = []
    acc[row.mapId].push({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })
    return acc
  }, {})
}

export async function clearMapTags(type: TagType, mapId: number) {
  const currentTags = await getTagsForMapIds(type, [mapId])
  const currentTagIds = (currentTags[mapId] ?? []).map((tag) => tag.id)

  if (currentTagIds.length === 0) return

  await db.delete(tagMaps).where(and(eq(tagMaps.mapId, mapId), inArray(tagMaps.tagId, currentTagIds)))
}

export const tagRouter = trpc.router({
  list: publicProcedure.input(tagListSchema).query(async ({ input }) => {
    const keyword = input.keyword.trim()
    const where = keyword
      ? and(
          input.type ? eq(tags.type, input.type) : undefined,
          or(like(tags.name, `%${keyword}%`), like(tags.type, `%${keyword}%`))
        )
      : input.type
        ? eq(tags.type, input.type)
        : undefined

    return db.select().from(tags).where(where).orderBy(desc(tags.id))
  }),

  get: publicProcedure.input(idSchema).query(async ({ input }) => {
    const result = await db.select().from(tags).where(eq(tags.id, input.id)).limit(1)
    if (result.length === 0) {
      throw new BizError('标签不存在', 404)
    }
    return result[0]
  }),

  create: publicProcedure.input(tagCreateSchema).mutation(async ({ input }) => {
    const data = {
      ...input,
      name: input.name.trim(),
      type: tagTypeSchema.parse(input.type)
    }

    await ensureUniqueTag(data)
    const result = await db.insert(tags).values(data).returning()
    return result[0]
  }),

  update: publicProcedure.input(tagUpdateSchema).mutation(async ({ input }) => {
    const data = {
      ...input,
      name: input.name.trim(),
      type: tagTypeSchema.parse(input.type)
    }

    await ensureUniqueTag(data)
    const result = await db
      .update(tags)
      .set({
        name: data.name,
        type: data.type,
        updatedAt: new Date()
      })
      .where(eq(tags.id, data.id))
      .returning()

    if (result.length === 0) {
      throw new BizError('标签不存在', 404)
    }
    return result[0]
  }),

  delete: publicProcedure.input(idSchema).mutation(async ({ input }) => {
    await db.delete(tagMaps).where(eq(tagMaps.tagId, input.id))
    const result = await db.delete(tags).where(eq(tags.id, input.id)).returning()
    if (result.length === 0) {
      throw new BizError('标签不存在', 404)
    }
    return { success: true }
  }),

  getMapTags: publicProcedure.input(mapTagSchema).query(async ({ input }) => {
    return (await getTagsForMapIds(input.type, [input.mapId]))[input.mapId] ?? []
  }),

  setMapTags: publicProcedure.input(setMapTagsSchema).mutation(async ({ input }) => {
    const tagNames = normalizeTagNames(input.tagNames)

    return db.transaction((tx) => {
      const existingTags =
        tagNames.length > 0
          ? tx
              .select()
              .from(tags)
              .where(and(eq(tags.type, input.type), inArray(tags.name, tagNames)))
              .all()
          : []

      const existingNameSet = new Set(existingTags.map((tag) => tag.name))
      const missingNames = tagNames.filter((name) => !existingNameSet.has(name))

      const insertedTags: Tag[] = []
      for (const name of missingNames) {
        const inserted = tx
          .insert(tags)
          .values({
            name,
            type: input.type
          })
          .returning()
          .get()
        insertedTags.push(inserted)
      }

      const nextTags = [...existingTags, ...insertedTags]

      const currentRows = tx
        .select({
          mapId: tagMaps.mapId,
          tagId: tagMaps.tagId
        })
        .from(tagMaps)
        .innerJoin(tags, eq(tagMaps.tagId, tags.id))
        .where(and(eq(tagMaps.mapId, input.mapId), eq(tags.type, input.type)))
        .all()

      const currentTagIds = currentRows.map((row) => row.tagId)
      const nextTagIds = nextTags.map((tag) => tag.id)
      const removeTagIds = currentTagIds.filter((tagId) => !nextTagIds.includes(tagId))
      const addTagIds = nextTagIds.filter((tagId) => !currentTagIds.includes(tagId))

      if (removeTagIds.length > 0) {
        tx.delete(tagMaps)
          .where(and(eq(tagMaps.mapId, input.mapId), inArray(tagMaps.tagId, removeTagIds)))
          .run()
      }

      if (addTagIds.length > 0) {
        tx.insert(tagMaps)
          .values(addTagIds.map((tagId) => ({ mapId: input.mapId, tagId })))
          .run()
      }

      return nextTags
    })
  })
})
