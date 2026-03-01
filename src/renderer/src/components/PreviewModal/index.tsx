import { Modal } from 'antd'

export interface PreviewModalProps {
    open: boolean
    onCancel: () => void
    title?: string
    type?: 'video' | 'image' | 'audio' | string
    src?: string
    cover?: string
}

export default function PreviewModal({ open, onCancel, title, type, src, cover }: PreviewModalProps) {
    // Normalize type
    let mediaType = type
    if (type === '视频') mediaType = 'video'
    else if (type === '音频') mediaType = 'audio'
    else if (type === '图片') mediaType = 'image'

    const actualSrc = src ? src.replace(/\\/g, '/') : undefined

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
                    <video
                        src={actualSrc.startsWith('http') || actualSrc.startsWith('file://') ? actualSrc : `file:///${actualSrc}`}
                        controls
                        autoPlay
                        style={{ maxWidth: '100%', maxHeight: '70vh' }}
                    />
                )}
                {mediaType === 'audio' && actualSrc && (
                    <audio
                        src={actualSrc.startsWith('http') || actualSrc.startsWith('file://') ? actualSrc : `file:///${actualSrc}`}
                        controls
                        autoPlay
                        style={{ width: '80%' }}
                    />
                )}
                {mediaType === 'image' && (
                    <img
                        src={
                            cover ||
                            (actualSrc?.startsWith('http') || actualSrc?.startsWith('file://') ? actualSrc : `file:///${actualSrc}`)
                        }
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
