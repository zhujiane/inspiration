import { app, BrowserWindow, dialog } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import log from './logger'

export const initUpdater = (mainWindow: BrowserWindow): void => {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false

  if (is.dev) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('checking-for-update', () => {
    log.info('Updater: checking for updates')
  })

  autoUpdater.on('update-available', async (info) => {
    log.info('Updater: update available', info.version)

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `检测到新版本 ${info.version}。`,
      detail: '是否立即下载更新？下载完成后你可以选择现在安装或稍后安装。',
      buttons: ['立即下载', '稍后'],
      defaultId: 0,
      cancelId: 1
    })

    if (response !== 0) {
      log.info('Updater: user postponed update download', info.version)
      return
    }

    autoUpdater.downloadUpdate().catch((error: unknown) => {
      log.error('Updater: failed to download update', error)
    })
  })

  autoUpdater.on('update-not-available', () => {
    log.info('Updater: no update available')
  })

  autoUpdater.on('update-downloaded', async (info) => {
    log.info('Updater: update downloaded', info.version)

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已准备完成',
      message: `新版本 ${info.version} 已下载完成。`,
      detail: '选择“立即安装”将重启应用并开始安装更新。',
      buttons: ['立即安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    })

    if (response === 0) {
      log.info('Updater: quitting and installing update', info.version)
      autoUpdater.quitAndInstall()
    } else {
      log.info('Updater: user postponed update install', info.version)
    }
  })

  autoUpdater.on('error', (error) => {
    log.error('Updater: error', error)
  })

  if (app.isPackaged || is.dev) {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.error('Updater: failed to check for updates', error)
    })
  }
}
