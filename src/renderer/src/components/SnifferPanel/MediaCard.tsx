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
  size?: string
  resolution?: string
  duration?: string
  url: string
  selected?: boolean
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

export default function MediaCard({
  resource,
  onSelect,
  onDelete,
  onPreview,
  onDownload,
  onCopyUrl
}: MediaCardProps): React.JSX.Element {
  return (
    <div className={`media-card ${resource.selected ? 'media-card--selected' : ''}`} id={`media-card-${resource.id}`}>
      {/* 4.4 Top — Checkbox only (always visible) */}
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

      {/* 4.2 Thumbnail */}
      <div className="media-card__thumbnail" onClick={() => onPreview?.(resource.id)}>
        {resource.thumbnailUrl ? (
          <img src={resource.thumbnailUrl} alt={resource.title} loading="lazy" />
        ) : (
          <span className="media-card__thumbnail-placeholder">
            {resource.type === 'video' ? (
              <PlayCircleOutlined />
            ) : resource.type === 'audio' ? (
              <SoundOutlined />
            ) : (
              <PictureOutlined />
            )}
          </span>
        )}

        {/* Type badge */}
        <span className={`media-card__type-badge media-card__type-badge--${resource.type}`}>
          {typeIcons[resource.type]}
          <span>{typeLabels[resource.type]}</span>
        </span>

        {/* 4.5 Overlay info */}
        <div className="media-card__overlay-info">
          <span className="media-card__overlay-text" title={resource.title}>
            {resource.title}
          </span>
          <span className="media-card__overlay-text media-card__overlay-text--dim">
            {[resource.size, resource.resolution, resource.duration].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      {/* 4.3 Bottom Actions — includes delete */}
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
  )
}
