import { app, shell, protocol, session, BrowserWindow } from 'electron'
import log from './logger'

const BLOCKED_PROTOCOLS = ['bitbrowser', 'bytedance', 'snssdk1128', 'snssdk1233', 'snssdk']

const isBlockedProtocolUrl = (url: string): boolean => BLOCKED_PROTOCOLS.some((scheme) => url.startsWith(`${scheme}:`))

const isSafeExternalUrl = (url: string): boolean => {
  try {
    const protocolName = new URL(url).protocol
    return protocolName === 'http:' || protocolName === 'https:'
  } catch {
    return false
  }
}

const registerBlockedProtocolHandlers = (ses: Electron.Session, scope: string): void => {
  for (const scheme of BLOCKED_PROTOCOLS) {
    try {
      ses.protocol.handle(scheme, (request) => {
        log.info(`Blocked protocol request (${scope}): ${request.url}`)
        return new Response('', { status: 200 })
      })
    } catch (error) {
      log.warn(`Failed to register protocol handler for ${scheme} (${scope}):`, error)
    }
  }
}

export const registerBlockedSchemes = (): void => {
  protocol.registerSchemesAsPrivileged(
    BLOCKED_PROTOCOLS.map((scheme) => ({
      scheme,
      privileges: { standard: false, secure: false, supportFetchAPI: false }
    }))
  )
}

export const setupWebContentPolicies = (mainWindow: BrowserWindow): void => {
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isBlockedProtocolUrl(url)) {
      log.info(`Blocked external protocol in main window: ${url}`)
      return { action: 'deny' }
    }

    if (!isSafeExternalUrl(url)) {
      log.info(`Blocked unsafe external URL in main window: ${url}`)
      return { action: 'deny' }
    }

    shell.openExternal(url)
    return { action: 'deny' }
  })

  registerBlockedProtocolHandlers(session.defaultSession, 'default')

  const registeredSessions = new WeakSet<Electron.Session>()
  registeredSessions.add(session.defaultSession)

  const registerProtocolHandlers = (ses: Electron.Session): void => {
    if (registeredSessions.has(ses)) return
    registeredSessions.add(ses)
    registerBlockedProtocolHandlers(ses, 'webview-session')
  }

  app.on('web-contents-created', (_, contents) => {
    registerProtocolHandlers(contents.session)

    if (contents.getType() !== 'webview') return

    contents.setWindowOpenHandler(({ url }) => {
      if (isBlockedProtocolUrl(url)) {
        log.info(`Blocked protocol in webview window.open: ${url}`)
        return { action: 'deny' }
      }

      if (!isSafeExternalUrl(url)) {
        log.info(`Blocked unsafe URL in webview window.open: ${url}`)
        return { action: 'deny' }
      }

      contents.loadURL(url)
      return { action: 'deny' }
    })
  })
}
