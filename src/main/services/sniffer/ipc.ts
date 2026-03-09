import { ipcMain } from 'electron'
import { handleDomUrls } from './interception'

let registered = false

export function registerSnifferIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('sniffer:scan-urls', async (_event, { partition, urls }: { partition: string; urls: string[] }) => {
    handleDomUrls(partition, urls || [])
  })
}
