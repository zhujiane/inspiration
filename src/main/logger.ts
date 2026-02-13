import log from 'electron-log'
import { app } from 'electron'

// 配置 electron-log
log.transports.file.level = 'info'
log.transports.console.level = 'debug'

// 设置日志文件路径
// 默认路径: 
// Windows: %USERDATA%\AppData\Roaming\<app name>\logs\main.log
// log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs/main.log')

// 配置日志格式
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}'

// 设置日志文件大小限制 (5MB)
log.transports.file.maxSize = 5 * 1024 * 1024

// 导出 logger
export default log

// 接管 console 打印 (可选)
Object.assign(console, log.functions)

export const initLogger = () => {
  log.info('Logger initialized')
  log.info(`App Version: ${app.getVersion()}`)
  log.info(`Platform: ${process.platform}`)
  log.info(`Arch: ${process.arch}`)
  log.info(`Log file: ${log.transports.file.getFile().path}`)
}
