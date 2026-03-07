import { app, shell, protocol, session, BrowserWindow } from 'electron'
import log from './logger'

const BLOCKED_PROTOCOLS = ['bitbrowser', 'bytedance', 'snssdk1128', 'snssdk1233', 'snssdk']
const SNIFFER_MEDIA_SCHEME = 'sniffer-media'

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
    [
      ...BLOCKED_PROTOCOLS.map((scheme) => ({
        scheme,
        privileges: { standard: false, secure: false, supportFetchAPI: false }
      })),
      {
        scheme: SNIFFER_MEDIA_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          corsEnabled: true
        }
      }
    ]
  )
}

export const setupWebContentPolicies = (mainWindow: BrowserWindow): void => {
  try {
    protocol.handle(SNIFFER_MEDIA_SCHEME, (request) => {
      const requestUrl = new URL(request.url)
      const target = requestUrl.searchParams.get('url')
      if (!target) return new Response('Missing media url', { status: 400 })

      const headerParam = requestUrl.searchParams.get('headers')
      let forwardedHeaders: Record<string, string> = {}
      if (headerParam) {
        try {
          forwardedHeaders = JSON.parse(decodeURIComponent(headerParam)) as Record<string, string>
        } catch (error) {
          log.warn('Failed to parse sniffer preview headers:', error)
        }
      }

      const range = request.headers.get('range')
      if (range) forwardedHeaders.Range = range

      return fetch(target, {
        method: request.method,
        headers: forwardedHeaders
      })
    })
  } catch (error) {
    log.warn('Failed to register sniffer media protocol handler:', error)
  }

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
