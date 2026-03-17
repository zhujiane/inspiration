import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync, cpSync } from 'fs'
import pkg from './package.json'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      {
        name: 'copy-migrations',
        apply: 'build',
        closeBundle() {
          const src = resolve(__dirname, 'src/main/db/migrations')
          const dist = resolve(__dirname, 'out/main/db/migrations')
          if (existsSync(src)) {
            cpSync(src, dist, { recursive: true })
          }
        }
      }
    ],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(`v${pkg.version}`)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    plugins: [react()]
  }
})
