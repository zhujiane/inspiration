import { WifiOutlined, CloudOutlined, AppstoreOutlined } from '@ant-design/icons'

interface StatusBarProps {
  status?: 'connected' | 'disconnected' | 'loading'
  resourceCount?: number
  currentUrl?: string
  version?: string
}

export default function StatusBar({ status = 'connected', resourceCount = 0, currentUrl = '', version = 'v1.0.0' }: StatusBarProps): React.JSX.Element {
  const statusDotClass = status === 'connected' ? 'status-bar__dot' : status === 'loading' ? 'status-bar__dot status-bar__dot--warning' : 'status-bar__dot status-bar__dot--error'

  const statusLabel = status === 'connected' ? '已连接' : status === 'loading' ? '加载中' : '未连接'

  return (
    <footer className="status-bar" id="status-bar">
      <div className="status-bar__left">
        <span className="status-bar__item">
          <span className={statusDotClass} />
          <WifiOutlined style={{ fontSize: 11 }} />
          <span>{statusLabel}</span>
        </span>
        <span className="status-bar__item">
          <AppstoreOutlined style={{ fontSize: 11 }} />
          <span>资源: {resourceCount}</span>
        </span>
        {currentUrl && (
          <span className="status-bar__item" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={currentUrl}>
            <CloudOutlined style={{ fontSize: 11 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUrl}</span>
          </span>
        )}
      </div>
      <div className="status-bar__right">
        <span className="status-bar__item">{version}</span>
      </div>
    </footer>
  )
}
