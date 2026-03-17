import type { Tab } from './types'

const URL_INPUT_PATTERN =
  /^(https?:\/\/)|(localhost)|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})/

export function isWebviewTab(tab?: Pick<Tab, 'type'> | null): boolean {
  return !tab || !tab.type || tab.type === 'webview'
}

export function getTabPartition(tab?: Pick<Tab, 'userDataPath'> | null): string {
  return tab?.userDataPath ? `persist:${tab.userDataPath}` : 'persist:default'
}

export function formatUrlInput(input: string): string {
  if (!input) return ''

  if (URL_INPUT_PATTERN.test(input)) {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return input
    }
    return `https://${input}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}
