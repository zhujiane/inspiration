import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as schema from '@shared/db/index'

// 根据环境选择数据库路径
// dev: 使用项目根目录
// prod: 使用用户数据目录
export const getDbPath = (): string => {
  return is.dev ? join(process.cwd(), './out/db.sqlite') : join(app.getPath('userData'), 'db.sqlite')
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

export * from './seeds'
