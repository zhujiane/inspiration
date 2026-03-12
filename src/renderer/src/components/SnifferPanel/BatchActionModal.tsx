import { SoundOutlined } from '@ant-design/icons'
import { Button, Modal, Progress } from 'antd'

export type BatchActionItemStatus = 'pending' | 'processing' | 'success' | 'error'
export type BatchActionItemType = 'image' | 'video' | 'audio'

export interface BatchActionItem {
  id: string
  title: string
  type?: BatchActionItemType
  coverUrl?: string
  metrics?: string[]
  progress: number
  status: BatchActionItemStatus
  statusText?: string
  errorMessage?: string
}

interface BatchActionModalProps {
  title: string
  open: boolean
  items: BatchActionItem[]
  confirmText: string
  confirmLoading?: boolean
  confirmDisabled?: boolean
  emptyText?: string
  onCancel: () => void
  onConfirm: () => void
}

const statusLabelMap: Record<BatchActionItemStatus, string> = {
  pending: '待执行',
  processing: '进行中',
  success: '已完成',
  error: '失败'
}

const statusColorMap: Record<BatchActionItemStatus, string> = {
  pending: 'var(--color-text-tertiary)',
  processing: 'var(--color-primary)',
  success: 'var(--color-success)',
  error: 'var(--color-danger)'
}

export default function BatchActionModal({
  title,
  open,
  items,
  confirmText,
  confirmLoading,
  confirmDisabled,
  emptyText = '暂无任务',
  onCancel,
  onConfirm
}: BatchActionModalProps): React.JSX.Element {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      width={760}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={confirmLoading}>
          关闭
        </Button>,
        <Button key="confirm" type="primary" onClick={onConfirm} loading={confirmLoading} disabled={confirmDisabled}>
          {confirmText}
        </Button>
      ]}
    >
      {items.length === 0 ? (
        <div
          style={{
            padding: '32px 0',
            textAlign: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 13
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 520, overflowY: 'auto' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: 12,
                padding: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-bg-elevated)'
              }}
            >
              <div
                style={{
                  width: 120,
                  height: 68,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: 'var(--color-fill-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : item.type === 'audio' ? (
                  <span
                    aria-label="音频"
                    style={{
                      color: 'var(--color-text-tertiary)',
                      fontSize: 24,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <SoundOutlined />
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>无封面</span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div
                    title={item.title}
                    style={{
                      fontWeight: 500,
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.title}
                  </div>
                  <span style={{ color: statusColorMap[item.status], fontSize: 12, flexShrink: 0 }}>
                    {item.statusText || statusLabelMap[item.status]}
                  </span>
                </div>

                {item.metrics && item.metrics.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {item.metrics.map((metric) => (
                      <span
                        key={metric}
                        style={{
                          fontSize: 12,
                          color: 'var(--color-text-secondary)',
                          background: 'var(--color-fill-quaternary)',
                          borderRadius: 999,
                          padding: '2px 8px'
                        }}
                      >
                        {metric}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Progress percent={item.progress} size="small" style={{ flex: 1, margin: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 42 }}>
                    {item.progress}%
                  </span>
                </div>

                {item.errorMessage ? (
                  <div style={{ fontSize: 12, color: 'var(--color-danger)' }}>{item.errorMessage}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
