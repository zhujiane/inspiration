import { useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import { Progress, Tooltip } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CopyOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  SoundOutlined,
  PictureOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { formatDuration } from '@shared/utils/format'
import { buildPreviewProxyUrl } from '../../lib/media'
import SmartVideo, { type SmartVideoMetadata } from '../Media/SmartVideo'

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
  downloaded?: boolean
  downloadProgress?: number
  downloadStatus?: 'idle' | 'pending' | 'processing' | 'success' | 'error'
  downloadStatusText?: string
}

interface MediaCardProps {
  resource: MediaResource
  onSelect?: (id: string, selected: boolean) => void
  onDelete?: (id: string) => void
  onPreview?: (id: string) => void
  onDownload?: (id: string) => void
  onCopyUrl?: (id: string) => void
  onMetadataChange?: (
    id: string,
    metadata: Partial<Pick<MediaResource, 'type' | 'resolution' | 'duration' | 'thumbnailUrl'>>
  ) => void
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
  onCopyUrl,
  onMetadataChange
}: MediaCardProps): JSX.Element {
  const [displayType, setDisplayType] = useState<MediaResource['type']>(resource.type)
  const [metaResolution, setMetaResolution] = useState(resource.resolution)
  const [metaDuration, setMetaDuration] = useState(resource.duration)
  const capturedThumbnailRef = useRef(false)
  const previewThumbnailUrl = buildPreviewProxyUrl(resource.thumbnailUrl || resource.url, resource.requestHeaders)
  const isDownloading = resource.downloadStatus === 'processing'
  const showDownloadProgress = isDownloading || resource.downloadStatus === 'error'
  const downloadTooltipTitle = isDownloading
    ? resource.downloadStatusText || `下载中 ${resource.downloadProgress ?? 0}%`
    : resource.downloaded || resource.merged
      ? '重新下载'
      : '下载'

  useEffect(() => {
    setDisplayType(resource.type)
    setMetaResolution(resource.resolution)
    setMetaDuration(resource.duration)
    capturedThumbnailRef.current = Boolean(resource.thumbnailUrl)
  }, [resource.id, resource.type, resource.url, resource.resolution, resource.duration, resource.thumbnailUrl])

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    const nextMetadata: Partial<Pick<MediaResource, 'type' | 'resolution' | 'duration' | 'thumbnailUrl'>> = {}

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      setDisplayType('audio')
      setMetaResolution(undefined)
      nextMetadata.type = 'audio'
      nextMetadata.resolution = undefined
    } else {
      setDisplayType(resource.type)
      const resolution = `${video.videoWidth}×${video.videoHeight}`
      setMetaResolution(resolution)
      nextMetadata.resolution = resolution
    }

    if (Number.isFinite(video.duration) && video.duration > 0) {
      const duration = formatDuration(video.duration)
      setMetaDuration(duration)
      nextMetadata.duration = duration
    }

    if (Object.keys(nextMetadata).length > 0) {
      onMetadataChange?.(resource.id, nextMetadata)
    }
  }

  const handleStreamMetadata = (metadata: SmartVideoMetadata) => {
    const nextMetadata: Partial<Pick<MediaResource, 'type' | 'resolution' | 'duration' | 'thumbnailUrl'>> = {}

    if (metadata.width && metadata.height) {
      const resolution = `${metadata.width}×${metadata.height}`
      setMetaResolution(resolution)
      nextMetadata.resolution = resolution
    }

    if (Number.isFinite(metadata.duration) && (metadata.duration ?? 0) > 0) {
      const duration = formatDuration(metadata.duration!)
      setMetaDuration(duration)
      nextMetadata.duration = duration
    }

    if (Object.keys(nextMetadata).length > 0) {
      onMetadataChange?.(resource.id, nextMetadata)
    }
  }

  const handleLoadedData = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (resource.type !== 'video' || resource.thumbnailUrl || capturedThumbnailRef.current) {
      return
    }

    const video = event.currentTarget
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      return
    }

    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) return

      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.82)
      capturedThumbnailRef.current = true
      onMetadataChange?.(resource.id, { thumbnailUrl })
    } catch (error) {
      console.error('Capture video thumbnail failed:', error)
    }
  }

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
          {displayType === 'image' ? (
            <img
              src={previewThumbnailUrl}
              alt={resource.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <>
              <SmartVideo
                src={resource.url}
                contentType={resource.contentType}
                requestHeaders={resource.requestHeaders}
                preload="auto"
                muted
                playsInline
                onLoadedMetadata={handleLoadedMetadata}
                onLoadedData={handleLoadedData}
                onMetadata={handleStreamMetadata}
              />
              {displayType === 'audio' && (
                <span className="media-card__thumbnail-placeholder media-card__thumbnail-placeholder--media">
                  <SoundOutlined />
                </span>
              )}
            </>
          )}

          {displayType === 'video' && (
            <div className="media-card__thumbnail-overlay">
              <PlayCircleOutlined />
            </div>
          )}

          <span className={`media-card__type-badge media-card__type-badge--${displayType}`}>
            {typeIcons[displayType]}
            <span>{typeLabels[displayType]}</span>
          </span>

          {(resource.downloaded || resource.merged) && (
            <div
              style={{
                position: 'absolute',
                top: 4,
                right: 50,
                display: 'flex',
                gap: 4
              }}
            >
              {resource.downloaded ? (
                <span
                  style={{
                    borderRadius: 10,
                    padding: '2px 4px',
                    background: 'rgba(144, 154, 138, 0.92)',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 500
                  }}
                >
                  已下载
                </span>
              ) : null}
              {resource.merged ? (
                <span
                  style={{
                    borderRadius: 10,
                    padding: '2px 4px',
                    background: 'rgba(144, 154, 138, 0.92)',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 500
                  }}
                >
                  已合并
                </span>
              ) : null}
            </div>
          )}

          <div className="media-card__overlay-info">
            <span className="media-card__overlay-text" title={resource.title}>
              {resource.title}
            </span>
            <span className="media-card__overlay-text media-card__overlay-text--dim">
              {[resource.size, metaResolution, metaDuration].filter(Boolean).join(' · ')}
            </span>
          </div>

          {showDownloadProgress ? (
            <div
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: 52,
                padding: '6px 8px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 4,
                  color: '#fff',
                  fontSize: 11
                }}
              >
                <span>{resource.downloadStatusText || (isDownloading ? '下载中' : '下载失败')}</span>
                <span>{resource.downloadProgress ?? 0}%</span>
              </div>
              <Progress
                percent={resource.downloadProgress ?? 0}
                size="small"
                status={resource.downloadStatus === 'error' ? 'exception' : 'active'}
                showInfo={false}
                strokeColor={resource.downloadStatus === 'error' ? 'var(--color-danger)' : 'var(--color-primary)'}
                trailColor="rgba(255, 255, 255, 0.2)"
                style={{ margin: 0 }}
              />
            </div>
          ) : null}
        </div>

        <div className="media-card__actions">
          <Tooltip title="预览" mouseEnterDelay={0.5}>
            <button className="media-card__action-btn" onClick={() => onPreview?.(resource.id)} aria-label="预览">
              <EyeOutlined />
            </button>
          </Tooltip>
          <Tooltip title={downloadTooltipTitle} mouseEnterDelay={0.5}>
            <button
              className="media-card__action-btn"
              onClick={() => onDownload?.(resource.id)}
              aria-label={isDownloading ? '下载中' : '下载'}
              disabled={isDownloading}
            >
              {isDownloading ? <LoadingOutlined spin /> : <DownloadOutlined />}
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
