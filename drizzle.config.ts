import { defineConfig } from 'drizzle-kit'
import { join } from 'path'
import {app} from 'electron'

const getDbPath = (): string => {
  return join(app.getPath('userData'), 'db.sqlite')
}

export default defineConfig({
  schema: './src/shared/db/*.ts',
  out: './src/main/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${getDbPath()}`
  }
})
