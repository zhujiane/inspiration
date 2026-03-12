import { useEffect, useMemo, useRef, type CSSProperties, type SyntheticEvent, type VideoHTMLAttributes } from 'react'
import Hls, { ErrorTypes, Events } from 'hls.js'
import { buildPreviewProxyUrl, isHlsMediaSource } from '../../lib/media'

export interface SmartVideoMetadata {
  width?: number
  height?: number
  duration?: number
  live?: boolean
}

export interface SmartVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  src?: string
  contentType?: string
  requestHeaders?: Record<string, string>
  onMetadata?: (metadata: SmartVideoMetadata) => void
}

function emitManifestMetadata(levels: Array<{ width?: number; height?: number }>, onMetadata?: (metadata: SmartVideoMetadata) => void) {
  const firstLevelWithSize = levels.find((level) => (level.width ?? 0) > 0 && (level.height ?? 0) > 0)
  if (!firstLevelWithSize) return

  onMetadata?.({
    width: firstLevelWithSize.width,
    height: firstLevelWithSize.height
  })
}

export default function SmartVideo({
  src,
  contentType,
  requestHeaders,
  onMetadata,
  onLoadedMetadata,
  onLoadedData,
  style,
  ...rest
}: SmartVideoProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onMetadataRef = useRef(onMetadata)
  const previewSrc = useMemo(() => buildPreviewProxyUrl(src, requestHeaders), [src, requestHeaders])
  const isHlsSource = useMemo(() => isHlsMediaSource(src, contentType), [src, contentType])
  const useHlsJs = isHlsSource && Hls.isSupported()

  useEffect(() => {
    onMetadataRef.current = onMetadata
  }, [onMetadata])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !previewSrc || !useHlsJs) {
      return
    }

    const hls = new Hls({
      enableWorker: true,
      liveDurationInfinity: true
    })

    hls.on(Events.MANIFEST_PARSED, (_event, data) => {
      emitManifestMetadata(data.levels, onMetadataRef.current)
    })

    hls.on(Events.LEVEL_LOADED, (_event, data) => {
      emitManifestMetadata([data.levelInfo], onMetadataRef.current)
      onMetadataRef.current?.({
        duration: data.details.live || !Number.isFinite(data.details.totalduration) ? undefined : data.details.totalduration,
        live: data.details.live
      })
    })

    hls.on(Events.ERROR, (_event, data) => {
      if (!data.fatal) return

      if (data.type === ErrorTypes.NETWORK_ERROR) {
        hls.startLoad()
        return
      }

      if (data.type === ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
        return
      }

      console.error('HLS preview failed:', data)
      hls.destroy()
    })

    hls.attachMedia(video)
    hls.loadSource(previewSrc)

    return () => {
      hls.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [previewSrc, useHlsJs])

  const mergedStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    background: '#f7f2f2',
    ...style
  }

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    onLoadedMetadata?.(event)
  }

  const handleLoadedData = (event: SyntheticEvent<HTMLVideoElement>) => {
    onLoadedData?.(event)
  }

  return (
    <video
      {...rest}
      ref={videoRef}
      src={useHlsJs ? undefined : previewSrc}
      style={mergedStyle}
      crossOrigin="anonymous"
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedData}
    />
  )
}
