import { Modal } from 'antd'
import { buildPreviewProxyUrl, normalizeMediaSrc } from '../../lib/media'

export interface PreviewModalProps {
  open: boolean
  onCancel: () => void
  title?: string
  type?: 'video' | 'image' | 'audio' | string
  src?: string
  cover?: string
  requestHeaders?: Record<string, string>
}

export default function PreviewModal({ open, onCancel, title, type, src, cover, requestHeaders }: PreviewModalProps) {
  // Normalize type
  let mediaType = type
  if (type === '视频') mediaType = 'video'
  else if (type === '音频') mediaType = 'audio'
  else if (type === '图片') mediaType = 'image'

  const actualSrc = normalizeMediaSrc(src)
  const previewSrc = buildPreviewProxyUrl(src, requestHeaders)
  const previewCover = buildPreviewProxyUrl(cover, requestHeaders)

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={800}
      centered
      destroyOnHidden
      styles={{ body: { padding: 0, backgroundColor: '#000', borderRadius: '0 0 8px 8px' } }}
    >
      <div
        style={{
          minHeight: 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000'
        }}
      >
        {mediaType === 'video' && actualSrc && (
          <video src={previewSrc} controls autoPlay style={{ maxWidth: '100%', maxHeight: '70vh' }} />
        )}
        {mediaType === 'audio' && actualSrc && <audio src={previewSrc} controls autoPlay style={{ width: '80%' }} />}
        {mediaType === 'image' && (
          <img
            src={previewCover || previewSrc}
            alt={title}
            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
          />
        )}
        {mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'image' && (
          <div style={{ color: '#fff' }}>该格式暂不支持预览</div>
        )}
      </div>
    </Modal>
  )
}
