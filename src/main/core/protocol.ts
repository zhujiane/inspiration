import { app, shell, protocol, session, BrowserWindow } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'
import { fileURLToPath } from 'url'
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

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

const parseRangeHeader = (rangeHeader: string | null, fileSize: number): { start: number; end: number } | null => {
  if (!rangeHeader) return null
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/i)
  if (!match) return null

  const [, startText, endText] = match
  let start = startText ? Number.parseInt(startText, 10) : 0
  let end = endText ? Number.parseInt(endText, 10) : fileSize - 1

  if (Number.isNaN(start) || Number.isNaN(end)) return null

  if (!startText && endText) {
    const suffixLength = Number.parseInt(endText, 10)
    if (Number.isNaN(suffixLength) || suffixLength <= 0) return null
    start = Math.max(fileSize - suffixLength, 0)
    end = fileSize - 1
  }

  if (start < 0 || end < start || start >= fileSize) return null
  end = Math.min(end, fileSize - 1)
  return { start, end }
}

const getMediaContentType = (filePath: string): string =>
  MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'

const createLocalFileResponse = async (target: string, request: GlobalRequest): Promise<Response> => {
  const filePath = target.startsWith('file:') ? fileURLToPath(target) : target
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) return new Response('Not found', { status: 404 })

  const contentType = getMediaContentType(filePath)
  const range = parseRangeHeader(request.headers.get('range'), stat.size)

  if (range) {
    const { start, end } = range
    const stream = createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream) as BodyInit, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`
      }
    })
  }

  const stream = createReadStream(filePath)
  return new Response(Readable.toWeb(stream) as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(stat.size)
    }
  })
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
  protocol.registerSchemesAsPrivileged([
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
  ])
}

export const setupWebContentPolicies = (mainWindow: BrowserWindow): void => {
  try {
    protocol.handle(SNIFFER_MEDIA_SCHEME, (request) => {
      const requestUrl = new URL(request.url)
      const target = requestUrl.searchParams.get('url')
      if (!target) return new Response('Missing media url', { status: 400 })

      if (target.startsWith('file:') || /^[A-Za-z]:[\\/]/.test(target)) {
        return createLocalFileResponse(target, request).catch((error) => {
          log.warn(`Failed to serve local preview file: ${target}`, error)
          return new Response('Failed to load local media', { status: 500 })
        })
      }

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
