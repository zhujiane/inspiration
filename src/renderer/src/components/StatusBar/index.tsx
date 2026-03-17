import { CloudOutlined, AppstoreOutlined } from '@ant-design/icons'

interface StatusBarProps {
  status?: 'connected' | 'disconnected' | 'loading'
  resourceCount?: number
  currentUrl?: string
  version?: string
}

export default function StatusBar({
  resourceCount = 0,
  currentUrl = '',
  version = __APP_VERSION__
}: StatusBarProps): React.JSX.Element {
  return (
    <footer className="status-bar" id="status-bar">
      <div className="status-bar__left">
        <span className="status-bar__item">
          <AppstoreOutlined style={{ fontSize: 11 }} />
          <span>资源: {resourceCount}</span>
        </span>
        {currentUrl && (
          <span
            className="status-bar__item"
            style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={currentUrl}
          >
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
