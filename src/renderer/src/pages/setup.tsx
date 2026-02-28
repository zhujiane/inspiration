import { Result, Button, Card } from 'antd'
import { SettingOutlined } from '@ant-design/icons'

export default function SetupPage() {
  return (
    <div
      style={{
        height: '100%',
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-layout)',
        overflow: 'auto'
      }}
    >
      <Card
        variant="borderless"
        style={{
          width: '100%',
          maxWidth: 600,
          textAlign: 'center',
          borderRadius: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          background: 'var(--color-bg-container)'
        }}
      >
        <Result
          icon={
            <div
              style={{
                width: 80,
                height: 80,
                background: 'rgba(22, 119, 255, 0.1)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px'
              }}
            >
              <SettingOutlined style={{ fontSize: 40, color: '#1677ff' }} />
            </div>
          }
          title={<span style={{ fontSize: 24, fontWeight: 600 }}>系统配置初始化</span>}
          subTitle={
            <div style={{ fontSize: 16, color: 'var(--color-text-description)', marginTop: 8 }}>
              该功能模块正在火热开发中，待开发...
            </div>
          }
          extra={
            <Button
              type="primary"
              size="large"
              style={{ borderRadius: 6, paddingInline: 32 }}
              onClick={() => {
                // If it's a tab, we might want to close it or just show a message
                // For now, satisfy the "placeholder" requirement
              }}
            >
              了解更多
            </Button>
          }
        />
      </Card>
    </div>
  )
}
