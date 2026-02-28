import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sql } from 'drizzle-orm'
import { db } from './index'
import log from '../logger'

// 初始化数据库表（使用 drizzle-kit 迁移）
export async function initDb(): Promise<void> {
  try {
    // 迁移文件路径（兼容 dev/prod）
    const migrationsFolder = is.dev ? join(process.cwd(), 'src/main/migrations') : join(__dirname, 'migrations')
    log.info(`Running migrations from: ${migrationsFolder}`)

    // 检查迁移目录是否存在
    const { existsSync } = await import('fs')
    if (!existsSync(migrationsFolder)) {
      log.error(`Migrations folder not found: ${migrationsFolder}`)
      throw new Error(`Migrations folder not found: ${migrationsFolder}`)
    }

    // 执行迁移
    await migrate(db, { migrationsFolder })
    log.info('Migrations completed')

    // 检查是否已经初始化过数据
    const existingCount = await db.query.bookmarks.findFirst()
    if (!existingCount) {
      log.info('Initializing default data...')
      const seedSql = [
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (1, '255dd68f-84c2-42bc-a4a6-8b6f9ef9e533', 1770951216, 1770951216, '应用', 0, 0, 1, null, null, null, 0, null, '#1890ff', 1);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (2, 'ec859472-357d-445f-a7ac-dc689adac466', 1770951220, 1770951220, '素材管理', 1, 1, 3, null, null, null, 0, null, 'VideoCameraOutlined', 1);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (3, 'e1cc1e20-a7e1-4520-b8c6-d39b1d518b2a', 1770951222, 1770951222, '系统配置', 2, 1, 3, null, null, null, 0, null, 'SettingOutlined', 1);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (4, '103c442e-17a0-422a-9e31-450b4e85a967', 1770963559, 1770963559, '视频平台', 1, 0, 1, null, null, null, 0, null, '#faad14', 0);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (6, 'e94cd6af-ebf8-4ee1-840f-7d06d58ae12b', 1770963745, 1770963745, '哔哩哔哩', 0, 4, 2, 'https://www.bilibili.com/', null, 'default', 0, null, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAFVBMVEUAodZHcEwAodYAodYAodYAodYAodZpZuTXAAAAB3RSTlP/ACOU32IrDrMBJwAAAE9JREFUGJVtjlEOwDAIQkHb3v/Is9Rkq44PIy8EBclplGzGALkAEQOWAF0kvCsR9pUTl4dsVmZNiB8lGGObPROc1Nn+E62jgHK2PdZeZ9EDiRAA6SOYpwEAAAAASUVORK5CYII=', 0);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (7, '9fd1af35-9977-4d3f-8e92-14830c9f795d', 1770964500, 1770964500, '自媒体工具', 2, 0, 1, null, null, null, 0, null, '#faad14', 0);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (8, 'bbd3f481-70c1-4b60-8d76-1efadd09ed69', 1770964805, 1770964805, '小红书', 0, 4, 2, 'https://www.xiaohongshu.com/explore?channel_id=homefeed.fashion_v3', null, 'default', 0, null, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAMFBMVEX/J0H/J0H/J0H/Hjv/DTL/Q1n/t73/dYP/2d3/Y3P/8/X//P3/hI//m6T/zNH/pq57ypFWAAAAAnRSTlPvOId3moUAAABySURBVBiVfc9JDsNACARADM062/9/m/GcEssKByRKSNB0EX8VXfQzb3nMW94AzCIsdzuABUlX5e7QDcqNOdxaVk0DYXqNFcGhMZsKIbTczA6M2humjYf5qlwjNzCyQy1tdc/uQuckQwC56/2xv2GInvE/GXkEBxy/5P0AAAAASUVORK5CYII=', 0);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (9, '0f5117e8-a90c-4214-9011-74e4af980fc0', 1770965676, 1770965676, 'AI对话', 3, 0, 1, null, null, null, 0, '', '#13c2c2', 0);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (10, '05153d19-1541-4364-aa5a-bbdd3af289cb', 1770965777, 1770965777, 'chatgpt', 0, 9, 2, 'https://chatgpt.com', null, 'default', 0, null, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABfUlEQVQ4ja3TPUiXURgF8N9rQQZ9SgmF0JAFgllB/fGDMAxpECGiIVqkoYIEIRpaguaWliDChkQcTGhKsZSioGwosqE1KoOUoCIdlMhquM8bL3/ERZ/p3ufeezjPOeeywsqW6K3FMRyN/RO8iPU8/i4HkKEHTRhBFc7jPRYwjTt4lz9YUwZwCGdwGYvowEfcxSg24CJe41sRIMMpXMcrzOEqBjCGE2jAPWzBPjyDigBoQRdexpw1QXsXBuPODG7gAHbmlHOATtwviPUb7diBB9iNT7iGrwGwtTjCSUxiHfZjNgS7gnGUcAHbg8WeWL/JGUzieIjzJ4TKz0TvlmRhCY9wsMjgA86iHrfxFkdwGG0h8MMAncVGbMZ4DrCAVmyTQvQDv0Kbp/gZI21CHRola6eKNL/ECJdQHXRPYwq1+Iz18bgfz5XVXgyjW/K8Hb3ok5JZgyEpbP+rPMr1OCfZVynZ14vvUioncFPhPyz1mbKgCs2SiFlo8VjKyOrVP+YNUzrWZGSLAAAAAElFTkSuQmCC', 0);",
        "INSERT INTO bookmarks (id, code, created_at, updated_at, name, \"order\", parent_id, type, url, storage, userDataPath, status, description, icon, isDefault) VALUES (15, 'f6569d03-a496-4911-822e-7a78d6fe55b2', 1770965920, 1770965920, '即梦', 0, 7, 2, 'https://jimeng.jianying.com/', null, null, 0, '', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAABCFBMVEUHBBkbEVcBAAEOCSw6J6c4JZ8dE1sPCi0dE1suH4Y/KbULBiUJBB4DAQwUDEEFAhYXDkoQCjUlF20aEFECA0IMAFc5JqgTCT0sHIEGACkxH441I5sHBDWP0Pp0kNC94+bg+vuA3/4pQWctVpojPIGIrMMNAEhJyf8TeMk0OFZo3///+dlgmLvJr3ac+f8ljdzU9fm+9/9xcIC52cc8gcQdF2VFY2k3F7Q7ObYNGClPgIyU38oxar8hK6WEwu8jAqEPFjI0FpTz/+y63H6C0ugAEWe19OiDyt0LMmxmuv/XkDTAy2PK6te7+9Y03/tfv+NopbVZr/zY6eFBZ3eq5f3b4Zaoxc3i3tFlKI0CAAAACnRSTlPE////wwj/CMTDJScH/AAAAOhJREFUGJUdj+VywzAQBs9S67SWLNkysx1mLkMKSZnx/d+kUr9/uzezMwe1HV3X5ByL2ZhADRQ39z3FhHIOoEuxd9Jryzvlpmkqobvn116KiWSEQBXc1s2jx7lEKVQuHc6ev+d36UX9CIFjWSwaTqt++ZRl2SkCxgIbvZbVcvI1m+YuAlvW3ap8/+z9fOSRyQFjgibj3/lbUdxvMKFACOp2xotiMRrkbSvAQMxGp7++fVk+DBpCaAwoxcd112t2R1dncSg0KUgUaCK8XLUO/SQWABQHjggT3zgwDD/Zlf9ipoexb/xva/sPxFsZnF/rsK0AAAAASUVORK5CYII=', 0);"
      ]

      for (const sqlStr of seedSql) {
        // 使用 sql.raw 来执行原始 SQL，因为它不带占位符
        try {
          await db.run(sql.raw(sqlStr))
        } catch (e) {
          log.warn(`Execute seed sql failed: ${sqlStr}`, e)
        }
      }
      log.info('Default data initialized')
    }
  } catch (error) {
    log.error('Failed to initialize database:', error)
    throw error
  }
}
