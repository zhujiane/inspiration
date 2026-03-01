import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { base } from './base'
import { z } from 'zod'

/**
 * 系统配置表
 *
 * 采用 key-value 模式存储各类系统配置，通过 group 进行分组管理。
 * 支持多种值类型（string / number / boolean / json），
 * 并可标记配置项是否为系统内置（不可删除）。
 *
 * 配置分组示例:
 *   - general:    通用设置（语言、主题、启动行为等）
 *   - download:   下载设置（下载路径、并发数、代理等）
 *   - sniffer:    嗅探器设置（自动嗅探、过滤规则等）
 *   - appearance: 外观设置（字体大小、侧边栏宽度等）
 *   - shortcut:   快捷键设置
 *   - advanced:   高级设置（硬件加速、日志级别等）
 */
export const configs = sqliteTable('configs', {
  ...base,
  /** 配置键（同一 group 内唯一） */
  key: text('key').notNull(),
  /** 配置值（统一以文本存储，读取时按 valueType 解析） */
  value: text('value').notNull(),
  /** 值类型: string | number | boolean | json */
  valueType: text('value_type').notNull().default('string'),
  /** 配置分组 */
  group: text('group').notNull().default('general'),
  /** 配置项显示名称 */
  label: text('label'),
  /** 配置项说明 */
  description: text('description'),
  /** 默认值（用户恢复默认时使用） */
  defaultValue: text('default_value'),
  /** 排序序号（同 group 内排序） */
  order: integer('order').notNull().default(0),
  /** 是否系统内置 0=用户自定义, 1=系统内置 */
  isSystem: integer('is_system').notNull().default(0)
})

// ─── 类型推导 ────────────────────────────────────────
export type Config = typeof configs.$inferSelect
export type NewConfig = typeof configs.$inferInsert

// ─── 值类型枚举 ──────────────────────────────────────
export const ConfigValueType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'json'
} as const
export type ConfigValueType = (typeof ConfigValueType)[keyof typeof ConfigValueType]

// ─── 配置分组枚举 ────────────────────────────────────
export const ConfigGroup = {
  GENERAL: 'general',
  DOWNLOAD: 'download',
  SNIFFER: 'sniffer',
  APPEARANCE: 'appearance',
  SHORTCUT: 'shortcut',
  ADVANCED: 'advanced'
} as const
export type ConfigGroup = (typeof ConfigGroup)[keyof typeof ConfigGroup]

// ─── Zod 校验 Schemas ───────────────────────────────

// 基础 update schema，排除自动维护字段和系统标识
const baseUpdateSchema = createUpdateSchema(configs).omit({
  createdAt: true,
  updatedAt: true,
  isSystem: true
})

/** 更新配置：必须带 id，其他可选 */
export const configUpdateSchema = baseUpdateSchema.required({
  id: true
})

/** 创建配置：不带 id，key / value 必填 */
export const configCreateSchema = baseUpdateSchema.omit({ id: true }).required({
  key: true,
  value: true
})

/** 查询 schema */
export const configSelectSchema = createSelectSchema(configs)

/** 按 key 查询 schema */
export const configKeySchema = z.object({
  key: z.string().min(1)
})

/** 按 group 查询 schema */
export const configGroupSchema = z.object({
  group: z.string().min(1)
})

/** 批量设置配置 schema */
export const configBatchSetSchema = z.array(
  z.object({
    key: z.string().min(1),
    value: z.string(),
    group: z.string().optional(),
    valueType: z.enum(['string', 'number', 'boolean', 'json']).optional()
  })
)
