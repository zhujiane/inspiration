import { GlobalOutlined } from '@ant-design/icons'

interface MainContentProps {
  url?: string
  loading?: boolean
}

export default function MainContent({ url, loading }: MainContentProps): React.JSX.Element {
  return (
    <main className="main-content" id="main-content">
      <div className="main-content__webview-container">
        {url ? (
          <>
            {/* In Electron, replace with <webview> tag */}
            <div className="main-content__placeholder" style={{ background: '#fff' }}>
              <GlobalOutlined className="main-content__placeholder-icon" style={{ fontSize: 48, opacity: loading ? 0.6 : 0.2 }} />
              <div className="main-content__placeholder-text">{loading ? '加载中...' : url}</div>
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(0,0,0,0.25)',
                  marginTop: 4
                }}
              >
                Electron webview 将嵌入第三方网页
              </div>
            </div>
          </>
        ) : (
          <div className="main-content__placeholder">
            <GlobalOutlined className="main-content__placeholder-icon" />
            <div className="main-content__placeholder-text">选择左侧导航或输入网址开始浏览</div>
          </div>
        )}
      </div>
    </main>
  )
}
