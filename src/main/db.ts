import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as schema from '@shared/db/resource-schema'

// 根据环境选择数据库路径
// dev: 使用项目根目录
// prod: 使用用户数据目录
const getDbPath = (): string => {
  if (is.dev) {
    // 开发环境：使用项目根目录下的 db.sqlite
    return join(process.cwd(), 'db.sqlite')
  } else {
    // 生产环境：使用应用数据目录
    return join(app.getPath('userData'), 'db.sqlite')
  }
}

const dbPath = getDbPath()

// 创建 better-sqlite3 数据库实例
const sqlite = new Database(dbPath)

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
    const migrationsFolder = is.dev
      ? join(process.cwd(), 'src/main/migrations')
      : join(__dirname, 'migrations')

    // 执行迁移
    await migrate(db, { migrationsFolder })
    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}
