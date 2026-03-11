import { useEffect, useState, type JSX, type SyntheticEvent } from 'react'
import { Tooltip } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CopyOutlined,
  PlayCircleOutlined,
  SoundOutlined,
  PictureOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'

export interface MediaResource {
  id: string
  type: 'image' | 'video' | 'audio'
  thumbnailUrl?: string
  title: string
  capturedAt?: number
  size?: string
  resolution?: string
  duration?: string
  url: string
  pageUrl?: string
  contentType?: string
  requestHeaders?: Record<string, string>
  selected?: boolean
  merged?: boolean
}

interface MediaCardProps {
  resource: MediaResource
  onSelect?: (id: string, selected: boolean) => void
  onDelete?: (id: string) => void
  onPreview?: (id: string) => void
  onDownload?: (id: string) => void
  onCopyUrl?: (id: string) => void
}

const typeIcons = {
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  audio: <SoundOutlined />
}

const typeLabels = {
  image: '图片',
  video: '视频',
  audio: '音频'
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function MediaCard({
  resource,
  onSelect,
  onDelete,
  onPreview,
  onDownload,
  onCopyUrl
}: MediaCardProps): JSX.Element {
  const [metaResolution, setMetaResolution] = useState(resource.resolution)
  const [metaDuration, setMetaDuration] = useState(resource.duration)
  const [videoCover, setVideoCover] = useState<string | undefined>(undefined)

  useEffect(() => {
    setMetaResolution(resource.resolution)
    setMetaDuration(resource.duration)
  }, [resource.id, resource.url, resource.resolution, resource.duration])

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setMetaResolution(`${video.videoWidth}×${video.videoHeight}`)
    }

    if (Number.isFinite(video.duration) && video.duration > 0) {
      setMetaDuration(formatDuration(video.duration))
    }
  }

  const cover = resource.type === 'image' ? resource.thumbnailUrl || resource.url : videoCover

  return (
    <>
      <div className={`media-card ${resource.selected ? 'media-card--selected' : ''}`} id={`media-card-${resource.id}`}>
        <div className="media-card__top-controls">
          <input
            type="checkbox"
            className="media-card__checkbox"
            checked={resource.selected || false}
            onChange={(e) => onSelect?.(resource.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`选择 ${resource.title}`}
          />
        </div>

        <div
          className="media-card__thumbnail"
          onClick={() => onPreview?.(resource.id)}
          style={{ position: 'relative' }}
        >
          {resource.type === 'image' ? (
            <img
              src={cover}
              alt={resource.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <>
              <video
                src={resource.url}
                preload="metadata"
                muted
                playsInline
                crossOrigin="anonymous"
                style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#f7f2f2' }}
                onLoadedMetadata={handleLoadedMetadata}
              />
              {resource.type === 'audio' && (
                <span className="media-card__thumbnail-placeholder media-card__thumbnail-placeholder--media">
                  <SoundOutlined />
                </span>
              )}
            </>
          )}

          {resource.type === 'video' && (
            <div className="media-card__thumbnail-overlay">
              <PlayCircleOutlined />
            </div>
          )}

          <span className={`media-card__type-badge media-card__type-badge--${resource.type}`}>
            {typeIcons[resource.type]}
            <span>{typeLabels[resource.type]}</span>
          </span>

          {resource.merged ? (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 50,
                borderRadius: 4,
                padding: '2px 8px',
                background: 'rgba(144, 154, 138, 0.92)',
                color: '#fff',
                fontSize: 9,
                fontWeight: 500
              }}
            >
              已合并
            </span>
          ) : null}

          <div className="media-card__overlay-info">
            <span className="media-card__overlay-text" title={resource.title}>
              {resource.title}
            </span>
            <span className="media-card__overlay-text media-card__overlay-text--dim">
              {[resource.size, metaResolution, metaDuration].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>

        <div className="media-card__actions">
          <Tooltip title="预览" mouseEnterDelay={0.5}>
            <button className="media-card__action-btn" onClick={() => onPreview?.(resource.id)} aria-label="预览">
              <EyeOutlined />
            </button>
          </Tooltip>
          <Tooltip title="下载" mouseEnterDelay={0.5}>
            <button className="media-card__action-btn" onClick={() => onDownload?.(resource.id)} aria-label="下载">
              <DownloadOutlined />
            </button>
          </Tooltip>
          <Tooltip title="复制链接" mouseEnterDelay={0.5}>
            <button className="media-card__action-btn" onClick={() => onCopyUrl?.(resource.id)} aria-label="复制链接">
              <CopyOutlined />
            </button>
          </Tooltip>
          <Tooltip title="删除" mouseEnterDelay={0.5}>
            <button
              className="media-card__action-btn media-card__action-btn--danger"
              onClick={(e) => {
                e.stopPropagation()
                onDelete?.(resource.id)
              }}
              aria-label={`删除 ${resource.title}`}
            >
              <DeleteOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
      <style>{`
      .media-card__thumbnail-placeholder--media {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255,255,255,0.9);
        font-size: 24px;
        pointer-events: none;
      }
      .media-card__thumbnail-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.3);
        color: #fff;
        font-size: 24px;
        opacity: 0;
        transition: opacity 0.2s;
        border-radius: inherit;
        pointer-events: none;
      }
      .media-card__thumbnail:hover .media-card__thumbnail-overlay {
        opacity: 1;
      }
    `}</style>
    </>
  )
}
