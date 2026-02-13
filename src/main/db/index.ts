import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as schema from '@shared/db/index'
import log from '../logger'

// 根据环境选择数据库路径
// dev: 使用项目根目录
// prod: 使用用户数据目录
export const getDbPath = (): string => {
  const dbPath = is.dev ? join(process.cwd(), './out/db.sqlite') : join(app.getPath('userData'), 'db.sqlite')
  log.info(`Database path: ${dbPath}`)
  return dbPath
}

// 创建 better-sqlite3 数据库实例
const sqlite = new Database(getDbPath())

// 创建 drizzle 实例
export const db = drizzle(sqlite, {
  schema,
  logger: {
    logQuery(query, params) {
      log.debug('[SQL]', query, params)
    }
  }
})

export * from './seeds'
