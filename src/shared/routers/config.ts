import { db } from '@main/db'
import {
  configs,
  configCreateSchema,
  configUpdateSchema,
  configKeySchema,
  configGroupSchema,
  configBatchSetSchema,
  type ConfigValueType
} from '../db/config-schema'
import { BizError, publicProcedure, trpc } from './trpc'
import { eq, and } from 'drizzle-orm'
import { idSchema } from '../db/base'
import { z } from 'zod'

// ─── 辅助函数 ────────────────────────────────────────

/**
 * 将存储的文本值按 valueType 解析为实际类型
 */
function parseConfigValue(value: string, valueType: ConfigValueType): unknown {
  switch (valueType) {
    case 'number':
      return Number(value)
    case 'boolean':
      return value === 'true' || value === '1'
    case 'json':
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    default:
      return value
  }
}

/**
 * 将任意类型的值序列化为文本存储
 */
function serializeConfigValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// ─── Config 路由 ─────────────────────────────────────
export const configRouter = trpc.router({
  /**
   * 获取所有配置（按 group 和 order 排序）
   */
  list: publicProcedure.query(async () => {
    const result = await db.select().from(configs)
    // 按 group → order 排序
    result.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group)
      return a.order - b.order
    })
    return result
  }),

  /**
   * 根据 ID 获取单条配置
   */
  get: publicProcedure.input(idSchema).query(async ({ input }) => {
    const result = await db.select().from(configs).where(eq(configs.id, input.id)).limit(1)
    if (result.length === 0) {
      throw new BizError('配置项不存在', 404)
    }
    return result[0]
  }),

  /**
   * 根据 key 获取配置值（最常用的接口）
   * 返回: { key, value, parsedValue, valueType }
   */
  getByKey: publicProcedure.input(configKeySchema).query(async ({ input }) => {
    const result = await db
      .select()
      .from(configs)
      .where(eq(configs.key, input.key))
      .limit(1)
    if (result.length === 0) {
      throw new BizError(`配置项 "${input.key}" 不存在`, 404)
    }
    const config = result[0]
    return {
      ...config,
      parsedValue: parseConfigValue(config.value, config.valueType as ConfigValueType)
    }
  }),

  /**
   * 按分组获取配置列表
   */
  getByGroup: publicProcedure.input(configGroupSchema).query(async ({ input }) => {
    const result = await db
      .select()
      .from(configs)
      .where(eq(configs.group, input.group))
    // 按 order 排序
    result.sort((a, b) => a.order - b.order)
    return result
  }),

  /**
   * 获取所有配置，按 group 分组返回 Map
   * 返回: { [group]: Config[] }
   */
  getAllGrouped: publicProcedure.query(async () => {
    const result = await db.select().from(configs)
    const grouped: Record<string, typeof result> = {}
    for (const item of result) {
      if (!grouped[item.group]) {
        grouped[item.group] = []
      }
      grouped[item.group].push(item)
    }
    // 每个 group 内按 order 排序
    for (const group of Object.keys(grouped)) {
      grouped[group].sort((a, b) => a.order - b.order)
    }
    return grouped
  }),

  /**
   * 创建配置
   */
  create: publicProcedure.input(configCreateSchema).mutation(async ({ input }) => {
    // 检查 key 在同 group 中是否已存在
    const existing = await db
      .select()
      .from(configs)
      .where(and(eq(configs.key, input.key), eq(configs.group, input.group ?? 'general')))
      .limit(1)
    if (existing.length > 0) {
      throw new BizError(`配置项 "${input.key}" 在分组 "${input.group ?? 'general'}" 中已存在`, 400)
    }

    const result = await db.insert(configs).values(input).returning()
    return result[0]
  }),

  /**
   * 更新配置
   */
  update: publicProcedure.input(configUpdateSchema).mutation(async ({ input }) => {
    const { id, ...data } = input

    // 检查是否存在
    const [existing] = await db.select().from(configs).where(eq(configs.id, id)).limit(1)
    if (!existing) {
      throw new BizError('配置项不存在', 404)
    }

    const result = await db
      .update(configs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(configs.id, id))
      .returning()
    return result[0]
  }),

  /**
   * 根据 key 快速设置值（upsert 语义）
   * 如果 key 存在则更新 value，不存在则创建
   */
  setByKey: publicProcedure
    .input(z.object({
      key: z.string().min(1),
      value: z.string(),
      group: z.string().optional(),
      valueType: z.enum(['string', 'number', 'boolean', 'json']).optional()
    }))
    .mutation(async ({ input }) => {
      const { key, value, group = 'general', valueType } = input

      const [existing] = await db
        .select()
        .from(configs)
        .where(eq(configs.key, key))
        .limit(1)

      if (existing) {
        // 更新
        const updateData: Record<string, unknown> = { value, updatedAt: new Date() }
        if (valueType) updateData.valueType = valueType
        const result = await db
          .update(configs)
          .set(updateData)
          .where(eq(configs.id, existing.id))
          .returning()
        return result[0]
      } else {
        // 创建
        const result = await db
          .insert(configs)
          .values({
            key,
            value: serializeConfigValue(value),
            group,
            valueType: valueType ?? 'string'
          })
          .returning()
        return result[0]
      }
    }),

  /**
   * 批量设置配置（upsert 语义）
   * 适用于设置页面保存时一次性提交多个配置项
   */
  batchSet: publicProcedure.input(configBatchSetSchema).mutation(async ({ input }) => {
    const results: unknown[] = []

    for (const item of input) {
      const { key, value, group = 'general', valueType = 'string' } = item

      const [existing] = await db
        .select()
        .from(configs)
        .where(eq(configs.key, key))
        .limit(1)

      if (existing) {
        const result = await db
          .update(configs)
          .set({ value, valueType, updatedAt: new Date() })
          .where(eq(configs.id, existing.id))
          .returning()
        results.push(result[0])
      } else {
        const result = await db
          .insert(configs)
          .values({ key, value, group, valueType })
          .returning()
        results.push(result[0])
      }
    }

    return results
  }),

  /**
   * 删除配置（系统内置配置不可删除）
   */
  delete: publicProcedure.input(idSchema).mutation(async ({ input }) => {
    const [existing] = await db
      .select()
      .from(configs)
      .where(eq(configs.id, input.id))
      .limit(1)

    if (!existing) {
      throw new BizError('配置项不存在', 404)
    }
    if (existing.isSystem === 1) {
      throw new BizError('系统内置配置不可删除', 400)
    }

    await db.delete(configs).where(eq(configs.id, input.id))
    return { success: true }
  }),

  /**
   * 恢复单个配置项为默认值
   */
  resetToDefault: publicProcedure.input(idSchema).mutation(async ({ input }) => {
    const [existing] = await db
      .select()
      .from(configs)
      .where(eq(configs.id, input.id))
      .limit(1)

    if (!existing) {
      throw new BizError('配置项不存在', 404)
    }
    if (!existing.defaultValue) {
      throw new BizError('该配置项没有设置默认值', 400)
    }

    const result = await db
      .update(configs)
      .set({ value: existing.defaultValue, updatedAt: new Date() })
      .where(eq(configs.id, input.id))
      .returning()
    return result[0]
  }),

  /**
   * 恢复某个分组的所有配置为默认值
   */
  resetGroupToDefault: publicProcedure.input(configGroupSchema).mutation(async ({ input }) => {
    const items = await db
      .select()
      .from(configs)
      .where(eq(configs.group, input.group))

    let resetCount = 0
    for (const item of items) {
      if (item.defaultValue) {
        await db
          .update(configs)
          .set({ value: item.defaultValue, updatedAt: new Date() })
          .where(eq(configs.id, item.id))
        resetCount++
      }
    }

    return { success: true, resetCount }
  })
})
