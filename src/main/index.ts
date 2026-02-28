import { app, shell, BrowserWindow, screen, protocol, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDb } from './db'
import { setupTRPC } from './trpc'
import log, { initLogger } from './logger'

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
      sandbox: false,
      webviewTag: true,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    log.info('Main window ready to show')
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const { url } = details
    if (url.startsWith('bitbrowser://') || url.startsWith('bytedance://') || url.startsWith('snssdk')) {
      log.info(`Blocked external protocol in main window: ${url}`)
      return { action: 'deny' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
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

// 在 app ready 之前注册需要拦截的自定义协议
const BLOCKED_PROTOCOLS = ['bitbrowser', 'bytedance', 'snssdk1128', 'snssdk1233', 'snssdk']

protocol.registerSchemesAsPrivileged(
  BLOCKED_PROTOCOLS.map((scheme) => ({
    scheme,
    privileges: { standard: false, secure: false, supportFetchAPI: false }
  }))
)

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
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
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 在协议层拦截自定义协议，防止 iframe / webview 等触发系统弹窗
  for (const scheme of BLOCKED_PROTOCOLS) {
    session.defaultSession.protocol.handle(scheme, (request) => {
      log.info(`Blocked protocol request: ${request.url}`)
      return new Response('', { status: 200 })
    })
  }

  createWindow()
  // Set up tRPC IPC handler
  setupTRPC()

  // 记录已注册过协议处理器的 session，避免重复注册
  const registeredSessions = new WeakSet<Electron.Session>()
  registeredSessions.add(session.defaultSession)

  const registerProtocolHandlers = (ses: Electron.Session): void => {
    if (registeredSessions.has(ses)) return
    registeredSessions.add(ses)
    for (const scheme of BLOCKED_PROTOCOLS) {
      try {
        ses.protocol.handle(scheme, (request) => {
          log.info(`Blocked protocol request (webview session): ${request.url}`)
          return new Response('', { status: 200 })
        })
      } catch (e) {
        log.warn(`Failed to register protocol handler for ${scheme}:`, e)
      }
    }
  }

  // 拦截 webview 的新窗口打开事件，并为 webview session 注册协议拦截
  app.on('web-contents-created', (_, contents) => {
    // 为每个 webContents 的 session 注册协议处理器（覆盖 webview 独立 session）
    registerProtocolHandlers(contents.session)

    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        // 检查是否是被拦截的协议
        const isBlocked = BLOCKED_PROTOCOLS.some((scheme) => url.startsWith(`${scheme}://`))
        if (isBlocked) {
          log.info(`Blocked protocol in webview window.open: ${url}`)
          return { action: 'deny' }
        }
        contents.loadURL(url)
        return { action: 'deny' }
      })
    }
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  log.info('App window-all-closed')
  if (process.platform !== 'darwin') {
    app.quit()
    log.info('App quit')
  }
})
