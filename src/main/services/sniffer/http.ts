import https from 'https'
import http from 'http'
import { DEFAULT_USER_AGENT } from './constants'
import { flattenHeaders } from './utils'
import type { HeadResult } from '../../types/sniffer-types'

type RequestMethod = 'GET' | 'HEAD'

interface RedirectRequestOptions {
  method?: RequestMethod
  headers?: Record<string, string>
  timeout?: number
}

function parseContentRangeTotal(contentRange?: string): number {
  if (!contentRange) return 0
  const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+|\*)/i)
  if (!match || match[1] === '*') return 0
  const total = Number.parseInt(match[1], 10)
  return Number.isFinite(total) ? total : 0
}

function resolveContentLength(headers: Record<string, string>): number {
  const contentRangeTotal = parseContentRangeTotal(headers['content-range'])
  if (contentRangeTotal > 0) return contentRangeTotal

  const contentLength = Number.parseInt(headers['content-length'] || '0', 10)
  if (Number.isFinite(contentLength) && contentLength > 0) return contentLength
  return 0
}

export function requestWithRedirect(
  targetUrl: string,
  options: RedirectRequestOptions,
  redirectCount = 0
): Promise<{ response: http.IncomingMessage; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'))
      return
    }

    let nextUrl: URL
    try {
      nextUrl = new URL(targetUrl)
    } catch (error) {
      reject(error)
      return
    }

    const mod = nextUrl.protocol === 'https:' ? https : http
    const req = mod.request(
      nextUrl,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        timeout: options.timeout ?? 15_000
      },
      (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          response.resume()
          const redirectedUrl = new URL(location, nextUrl).toString()
          void requestWithRedirect(redirectedUrl, options, redirectCount + 1)
            .then(resolve)
            .catch(reject)
          return
        }

        if (statusCode >= 400) {
          response.resume()
          reject(new Error(`HTTP ${statusCode}`))
          return
        }

        resolve({ response, finalUrl: nextUrl.toString() })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'))
    })
    req.end()
  })
}

export function headRequest(url: string, extraHeaders?: Record<string, string>): Promise<HeadResult> {
  return new Promise((resolve) => {
    try {
      const reqHeaders: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        ...extraHeaders
      }

      void requestWithRedirect(url, { method: 'HEAD', headers: reqHeaders, timeout: 6_000 })
        .then(({ response, finalUrl }) => {
          response.resume()
          const flatHeaders = flattenHeaders(response.headers as Record<string, string | string[]>)
          resolve({
            contentType: flatHeaders['content-type'] || '',
            contentLength: resolveContentLength(flatHeaders),
            acceptRanges: response.headers['accept-ranges'] === 'bytes',
            etag: response.headers['etag'] as string | undefined,
            finalUrl,
            contentDisposition: response.headers['content-disposition'] as string | undefined
          })
        })
        .catch(() => resolve({ contentType: '', contentLength: 0, acceptRanges: false }))
    } catch {
      resolve({ contentType: '', contentLength: 0, acceptRanges: false })
    }
  })
}
