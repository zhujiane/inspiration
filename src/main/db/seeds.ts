import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sql } from 'drizzle-orm'
import { existsSync } from 'fs'
import { db } from './index'
import log from '../logger'

const toIdempotentInsert = (statement: string): string =>
  statement.replace(/^INSERT\s+INTO\s+/i, 'INSERT OR IGNORE INTO ')

const runSeedSqlList = async (label: string, statements: string[]): Promise<void> => {
  for (const statement of statements) {
    await db.run(sql.raw(toIdempotentInsert(statement)))
  }
  log.info(`${label} initialized (${statements.length} statements)`)
}

// 初始化数据库表（使用 drizzle-kit 迁移）
export async function initDb(): Promise<void> {
  try {
    // 迁移文件路径（兼容 dev/prod）
    const migrationsFolder = is.dev ? join(process.cwd(), 'src/main/migrations') : join(__dirname, 'migrations')
    log.info(`Running migrations from: ${migrationsFolder}`)

    // 检查迁移目录是否存在
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

      await runSeedSqlList('Default data', seedSql)
    }

    // 初始化系统默认配置
    const now = Math.floor(Date.now() / 1000)
    const existingConfig = await db.query.configs.findFirst()
    if (!existingConfig) {
      log.info('Initializing default configs...')
      const configSeeds = [
        // ── general 通用设置 ──
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-lang', ${now}, ${now}, 'general.language', 'zh-CN', 'string', 'general', '界面语言', '应用界面显示语言', 'zh-CN', 0, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-autostart', ${now}, ${now}, 'general.autoStart', 'false', 'boolean', 'general', '开机自启', '系统登录时自动启动应用', 'false', 1, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-minimize-tray', ${now}, ${now}, 'general.minimizeToTray', 'true', 'boolean', 'general', '最小化到托盘', '关闭窗口时最小化到系统托盘', 'true', 2, 1);`,

        // ── download 下载设置 ──
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-dl-path', ${now}, ${now}, 'download.path', '', 'string', 'download', '下载路径', '文件默认下载保存路径', '', 0, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-dl-concurrent', ${now}, ${now}, 'download.maxConcurrent', '3', 'number', 'download', '最大并发数', '同时下载文件的最大数量', '3', 1, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-dl-proxy', ${now}, ${now}, 'download.proxy', '', 'string', 'download', '代理地址', 'HTTP/SOCKS5 代理地址，留空则不使用代理', '', 2, 1);`,

        // ── sniffer 嗅探器设置 ──
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-sniff-auto', ${now}, ${now}, 'sniffer.autoSniff', 'true', 'boolean', 'sniffer', '自动嗅探', '浏览页面时自动嗅探媒体资源', 'true', 0, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-sniff-types', ${now}, ${now}, 'sniffer.mediaTypes', '["video","audio","image"]', 'json', 'sniffer', '嗅探类型', '需要嗅探的媒体资源类型', '["video","audio","image"]', 1, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-sniff-minsize', ${now}, ${now}, 'sniffer.minFileSize', '102400', 'number', 'sniffer', '最小文件大小', '过滤小于此大小（字节）的资源，默认 100KB', '102400', 2, 1);`,

        // ── appearance 外观设置 ──
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-theme', ${now}, ${now}, 'appearance.theme', 'light', 'string', 'appearance', '主题模式', '界面显示主题：light / dark / auto', 'light', 0, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-fontsize', ${now}, ${now}, 'appearance.fontSize', '12', 'number', 'appearance', '字体大小', '全局基础字体大小（px）', '12', 1, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-sidebar-w', ${now}, ${now}, 'appearance.sidebarWidth', '200', 'number', 'appearance', '侧边栏宽度', '左侧导航栏宽度（px）', '200', 2, 1);`,

        // ── advanced 高级设置 ──
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-hwaccel', ${now}, ${now}, 'advanced.hardwareAcceleration', 'true', 'boolean', 'advanced', '硬件加速', '启用 GPU 硬件加速渲染', 'true', 0, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-loglevel', ${now}, ${now}, 'advanced.logLevel', 'info', 'string', 'advanced', '日志级别', '应用日志级别：debug / info / warn / error', 'info', 1, 1);`,
        `INSERT INTO configs (code, created_at, updated_at, key, value, value_type, "group", label, description, default_value, "order", is_system) VALUES ('cfg-cache-size', ${now}, ${now}, 'advanced.cacheSize', '512', 'number', 'advanced', '缓存大小', '应用缓存上限（MB）', '512', 2, 1);`
      ]

      await runSeedSqlList('Default configs', configSeeds)
    }
  } catch (error) {
    log.error('Failed to initialize database:', error)
    throw error
  }
}
