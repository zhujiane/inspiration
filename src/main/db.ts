import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as schema from '@shared/db/index'
import { and, eq, or } from 'drizzle-orm'

// 根据环境选择数据库路径
// dev: 使用项目根目录
// prod: 使用用户数据目录
export const getDbPath = (): string => {
  return join(app.getPath('userData'), 'db.sqlite')
}

// 创建 better-sqlite3 数据库实例
const sqlite = new Database(getDbPath())

// 创建 drizzle 实例
export const db = drizzle(sqlite, {
  schema,
  logger: is.dev
    ? {
        logQuery(query, params) {
          console.log('[Drizzle SQL]', query, params)
        }
      }
    : false
})
// 初始化数据库表（使用 drizzle-kit 迁移）
export async function initDb(): Promise<void> {
  try {
    // 迁移文件路径（兼容 dev/prod）
    const migrationsFolder = is.dev ? join(process.cwd(), 'src/main/migrations') : join(__dirname, 'migrations')

    // 执行迁移
    await migrate(db, { migrationsFolder })
    console.log('Database initialized successfully')

    // 初始化默认应用组
    // 1. 创建父级“应用”组
    let appGroup = await db.query.bookmarks.findFirst({
      where: and(eq(schema.bookmarks.name, '应用'), eq(schema.bookmarks.type, 1), eq(schema.bookmarks.isDefault, 1))
    })

    if (!appGroup) {
      const [inserted] = await db
        .insert(schema.bookmarks)
        .values({
          name: '应用',
          type: 1,
          isDefault: 1,
          order: 0,
          icon: '#1890ff'
        })
        .returning()
      appGroup = inserted
    }

    // 2. 创建子项功能
    const defaultApps = [
      { name: '素材管理', type: 3, isDefault: 1, parentId: appGroup.id, order: 0, icon: 'AppstoreOutlined' },
      { name: '系统配置', type: 3, isDefault: 1, parentId: appGroup.id, order: 1, icon: 'AppstoreOutlined' }
    ]

    for (const appItem of defaultApps) {
      const existing = await db.query.bookmarks.findFirst({
        where: and(
          eq(schema.bookmarks.name, appItem.name),
          eq(schema.bookmarks.type, 3),
          eq(schema.bookmarks.isDefault, 1),
          eq(schema.bookmarks.parentId, appGroup.id)
        )
      })

      if (!existing) {
        await db.insert(schema.bookmarks).values(appItem)
        console.log(`Created default app: ${appItem.name}`)
      }
    }

    // 3. 清理之前错误创建的同名顶级组（如果存在）
    await db
      .delete(schema.bookmarks)
      .where(
        and(
          eq(schema.bookmarks.type, 1),
          eq(schema.bookmarks.isDefault, 1),
          eq(schema.bookmarks.parentId, 0),
          or(eq(schema.bookmarks.name, '素材管理'), eq(schema.bookmarks.name, '系统配置'))
        )
      )
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}
