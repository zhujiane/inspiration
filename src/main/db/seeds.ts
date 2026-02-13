import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import * as schema from '@shared/db/index'
import { db } from './index'

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
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}
