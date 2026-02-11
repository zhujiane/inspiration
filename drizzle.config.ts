import { defineConfig } from 'drizzle-kit'
import { join } from 'path'

// drizzle-kit 配置
// 注意：迁移生成时使用开发环境的数据库路径
const getDbPath = (): string => {
  // 迁移生成时统一使用项目根目录
  return join(process.cwd(), './out/db.sqlite')
}

export default defineConfig({
  schema: './src/shared/db/*.ts',
  out: './src/main/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${getDbPath()}`
  }
})
