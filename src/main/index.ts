import { app, BrowserWindow, screen, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDb } from './db'
import { setupTRPC } from './core/trpc'
import log, { initLogger } from './core/logger'
import { registerBlockedSchemes, setupWebContentPolicies } from './core/protocol'

function createWindow(): BrowserWindow {
  // Create the browser window.
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const mainWindow = new BrowserWindow({
    width: Math.floor(screenWidth * 0.8),
    height: Math.floor(screenHeight * 0.8),
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    log.info('Main window ready to show')
    mainWindow.show()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'right' })
  }

  return mainWindow
}

registerBlockedSchemes()

app.whenReady().then(async () => {
  initLogger()
  log.info('App starting...')
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron.app')

  // 初始化数据库
  try {
    await initDb()
    log.info('Database initialized successfully')
  } catch (error) {
    log.error('Failed to initialize database:', error)
    dialog.showErrorBox('数据库初始化失败', '应用无法启动，请检查日志后重试。')
    app.exit(1)
    return
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  setupWebContentPolicies(mainWindow)
  setupTRPC()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      const mainWindow = createWindow()
      setupWebContentPolicies(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  log.info('App window-all-closed')
  if (process.platform !== 'darwin') {
    app.quit()
    log.info('App quit')
  }
})
