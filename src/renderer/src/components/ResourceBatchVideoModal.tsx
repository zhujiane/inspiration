import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip
} from 'antd'
import {
  AudioOutlined,
  BgColorsOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  CompressOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  PictureOutlined,
  RetweetOutlined,
  ScissorOutlined,
  SearchOutlined,
  SoundOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import type { Resource } from '@shared/db/resource-schema'
import type {
  BatchVideoOperationKey,
  BatchVideoProcessStatus,
  VideoAdapterInfo,
  VideoProcessingCapability
} from '@shared/ffmpeg/batch-video'
import { buildPreviewProxyUrl } from '../lib/media'
import { trpc } from '../lib/trpc'
import { formatDuration, formatSize } from '@shared/utils/format'

type BatchVideoResource = Pick<Resource, 'id' | 'name' | 'type' | 'localPath' | 'cover' | 'metadata'>

type LocalMediaMeta = {
  type: 'image' | 'video' | 'audio' | 'other'
  size?: number
  width?: number
  height?: number
  duration?: number
  container?: string
  mimeType?: string
  videoCodec?: string
  audioCodec?: string
  browserPlayable?: boolean
  cover?: string
}

type BatchResultAsset = {
  path: string
  name: string
  meta: LocalMediaMeta | null
}

type BatchResultRecord = {
  inputPath: string
  inputName: string
  outputPaths: string[]
  outputDir: string
  status: 'success' | 'error'
  error?: string
  assets: BatchResultAsset[]
  importedCount: number
}

type BatchTabState = {
  id: string
  operation: BatchVideoOperationKey
  outputDir: string
  autoImport: boolean
  running: boolean
  taskId?: string
  progress?: BatchVideoProcessStatus
  results: BatchResultRecord[]
  config: Record<string, any>
}

type BatchProcessStartResponse = {
  taskId: string
  status: BatchVideoProcessStatus
}

type OperationDefinition = {
  key: BatchVideoOperationKey
  label: string
  description: string
  icon: React.ReactNode
  tokens: string[]
}

const OPERATION_DEFINITIONS: OperationDefinition[] = [
  {
    key: 'transcode',
    label: '批量转码',
    description: '统一编码格式，适合跨平台播放和标准化归档。',
    icon: <RetweetOutlined />,
    tokens: ['转码', 'format', 'codec', '编码', '批量转码']
  },
  {
    key: 'compress',
    label: '批量压缩',
    description: '降低体积，适合上传、归档和节省磁盘空间。',
    icon: <CompressOutlined />,
    tokens: ['压缩', '体积', '空间', '码率']
  },
  {
    key: 'resize',
    label: '批量改分辨率',
    description: '统一画面尺寸，适合多平台发布和模板化制作。',
    icon: <VideoCameraOutlined />,
    tokens: ['分辨率', 'resize', '尺寸', '缩放']
  },
  {
    key: 'crop',
    label: '批量裁剪',
    description: '支持去黑边、按比例居中裁切、手动裁切。',
    icon: <ScissorOutlined />,
    tokens: ['裁剪', '去黑边', 'crop', '画面裁切']
  },
  {
    key: 'extractFrames',
    label: '批量抽帧 / 截图',
    description: '按时间间隔或 FPS 输出图片序列。',
    icon: <PictureOutlined />,
    tokens: ['抽帧', '截图', 'frame', '缩略图']
  },
  {
    key: 'watermark',
    label: '批量加水印',
    description: '支持文字水印和图片水印，适合品牌分发。',
    icon: <BgColorsOutlined />,
    tokens: ['水印', 'logo', '文字水印', '图片水印']
  },
  {
    key: 'trim',
    label: '批量裁剪时长',
    description: '按开始时间 + 时长，或按开始时间 + 结束时间裁剪。',
    icon: <ClockCircleOutlined />,
    tokens: ['剪辑', 'trim', '时长', '片段']
  },
  {
    key: 'audio',
    label: '批量去音频 / 提取音频',
    description: '输出静音视频，或直接导出音频文件。',
    icon: <SoundOutlined />,
    tokens: ['音频', '静音', '提取音频', 'remove audio']
  }
]

const parseResourceMeta = (metadata?: string | null): LocalMediaMeta | null => {
  if (!metadata) return null
  try {
    return JSON.parse(metadata) as LocalMediaMeta
  } catch {
    return null
  }
}

const getOperationDefinition = (operation: BatchVideoOperationKey): OperationDefinition =>
  OPERATION_DEFINITIONS.find((item) => item.key === operation) || OPERATION_DEFINITIONS[0]

const formatTimestampForDir = (): string => {
  const current = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${current.getFullYear()}${pad(current.getMonth() + 1)}${pad(current.getDate())}-${pad(current.getHours())}${pad(current.getMinutes())}${pad(current.getSeconds())}`
}

const getDefaultOutputDir = (resources: BatchVideoResource[], operation: BatchVideoOperationKey): string => {
  const firstPath = resources[0]?.localPath || ''
  if (!firstPath) return ''
  const normalized = firstPath.replace(/\\/g, '/')
  const directory = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : normalized
  return `${directory}/FFmpeg处理结果/${formatTimestampForDir()}-${getOperationDefinition(operation).label}`
}

const getDefaultConfig = (operation: BatchVideoOperationKey): Record<string, any> => {
  if (operation === 'transcode') return { format: 'mp4', quality: 'balanced', preset: 'medium' }
  if (operation === 'compress') return { level: 'balanced', keepAudio: true }
  if (operation === 'resize') return { width: 1920, height: 1080, fitMode: 'contain' }
  if (operation === 'crop') return { mode: 'autoBlackBars', ratioPreset: '9:16', width: 1080, height: 1920, x: 0, y: 0 }
  if (operation === 'extractFrames') return { captureMode: 'interval', everySeconds: 3, fps: 1, format: 'jpg' }
  if (operation === 'watermark') {
    return {
      watermarkType: 'text',
      text: 'Inspiration',
      imagePath: '',
      position: 'bottomRight',
      opacity: 0.6,
      margin: 24,
      fontSize: 28,
      imageScalePercent: 18
    }
  }
  if (operation === 'trim')
    return { startTime: '00:00:00', endMode: 'duration', duration: '00:00:15', endTime: '00:00:30' }
  return { audioMode: 'remove', format: 'mp3', bitrate: '192k' }
}

interface ResourceBatchVideoModalProps {
  open: boolean
  resources: BatchVideoResource[]
  onCancel: () => void
  onRefresh?: () => Promise<void> | void
}

export default function ResourceBatchVideoModal({
  open,
  resources,
  onCancel,
  onRefresh
}: ResourceBatchVideoModalProps): React.JSX.Element {
  const { message } = AntdApp.useApp()
  const [searchValue, setSearchValue] = useState('')
  const [activeTabKey, setActiveTabKey] = useState<string>()
  const [tabs, setTabs] = useState<BatchTabState[]>([])
  const [capability, setCapability] = useState<VideoProcessingCapability | null>(null)
  const tabsRef = useRef<BatchTabState[]>([])
  const pollTimersRef = useRef<Record<string, number>>({})
  const nextTabIdRef = useRef(0)

  const eligibleResources = useMemo(
    () => resources.filter((item) => item.type === '视频' && Boolean(item.localPath)),
    [resources]
  )

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    if (!open) {
      Object.values(pollTimersRef.current).forEach((timer) => window.clearInterval(timer))
      pollTimersRef.current = {}
      nextTabIdRef.current = 0
      setSearchValue('')
      setTabs([])
      setActiveTabKey(undefined)
      setCapability(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    trpc.system.getVideoProcessingCapability
      .query()
      .then((result) => {
        if (active) setCapability(result as VideoProcessingCapability)
      })
      .catch((error) => {
        console.error('Failed to get video processing capability:', error)
      })

    return () => {
      active = false
    }
  }, [open])

  const filteredOperations = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase()
    if (!keyword) return OPERATION_DEFINITIONS
    return OPERATION_DEFINITIONS.filter((item) =>
      [item.label, item.description, ...item.tokens].some((token) => token.toLowerCase().includes(keyword))
    )
  }, [searchValue])

  const updateTab = (tabId: string, updater: (tab: BatchTabState) => BatchTabState) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
  }

  const addOperationTab = (operation: BatchVideoOperationKey) => {
    const existing = tabs.find((tab) => tab.operation === operation)
    if (existing) {
      setActiveTabKey(existing.id)
      return
    }

    const nextTab: BatchTabState = {
      id: `${operation}-${nextTabIdRef.current++}`,
      operation,
      outputDir: getDefaultOutputDir(eligibleResources, operation),
      autoImport: false,
      running: false,
      results: [],
      config: getDefaultConfig(operation)
    }

    setTabs((prev) => [...prev, nextTab])
    setActiveTabKey(nextTab.id)
  }

  const selectOutputDir = async (tabId: string) => {
    const paths = (await trpc.system.showOpenDialog.mutate({
      title: '选择输出目录',
      properties: ['openDirectory', 'createDirectory']
    })) as string[]
    if (paths?.[0]) {
      updateTab(tabId, (tab) => ({ ...tab, outputDir: paths[0] }))
    }
  }

  const selectWatermarkImage = async (tabId: string) => {
    const paths = (await trpc.system.showOpenDialog.mutate({
      title: '选择水印图片',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })) as string[]
    if (!paths?.[0]) return
    updateTab(tabId, (tab) => ({ ...tab, config: { ...tab.config, imagePath: paths[0] } }))
  }

  const getResourceTypeLabel = (meta: LocalMediaMeta | null, filePath: string): string => {
    if (meta?.type === 'video') return '视频'
    if (meta?.type === 'image') return '图片'
    if (meta?.type === 'audio') return '音频'
    if (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(filePath)) return '图片'
    if (/\.(mp3|wav|aac|flac|m4a|ogg)$/i.test(filePath)) return '音频'
    if (/\.(mp4|mov|mkv|webm|avi)$/i.test(filePath)) return '视频'
    return '其他'
  }

  const importOutputsToLibrary = async (
    operation: BatchVideoOperationKey,
    outputPaths: string[]
  ): Promise<{ importedCount: number }> => {
    let importedCount = 0

    for (const outputPath of outputPaths) {
      try {
        const meta = (await trpc.system.getLocalMediaMeta.mutate({ filePath: outputPath })) as LocalMediaMeta
        await trpc.resource.create.mutate({
          name: outputPath.split(/[\\/]/).pop() || outputPath,
          type: getResourceTypeLabel(meta, outputPath),
          localPath: outputPath,
          platform: 'FFmpeg 批处理',
          cover: meta.cover,
          metadata: JSON.stringify(meta),
          description: `由 FFmpeg 批量处理生成 | ${getOperationDefinition(operation).label}`
        })
        importedCount += 1
      } catch (error) {
        console.error('Failed to import processed asset:', outputPath, error)
      }
    }

    if (importedCount > 0) {
      await onRefresh?.()
    }

    return { importedCount }
  }

  const enrichResultRecord = async (
    operation: BatchVideoOperationKey,
    record: Omit<BatchResultRecord, 'assets' | 'importedCount'>,
    autoImport: boolean
  ): Promise<BatchResultRecord> => {
    const assets = await Promise.all(
      record.outputPaths.slice(0, 6).map(async (outputPath) => {
        try {
          const meta = (await trpc.system.getLocalMediaMeta.mutate({ filePath: outputPath })) as LocalMediaMeta
          return {
            path: outputPath,
            name: outputPath.split(/[\\/]/).pop() || outputPath,
            meta
          }
        } catch (error) {
          console.error('Failed to read processed output meta:', outputPath, error)
          return {
            path: outputPath,
            name: outputPath.split(/[\\/]/).pop() || outputPath,
            meta: null
          }
        }
      })
    )

    const imported = autoImport ? await importOutputsToLibrary(operation, record.outputPaths) : { importedCount: 0 }
    return { ...record, assets, importedCount: imported.importedCount }
  }

  const buildTaskPayload = (tab: BatchTabState) => {
    if (tab.operation === 'transcode') {
      return {
        operation: 'transcode' as const,
        format: tab.config.format,
        quality: tab.config.quality,
        preset: tab.config.preset
      }
    }
    if (tab.operation === 'compress') {
      return { operation: 'compress' as const, level: tab.config.level, keepAudio: tab.config.keepAudio }
    }
    if (tab.operation === 'resize') {
      return {
        operation: 'resize' as const,
        width: Number(tab.config.width),
        height: Number(tab.config.height),
        fitMode: tab.config.fitMode
      }
    }
    if (tab.operation === 'crop') {
      return {
        operation: 'crop' as const,
        mode: tab.config.mode,
        ratioPreset: tab.config.ratioPreset,
        width: Number(tab.config.width),
        height: Number(tab.config.height),
        x: Number(tab.config.x),
        y: Number(tab.config.y)
      }
    }
    if (tab.operation === 'extractFrames') {
      return {
        operation: 'extractFrames' as const,
        captureMode: tab.config.captureMode,
        everySeconds: Number(tab.config.everySeconds),
        fps: Number(tab.config.fps),
        format: tab.config.format
      }
    }
    if (tab.operation === 'watermark') {
      return {
        operation: 'watermark' as const,
        watermarkType: tab.config.watermarkType,
        text: tab.config.text,
        imagePath: tab.config.imagePath,
        position: tab.config.position,
        opacity: Number(tab.config.opacity),
        margin: Number(tab.config.margin),
        fontSize: Number(tab.config.fontSize),
        imageScalePercent: Number(tab.config.imageScalePercent)
      }
    }
    if (tab.operation === 'trim') {
      return {
        operation: 'trim' as const,
        startTime: tab.config.startTime,
        endMode: tab.config.endMode,
        duration: tab.config.duration,
        endTime: tab.config.endTime
      }
    }
    return {
      operation: 'audio' as const,
      audioMode: tab.config.audioMode,
      format: tab.config.format,
      bitrate: tab.config.bitrate
    }
  }

  const validateTab = (tab: BatchTabState): string | null => {
    if (eligibleResources.length === 0) return '当前没有可处理的本地视频素材'
    if (!tab.outputDir?.trim()) return '请选择输出目录'
    if (tab.operation === 'resize' && (!Number(tab.config.width) || !Number(tab.config.height)))
      return '请填写有效的输出宽高'
    if (tab.operation === 'crop') {
      if (tab.config.mode === 'ratio' && !tab.config.ratioPreset) return '请选择裁剪比例'
      if (tab.config.mode === 'custom' && (!Number(tab.config.width) || !Number(tab.config.height)))
        return '自定义裁剪时请填写宽高'
    }
    if (tab.operation === 'extractFrames') {
      if (tab.config.captureMode === 'interval' && !Number(tab.config.everySeconds)) return '请设置截图间隔秒数'
      if (tab.config.captureMode === 'fps' && !Number(tab.config.fps)) return '请设置抽帧 FPS'
    }
    if (tab.operation === 'watermark') {
      if (tab.config.watermarkType === 'text' && !String(tab.config.text || '').trim()) return '请输入水印文字'
      if (tab.config.watermarkType === 'image' && !String(tab.config.imagePath || '').trim()) return '请选择水印图片'
    }
    if (tab.operation === 'trim') {
      if (!String(tab.config.startTime || '').trim()) return '请输入开始时间'
      if (tab.config.endMode === 'duration' && !String(tab.config.duration || '').trim()) return '请输入裁剪时长'
      if (tab.config.endMode === 'endTime' && !String(tab.config.endTime || '').trim()) return '请输入结束时间'
    }
    if (tab.operation === 'audio' && tab.config.audioMode === 'extract' && !String(tab.config.format || '').trim()) {
      return '请选择导出音频格式'
    }
    return null
  }

  const stopPollingTask = (tabId: string) => {
    const timer = pollTimersRef.current[tabId]
    if (timer) {
      window.clearInterval(timer)
      delete pollTimersRef.current[tabId]
    }
  }

  const completeTabProcess = async (tabId: string, status: BatchVideoProcessStatus) => {
    const currentTab = tabsRef.current.find((item) => item.id === tabId)
    if (!currentTab) return

    const nextResults = await Promise.all(
      status.results.map((item) => enrichResultRecord(currentTab.operation, item, currentTab.autoImport))
    )

    updateTab(tabId, (current) => ({
      ...current,
      running: false,
      taskId: undefined,
      progress: status,
      results: nextResults
    }))

    const successCount = nextResults.filter((item) => item.status === 'success').length
    const errorCount = nextResults.length - successCount
    if (successCount > 0 && errorCount === 0) {
      message.success(`${getOperationDefinition(currentTab.operation).label}已完成，共成功 ${successCount} 个`)
    } else if (successCount > 0) {
      message.warning(
        `${getOperationDefinition(currentTab.operation).label}已完成，成功 ${successCount} 个，失败 ${errorCount} 个`
      )
    } else {
      message.error(status.message || '批量处理失败')
    }

    if (status.taskId) {
      trpc.system.clearBatchVideoProcessStatus.mutate({ taskId: status.taskId }).catch(() => undefined)
    }
  }

  const syncTaskStatus = async (tabId: string, taskId: string) => {
    try {
      const status = (await trpc.system.getBatchVideoProcessStatus.query({ taskId })) as BatchVideoProcessStatus
      const isFinished = status.state === 'completed' || status.state === 'failed'

      updateTab(tabId, (current) =>
        current.taskId === taskId
          ? {
              ...current,
              running: !isFinished,
              progress: status
            }
          : current
      )

      if (isFinished) {
        stopPollingTask(tabId)
        await completeTabProcess(tabId, status)
      }
    } catch (error) {
      stopPollingTask(tabId)
      updateTab(tabId, (current) =>
        current.taskId === taskId ? { ...current, running: false, taskId: undefined } : current
      )
      console.error('Failed to sync batch task status:', error)
    }
  }

  const startPollingTask = (tabId: string, taskId: string) => {
    stopPollingTask(tabId)
    void syncTaskStatus(tabId, taskId)
    pollTimersRef.current[tabId] = window.setInterval(() => {
      void syncTaskStatus(tabId, taskId)
    }, 1000)
  }

  const runTabProcess = async (tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab) return

    const validationError = validateTab(tab)
    if (validationError) {
      message.warning(validationError)
      return
    }

    stopPollingTask(tabId)
    updateTab(tabId, (current) => ({
      ...current,
      running: true,
      taskId: undefined,
      progress: undefined,
      results: []
    }))
    try {
      const response = (await trpc.system.batchProcessVideo.mutate({
        items: eligibleResources.map((item) => ({ path: item.localPath as string, name: item.name })),
        outputDir: tab.outputDir,
        task: buildTaskPayload(tab)
      })) as BatchProcessStartResponse

      updateTab(tabId, (current) => ({
        ...current,
        running: true,
        taskId: response.taskId,
        progress: response.status
      }))
      startPollingTask(tabId, response.taskId)
    } catch (error) {
      console.error('Batch video process failed:', error)
      updateTab(tabId, (current) => ({ ...current, running: false }))
      message.error(error instanceof Error ? error.message : '批量处理失败')
    }
  }

  const handleManualImport = async (tabId: string, inputPath: string) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab) return
    const record = tab.results.find((item) => item.inputPath === inputPath)
    if (!record || record.outputPaths.length === 0) return

    const { importedCount } = await importOutputsToLibrary(tab.operation, record.outputPaths)
    updateTab(tabId, (current) => ({
      ...current,
      results: current.results.map((item) =>
        item.inputPath === inputPath ? { ...item, importedCount: item.importedCount + importedCount } : item
      )
    }))

    if (importedCount > 0) message.success(`已导入 ${importedCount} 个输出文件到素材库`)
    else message.warning('没有成功导入任何输出文件')
  }

  const clearTabResults = (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId)
    if (!tab || tab.running) return

    stopPollingTask(tabId)
    if (tab.taskId) {
      trpc.system.clearBatchVideoProcessStatus.mutate({ taskId: tab.taskId }).catch(() => undefined)
    }

    updateTab(tabId, (current) => ({
      ...current,
      results: [],
      progress: undefined,
      taskId: undefined
    }))
  }

  const getTaskStateLabel = (state?: BatchVideoProcessStatus['state']): string => {
    if (state === 'running') return '处理中'
    if (state === 'completed') return '已完成'
    if (state === 'failed') return '已结束'
    return '待开始'
  }

  const getTaskStateTagColor = (state?: BatchVideoProcessStatus['state']): string => {
    if (state === 'running') return 'blue'
    if (state === 'completed') return 'success'
    if (state === 'failed') return 'error'
    return 'default'
  }

  const getAdapterTagColor = (adapter: VideoAdapterInfo): string => {
    if (adapter.kind === 'discrete') return 'magenta'
    if (adapter.kind === 'integrated') return 'geekblue'
    if (adapter.kind === 'virtual') return 'default'
    return 'purple'
  }

  const renderAdapterKind = (adapter: VideoAdapterInfo): string => {
    if (adapter.kind === 'discrete') return '独显'
    if (adapter.kind === 'integrated') return '集显'
    if (adapter.kind === 'virtual') return '虚拟'
    return '未知'
  }

  const renderExecutionPanel = (tab: BatchTabState) => {
    const currentCapability = tab.progress?.capability || capability
    const strategy = currentCapability?.preferredStrategy
    const progress = tab.progress
    const hasProgress = Boolean(progress)

    return (
      <Card size="small" className="resource-batch__panel-card resource-batch__engine-card">
        <div className="resource-batch__engine-head">
          <div>
            <div className="resource-batch__panel-eyebrow">执行引擎</div>
            <h4>FFmpeg 加速策略</h4>
          </div>
          <Tag color={getTaskStateTagColor(progress?.state)}>{getTaskStateLabel(progress?.state)}</Tag>
        </div>

        {strategy ? (
          <div className="resource-batch__engine-summary">
            <div className="resource-batch__engine-chip">
              <span>编码器</span>
              <strong>{strategy.title}</strong>
            </div>
            <div className="resource-batch__engine-chip">
              <span>模式</span>
              <strong>{strategy.acceleration === 'gpu' ? 'GPU 加速' : 'CPU 编码'}</strong>
            </div>
            <div className="resource-batch__engine-chip">
              <span>设备</span>
              <strong>{strategy.deviceName || '软件编码'}</strong>
            </div>
          </div>
        ) : null}

        {progress ? (
          <div className="resource-batch__progress-block">
            <div className="resource-batch__progress-copy">
              <strong>{progress.message || '正在准备 FFmpeg 任务'}</strong>
              <span>
                {progress.completedItems}/{progress.totalItems} 个视频
                {progress.currentItemName ? ` · 当前：${progress.currentItemName}` : ''}
              </span>
            </div>
            <Progress
              percent={progress.percent}
              status={
                progress.state === 'failed' && progress.completedItems === progress.totalItems ? 'exception' : undefined
              }
              strokeColor={{ '0%': '#E11D48', '100%': '#2563EB' }}
            />
            {progress.currentCommand ? (
              <div className="resource-batch__command-box">
                <span>当前命令</span>
                <code>{progress.currentCommand}</code>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="resource-batch__engine-placeholder"></div>
        )}

        {strategy ? <div className="resource-batch__engine-tip">{strategy.description}</div> : null}

        {currentCapability?.adapters?.length ? (
          <div className="resource-batch__adapter-list">
            {currentCapability.adapters.map((adapter) => (
              <Tag key={`${adapter.name}-${adapter.vendor}`} color={getAdapterTagColor(adapter)}>
                {adapter.isPreferred ? '当前优先 · ' : ''}
                {renderAdapterKind(adapter)} · {adapter.name}
              </Tag>
            ))}
          </div>
        ) : (
          <div className="resource-batch__engine-tip">
            {hasProgress ? '当前任务未返回更多硬件信息。' : '暂未拿到显卡信息，将在启动任务时自动回退到软件编码。'}
          </div>
        )}
      </Card>
    )
  }

  const renderOperationConfig = (tab: BatchTabState) => {
    if (tab.operation === 'transcode') {
      return (
        <div className="resource-batch__fields">
          <label>
            <span>输出格式</span>
            <Select
              value={tab.config.format}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'mkv', label: 'MKV' },
                { value: 'mov', label: 'MOV' },
                { value: 'webm', label: 'WEBM' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, format: value } }))
              }
            />
          </label>
          <label>
            <span>质量倾向</span>
            <Segmented
              value={tab.config.quality}
              options={[
                { value: 'high', label: '高质量' },
                { value: 'balanced', label: '平衡' },
                { value: 'small', label: '更小体积' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, quality: value } }))
              }
            />
          </label>
          <label>
            <span>编码速度</span>
            <Segmented
              value={tab.config.preset}
              options={[
                { value: 'fast', label: '快' },
                { value: 'medium', label: '中' },
                { value: 'slow', label: '慢' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, preset: value } }))
              }
            />
          </label>
        </div>
      )
    }

    if (tab.operation === 'compress') {
      return (
        <div className="resource-batch__fields">
          <label>
            <span>压缩力度</span>
            <Segmented
              value={tab.config.level}
              options={[
                { value: 'light', label: '轻度' },
                { value: 'balanced', label: '平衡' },
                { value: 'aggressive', label: '强压缩' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, level: value } }))
              }
            />
          </label>
          <label className="resource-batch__switch-row">
            <span>保留音频</span>
            <Switch
              checked={tab.config.keepAudio}
              onChange={(checked) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, keepAudio: checked } }))
              }
            />
          </label>
        </div>
      )
    }

    if (tab.operation === 'resize') {
      return (
        <div className="resource-batch__fields resource-batch__fields--grid3">
          <label>
            <span>宽度</span>
            <InputNumber
              min={1}
              value={tab.config.width}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, width: value } }))
              }
            />
          </label>
          <label>
            <span>高度</span>
            <InputNumber
              min={1}
              value={tab.config.height}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, height: value } }))
              }
            />
          </label>
          <label>
            <span>适配模式</span>
            <Select
              value={tab.config.fitMode}
              options={[
                { value: 'contain', label: '完整显示 + 补边' },
                { value: 'cover', label: '铺满画面 + 居中裁切' },
                { value: 'stretch', label: '强制拉伸' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, fitMode: value } }))
              }
            />
          </label>
        </div>
      )
    }

    if (tab.operation === 'crop') {
      return (
        <div className="resource-batch__fields">
          <label>
            <span>裁剪模式</span>
            <Segmented
              value={tab.config.mode}
              options={[
                { value: 'autoBlackBars', label: '自动去黑边' },
                { value: 'ratio', label: '按比例裁切' },
                { value: 'custom', label: '手动裁切' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, mode: value } }))
              }
            />
          </label>
          {tab.config.mode === 'ratio' ? (
            <label>
              <span>输出比例</span>
              <Segmented
                value={tab.config.ratioPreset}
                options={['1:1', '4:5', '9:16', '16:9']}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, ratioPreset: value } }))
                }
              />
            </label>
          ) : null}
          {tab.config.mode === 'custom' ? (
            <div className="resource-batch__fields resource-batch__fields--grid4">
              <label>
                <span>宽度</span>
                <InputNumber
                  min={1}
                  value={tab.config.width}
                  onChange={(value) =>
                    updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, width: value } }))
                  }
                />
              </label>
              <label>
                <span>高度</span>
                <InputNumber
                  min={1}
                  value={tab.config.height}
                  onChange={(value) =>
                    updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, height: value } }))
                  }
                />
              </label>
              <label>
                <span>X 偏移</span>
                <InputNumber
                  min={0}
                  value={tab.config.x}
                  onChange={(value) =>
                    updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, x: value } }))
                  }
                />
              </label>
              <label>
                <span>Y 偏移</span>
                <InputNumber
                  min={0}
                  value={tab.config.y}
                  onChange={(value) =>
                    updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, y: value } }))
                  }
                />
              </label>
            </div>
          ) : null}
        </div>
      )
    }

    if (tab.operation === 'extractFrames') {
      return (
        <div className="resource-batch__fields">
          <label>
            <span>截图方式</span>
            <Segmented
              value={tab.config.captureMode}
              options={[
                { value: 'interval', label: '按秒截图' },
                { value: 'fps', label: '按 FPS 抽帧' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, captureMode: value } }))
              }
            />
          </label>
          {tab.config.captureMode === 'interval' ? (
            <label>
              <span>每隔多少秒</span>
              <InputNumber
                min={0.1}
                step={0.5}
                value={tab.config.everySeconds}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, everySeconds: value } }))
                }
              />
            </label>
          ) : (
            <label>
              <span>FPS</span>
              <InputNumber
                min={0.1}
                step={0.5}
                value={tab.config.fps}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, fps: value } }))
                }
              />
            </label>
          )}
          <label>
            <span>图片格式</span>
            <Segmented
              value={tab.config.format}
              options={[
                { value: 'jpg', label: 'JPG' },
                { value: 'png', label: 'PNG' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, format: value } }))
              }
            />
          </label>
        </div>
      )
    }

    if (tab.operation === 'watermark') {
      return (
        <div className="resource-batch__fields">
          <label>
            <span>水印类型</span>
            <Segmented
              value={tab.config.watermarkType}
              options={[
                { value: 'text', label: '文字水印' },
                { value: 'image', label: '图片水印' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, watermarkType: value } }))
              }
            />
          </label>
          {tab.config.watermarkType === 'text' ? (
            <label>
              <span>水印文字</span>
              <Input
                value={tab.config.text}
                onChange={(event) =>
                  updateTab(tab.id, (current) => ({
                    ...current,
                    config: { ...current.config, text: event.target.value }
                  }))
                }
              />
            </label>
          ) : (
            <label>
              <span>水印图片</span>
              <Space.Compact style={{ width: '100%' }}>
                <Input value={tab.config.imagePath} readOnly placeholder="请选择 PNG / JPG / WEBP 图片" />
                <Button onClick={() => selectWatermarkImage(tab.id)}>选择图片</Button>
              </Space.Compact>
            </label>
          )}
          <div className="resource-batch__fields resource-batch__fields--grid4">
            <label>
              <span>位置</span>
              <Select
                value={tab.config.position}
                options={[
                  { value: 'topLeft', label: '左上' },
                  { value: 'topRight', label: '右上' },
                  { value: 'bottomLeft', label: '左下' },
                  { value: 'bottomRight', label: '右下' },
                  { value: 'center', label: '居中' }
                ]}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, position: value } }))
                }
              />
            </label>
            <label>
              <span>透明度</span>
              <InputNumber
                min={0.1}
                max={1}
                step={0.1}
                value={tab.config.opacity}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, opacity: value } }))
                }
              />
            </label>
            <label>
              <span>边距</span>
              <InputNumber
                min={0}
                max={200}
                value={tab.config.margin}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, margin: value } }))
                }
              />
            </label>
            {tab.config.watermarkType === 'text' ? (
              <label>
                <span>字号</span>
                <InputNumber
                  min={12}
                  max={120}
                  value={tab.config.fontSize}
                  onChange={(value) =>
                    updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, fontSize: value } }))
                  }
                />
              </label>
            ) : (
              <label>
                <span>图片宽度占比</span>
                <InputNumber
                  min={5}
                  max={60}
                  value={tab.config.imageScalePercent}
                  formatter={(value) => `${value}%`}
                  parser={(value) => Number(String(value).replace('%', ''))}
                  onChange={(value) =>
                    updateTab(tab.id, (current) => ({
                      ...current,
                      config: { ...current.config, imageScalePercent: value }
                    }))
                  }
                />
              </label>
            )}
          </div>
        </div>
      )
    }

    if (tab.operation === 'trim') {
      return (
        <div className="resource-batch__fields resource-batch__fields--grid3">
          <label>
            <span>开始时间</span>
            <Input
              value={tab.config.startTime}
              placeholder="00:00:00"
              onChange={(event) =>
                updateTab(tab.id, (current) => ({
                  ...current,
                  config: { ...current.config, startTime: event.target.value }
                }))
              }
            />
          </label>
          <label>
            <span>结束方式</span>
            <Segmented
              value={tab.config.endMode}
              options={[
                { value: 'duration', label: '按时长' },
                { value: 'endTime', label: '按结束时间' }
              ]}
              onChange={(value) =>
                updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, endMode: value } }))
              }
            />
          </label>
          {tab.config.endMode === 'duration' ? (
            <label>
              <span>时长</span>
              <Input
                value={tab.config.duration}
                placeholder="00:00:15"
                onChange={(event) =>
                  updateTab(tab.id, (current) => ({
                    ...current,
                    config: { ...current.config, duration: event.target.value }
                  }))
                }
              />
            </label>
          ) : (
            <label>
              <span>结束时间</span>
              <Input
                value={tab.config.endTime}
                placeholder="00:00:30"
                onChange={(event) =>
                  updateTab(tab.id, (current) => ({
                    ...current,
                    config: { ...current.config, endTime: event.target.value }
                  }))
                }
              />
            </label>
          )}
        </div>
      )
    }

    return (
      <div className="resource-batch__fields">
        <label>
          <span>处理方式</span>
          <Segmented
            value={tab.config.audioMode}
            options={[
              { value: 'remove', label: '去除音频' },
              { value: 'extract', label: '提取音频' }
            ]}
            onChange={(value) =>
              updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, audioMode: value } }))
            }
          />
        </label>
        {tab.config.audioMode === 'extract' ? (
          <div className="resource-batch__fields resource-batch__fields--grid2">
            <label>
              <span>音频格式</span>
              <Select
                value={tab.config.format}
                options={[
                  { value: 'mp3', label: 'MP3' },
                  { value: 'wav', label: 'WAV' },
                  { value: 'aac', label: 'AAC' },
                  { value: 'flac', label: 'FLAC' }
                ]}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, format: value } }))
                }
              />
            </label>
            <label>
              <span>码率</span>
              <Segmented
                value={tab.config.bitrate}
                options={['128k', '192k', '256k']}
                onChange={(value) =>
                  updateTab(tab.id, (current) => ({ ...current, config: { ...current.config, bitrate: value } }))
                }
              />
            </label>
          </div>
        ) : null}
      </div>
    )
  }

  const renderResults = (tab: BatchTabState) => {
    if (tab.results.length === 0) {
      return (
        <div className="resource-batch__empty-block">
          <Empty description="该操作还没有处理结果，配置好参数后即可执行批处理。" />
        </div>
      )
    }

    const successCount = tab.results.filter((item) => item.status === 'success').length
    const errorCount = tab.results.length - successCount
    return (
      <div className="resource-batch__results">
        <div className="resource-batch__summary">
          <div className="resource-batch__summary-card">
            <span>成功素材</span>
            <strong>{successCount}</strong>
          </div>
          <div className="resource-batch__summary-card">
            <span>失败素材</span>
            <strong>{errorCount}</strong>
          </div>
        </div>
        <div className="resource-batch__result-list">
          {tab.results.map((item) => (
            <Card
              key={item.inputPath}
              size="small"
              className="resource-batch__result-card"
              title={
                <div className="resource-batch__result-title">
                  <span>{item.inputName}</span>
                  <Tag color={item.status === 'success' ? 'success' : 'error'}>
                    {item.status === 'success' ? '处理完成' : '处理失败'}
                  </Tag>
                </div>
              }
              extra={
                item.status === 'success' && item.outputPaths.length > 0 ? (
                  <Space size={8}>
                    <Tooltip title="打开第一个输出文件">
                      <Button
                        size="small"
                        icon={<FolderOpenOutlined />}
                        onClick={() => trpc.system.openFile.mutate(item.outputPaths[0])}
                      />
                    </Tooltip>
                    <Tooltip title="打开输出目录">
                      <Button
                        size="small"
                        icon={<VideoCameraOutlined />}
                        onClick={() => trpc.system.openFile.mutate(item.outputDir)}
                      />
                    </Tooltip>
                    <Tooltip title="导入到素材库">
                      <Button
                        size="small"
                        icon={<ImportOutlined />}
                        onClick={() => handleManualImport(tab.id, item.inputPath)}
                      />
                    </Tooltip>
                  </Space>
                ) : null
              }
            >
              {item.status === 'error' ? (
                <div className="resource-batch__error-row">
                  <CloseCircleFilled />
                  <span>{item.error || '处理失败'}</span>
                </div>
              ) : (
                <>
                  <div className="resource-batch__status-row">
                    <CheckCircleFilled />
                    <span>
                      生成 {item.outputPaths.length} 个文件
                      {item.importedCount > 0 ? `，其中 ${item.importedCount} 个已导入素材库` : ''}
                    </span>
                  </div>
                  <div className="resource-batch__asset-grid">
                    {item.assets.map((asset) => {
                      const previewSrc =
                        asset.meta?.cover ||
                        (asset.meta?.type === 'image' ? buildPreviewProxyUrl(asset.path) : undefined)
                      const metrics = [
                        asset.meta?.size ? formatSize(asset.meta.size) : '',
                        asset.meta?.width && asset.meta?.height ? `${asset.meta.width} x ${asset.meta.height}` : '',
                        asset.meta?.duration ? formatDuration(asset.meta.duration) : ''
                      ].filter(Boolean)
                      return (
                        <div key={asset.path} className="resource-batch__asset-card">
                          <div className="resource-batch__asset-preview">
                            {previewSrc ? (
                              <img src={previewSrc} alt={asset.name} />
                            ) : asset.meta?.type === 'audio' ? (
                              <AudioOutlined />
                            ) : (
                              <VideoCameraOutlined />
                            )}
                          </div>
                          <div className="resource-batch__asset-info">
                            <div className="resource-batch__asset-name" title={asset.name}>
                              {asset.name}
                            </div>
                            <div className="resource-batch__asset-metrics">
                              {metrics.map((metric) => (
                                <span key={metric}>{metric}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {item.outputPaths.length > item.assets.length ? (
                    <div className="resource-batch__more-text">
                      还有 {item.outputPaths.length - item.assets.length}{' '}
                      个输出文件未在此处展开，可直接打开输出目录查看。
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const activeTab = tabs.find((item) => item.id === activeTabKey) || tabs[0]
  const activeCapability = activeTab?.progress?.capability || capability

  const renderWorkbench = (tab: BatchTabState) => (
    <div className="resource-batch__tab-content">
      <div className="resource-batch__workbench">
        <div className="resource-batch__workbench-main">
          {renderExecutionPanel(tab)}

          <div className="resource-batch__panel-grid">
            <Card size="small" className="resource-batch__panel-card resource-batch__resource-card" title="处理范围">
              <div className="resource-batch__resource-grid">
                {eligibleResources.map((item) => {
                  const meta = parseResourceMeta(item.metadata)
                  return (
                    <div key={item.id} className="resource-batch__resource-item">
                      <div className="resource-batch__resource-thumb">
                        {item.cover ? <img src={item.cover} alt={item.name} /> : <VideoCameraOutlined />}
                      </div>
                      <div className="resource-batch__resource-body">
                        <div className="resource-batch__resource-name" title={item.name}>
                          {item.name}
                        </div>
                        <div className="resource-batch__resource-meta">
                          {meta?.width && meta?.height ? `${meta.width} x ${meta.height}` : '视频素材'}
                          {meta?.duration ? ` / ${formatDuration(meta.duration)}` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card
              size="small"
              className="resource-batch__panel-card resource-batch__config-card"
              title="处理参数"
              extra={<Tag color="blue">{getOperationDefinition(tab.operation).label}</Tag>}
            >
              {renderOperationConfig(tab)}
            </Card>
          </div>

          <Card size="small" className="resource-batch__panel-card" title="结果存储与导入">
            <div className="resource-batch__storage-row">
              <label className="resource-batch__field-grow">
                <span>输出目录</span>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={tab.outputDir}
                    placeholder="请选择处理结果存放目录"
                    onChange={(event) =>
                      updateTab(tab.id, (current) => ({ ...current, outputDir: event.target.value }))
                    }
                  />
                  <Button onClick={() => selectOutputDir(tab.id)}>选择目录</Button>
                </Space.Compact>
              </label>
              <label className="resource-batch__switch-row">
                <span>完成后自动导入素材库</span>
                <Switch
                  checked={tab.autoImport}
                  onChange={(checked) => updateTab(tab.id, (current) => ({ ...current, autoImport: checked }))}
                />
              </label>
            </div>
            <div className="resource-batch__storage-tip">
              处理后的文件统一写入当前输出目录；右侧结果栏会持续显示预览、关键属性和导入状态。
            </div>
          </Card>
        </div>

        <aside className="resource-batch__result-sidebar">
          <div className="resource-batch__result-toolbar">
            <Button
              size="large"
              type="primary"
              loading={tab.running}
              className="resource-batch__result-run"
              onClick={() => runTabProcess(tab.id)}
            >
              开始处理 {eligibleResources.length} 个视频
            </Button>
            {tab.progress ? (
              <Tag color={getTaskStateTagColor(tab.progress.state)}>{getTaskStateLabel(tab.progress.state)}</Tag>
            ) : null}
          </div>

          <Card
            size="small"
            className="resource-batch__panel-card resource-batch__sidebar-card resource-batch__results-card"
            title="处理结果"
            extra={
              <Button
                size="small"
                disabled={tab.running || tab.results.length === 0}
                onClick={() => clearTabResults(tab.id)}
              >
                清空结果
              </Button>
            }
          >
            {renderResults(tab)}
          </Card>
        </aside>
      </div>
    </div>
  )

  return (
    <Modal
      title="视频批量处理工作台"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={1400}
      destroyOnHidden
      styles={{ body: { padding: 0, minHeight: '78vh', maxHeight: '78vh', overflow: 'hidden' } }}
    >
      <div className="resource-batch">
        <aside className="resource-batch__sidebar">
          <div className="resource-batch__sidebar-head">
            <div>
              <div className="resource-batch__sidebar-kicker">Batch Studio</div>
              <h3>功能库</h3>
              <p>点击左侧功能，右侧即创建独立的批处理工作区。</p>
            </div>
            <div className="resource-batch__sidebar-stats">
              <Tag color="blue">{eligibleResources.length} 个视频</Tag>
              {activeCapability?.preferredStrategy ? (
                <Tag color={activeCapability.preferredStrategy.acceleration === 'gpu' ? 'magenta' : 'default'}>
                  {activeCapability.preferredStrategy.title}
                </Tag>
              ) : null}
            </div>
          </div>

          <Input
            allowClear
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="搜索转码、压缩、水印、抽帧..."
            prefix={<SearchOutlined />}
          />

          <div className="resource-batch__operation-list">
            {filteredOperations.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`resource-batch__operation-item${
                  activeTab?.operation === item.key ? ' resource-batch__operation-item--active' : ''
                }`}
                aria-pressed={activeTab?.operation === item.key}
                onClick={() => addOperationTab(item.key)}
              >
                <div className="resource-batch__operation-icon">{item.icon}</div>
                <div className="resource-batch__operation-copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
              </button>
            ))}
            {filteredOperations.length === 0 ? (
              <div className="resource-batch__empty-list">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的处理功能" />
              </div>
            ) : null}
          </div>
        </aside>

        <main className="resource-batch__workspace">
          {eligibleResources.length === 0 ? (
            <div className="resource-batch__empty-block">
              <Empty description="请先在素材库勾选至少一个本地视频素材，再打开批量处理工作台。" />
            </div>
          ) : tabs.length === 0 ? (
            <div className="resource-batch__empty-block">
              <Empty description="左侧选择一个功能，即可创建对应的批处理工作区。" />
            </div>
          ) : activeTab ? (
            renderWorkbench(activeTab)
          ) : null}
        </main>
      </div>

      <style>{`
        .resource-batch { --batch-primary: #2563EB; --batch-secondary: #60A5FA; --batch-cta: #0EA5E9; --batch-bg: #F3F8FF; --batch-text: #0F172A; --batch-border: rgba(37, 99, 235, 0.14); display: grid; grid-template-columns: 248px minmax(0, 1fr); height: 78vh; min-height: 78vh; max-height: 78vh; overflow: hidden; background: radial-gradient(circle at top left, rgba(96, 165, 250, 0.24), transparent 24%), radial-gradient(circle at right bottom, rgba(14, 165, 233, 0.16), transparent 28%), linear-gradient(180deg, #f8fbff 0%, var(--batch-bg) 100%); color: var(--batch-text); font-family: "Open Sans", "Segoe UI", sans-serif; }
        .resource-batch h3, .resource-batch h4, .resource-batch .ant-card-head-title { font-family: "Poppins", "Segoe UI", sans-serif; }
        .resource-batch__sidebar { padding: 14px; border-right: 1px solid var(--batch-border); display: flex; flex-direction: column; gap: 10px; background: rgba(255, 255, 255, 0.74); backdrop-filter: blur(14px); min-height: 0; overflow-y: auto; overflow-x: hidden; }
        .resource-batch__sidebar-head { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 16px; background: linear-gradient(145deg, rgba(37, 99, 235, 0.1), rgba(14, 165, 233, 0.08)); border: 1px solid rgba(37, 99, 235, 0.12); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06); }
        .resource-batch__sidebar-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--batch-primary); }
        .resource-batch__sidebar-head h3 { margin: 2px 0 0; font-size: 18px; line-height: 1.15; color: var(--batch-text); }
        .resource-batch__sidebar-head p { margin: 4px 0 0; color: rgba(51, 65, 85, 0.78); line-height: 1.45; font-size: 12px; }
        .resource-batch__sidebar-stats { display: flex; flex-wrap: wrap; gap: 6px; }
        .resource-batch__operation-list { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
        .resource-batch__operation-item { width: 100%; border: 1px solid var(--batch-border); background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(243,248,255,0.92) 100%); border-radius: 12px; padding: 10px; display: flex; gap: 10px; text-align: left; cursor: pointer; transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .resource-batch__operation-item:hover { transform: translateY(-1px); border-color: rgba(37, 99, 235, 0.35); box-shadow: 0 8px 16px rgba(37, 99, 235, 0.1); }
        .resource-batch__operation-item--active { border-color: rgba(37, 99, 235, 0.42); background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(231,240,255,0.96) 100%); box-shadow: 0 8px 18px rgba(37, 99, 235, 0.12); }
        .resource-batch__operation-item:focus-visible { outline: none; border-color: var(--batch-primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18); }
        .resource-batch__operation-icon { width: 32px; height: 32px; border-radius: 10px; background: linear-gradient(145deg, rgba(37, 99, 235, 0.14), rgba(14, 165, 233, 0.14)); color: var(--batch-primary); display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
        .resource-batch__operation-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .resource-batch__operation-copy strong { color: var(--batch-text); font-size: 13px; line-height: 1.25; }
        .resource-batch__operation-copy span { color: rgba(51, 65, 85, 0.74); line-height: 1.35; font-size: 11px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
        .resource-batch__workspace { min-width: 0; padding: 16px; overflow-y: auto; overflow-x: hidden; min-height: 0; display: flex; flex-direction: column; }
        .resource-batch__tab-content { display: flex; flex-direction: column; min-height: 100%; }
        .resource-batch__workbench { display: grid; grid-template-columns: minmax(0, 1fr) 308px; gap: 14px; align-items: stretch; min-height: 0; height: 100%; }
        .resource-batch__workbench-main { min-width: 0; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
        .resource-batch__result-sidebar { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; position: sticky; top: 0; height: calc(78vh - 116px); max-height: calc(78vh - 116px); }
        .resource-batch__result-toolbar { display: flex; flex-direction: column; gap: 8px; }
        .resource-batch__result-toolbar .ant-tag { width: fit-content; margin-inline-end: 0; }
        .resource-batch__result-run { width: 100%; }
        .resource-batch__panel-grid { display: grid; grid-template-columns: minmax(250px, 0.82fr) minmax(320px, 1.18fr); gap: 14px; align-items: stretch; }
        .resource-batch__panel-card { border-radius: 16px; border: 1px solid rgba(37, 99, 235, 0.1); box-shadow: 0 10px 20px rgba(15, 23, 42, 0.06); background: rgba(255, 255, 255, 0.92); overflow: hidden; }
        .resource-batch__panel-card .ant-card-head { min-height: 48px; padding: 0 14px; }
        .resource-batch__panel-card .ant-card-head-title { padding: 12px 0; font-size: 15px; }
        .resource-batch__panel-card .ant-card-extra { padding: 12px 0; }
        .resource-batch__panel-card .ant-card-body { padding: 14px; }
        .resource-batch__panel-grid > .ant-card { display: flex; flex-direction: column; }
        .resource-batch__panel-grid > .ant-card .ant-card-body { flex: 1; min-height: 0; }
        .resource-batch__panel-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--batch-primary); }
        .resource-batch__sidebar-card { display: flex; flex-direction: column; min-height: 0; }
        .resource-batch__sidebar-card .ant-card-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
        .resource-batch__results-card { flex: 1; min-height: 0; }
        .resource-batch__results-card .ant-card-body { flex: 1; }
        .resource-batch__engine-card .ant-card-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
        .resource-batch__engine-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
        .resource-batch__engine-head h4 { margin: 2px 0 0; color: var(--batch-text); font-size: 15px; line-height: 1.2; }
        .resource-batch__engine-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .resource-batch__engine-chip { padding: 8px 10px; border-radius: 12px; background: linear-gradient(180deg, rgba(243,248,255,0.92) 0%, rgba(255,255,255,0.98) 100%); border: 1px solid rgba(37, 99, 235, 0.12); min-width: 0; }
        .resource-batch__engine-chip span { display: block; font-size: 10px; color: rgba(51, 65, 85, 0.72); margin-bottom: 3px; }
        .resource-batch__engine-chip strong { color: var(--batch-text); font-size: 12px; line-height: 1.25; display: block; }
        .resource-batch__progress-block { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 14px; background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(14, 165, 233, 0.08)); border: 1px solid rgba(37, 99, 235, 0.12); }
        .resource-batch__progress-copy { display: flex; flex-direction: column; gap: 4px; }
        .resource-batch__progress-copy strong { color: var(--batch-text); font-size: 13px; }
        .resource-batch__progress-copy span, .resource-batch__engine-tip, .resource-batch__engine-placeholder, .resource-batch__storage-tip, .resource-batch__more-text { color: rgba(51, 65, 85, 0.78); font-size: 12px; line-height: 1.55; }
        .resource-batch__command-box { padding: 9px 10px; border-radius: 12px; background: #fff; border: 1px dashed rgba(37, 99, 235, 0.3); display: flex; flex-direction: column; gap: 4px; }
        .resource-batch__command-box span { color: var(--batch-cta); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
        .resource-batch__command-box code { display: block; font-size: 11px; line-height: 1.45; color: #1e3a8a; white-space: pre-wrap; word-break: break-word; }
        .resource-batch__adapter-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .resource-batch__adapter-list .ant-tag { margin-inline-end: 0; border-radius: 999px; padding-inline: 8px; font-size: 11px; }
        .resource-batch__resource-grid { display: grid; gap: 8px; max-height: 320px; overflow: auto; }
        .resource-batch__resource-item { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; padding: 8px; border-radius: 13px; background: rgba(243, 248, 255, 0.9); border: 1px solid rgba(37, 99, 235, 0.1); }
        .resource-batch__resource-thumb { width: 84px; height: 54px; border-radius: 9px; background: linear-gradient(135deg, #0f172a 0%, #2563eb 100%); color: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .resource-batch__resource-thumb img, .resource-batch__asset-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .resource-batch__resource-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; justify-content: center; }
        .resource-batch__resource-name, .resource-batch__asset-name { font-weight: 700; color: var(--batch-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .resource-batch__resource-name { font-size: 13px; }
        .resource-batch__resource-meta { color: rgba(51, 65, 85, 0.7); font-size: 12px; }
        .resource-batch__fields { display: flex; flex-direction: column; gap: 12px; }
        .resource-batch__fields--grid2, .resource-batch__fields--grid3, .resource-batch__fields--grid4 { display: grid; gap: 12px; }
        .resource-batch__fields--grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .resource-batch__fields--grid3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .resource-batch__fields--grid4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .resource-batch__fields label, .resource-batch__storage-row label { display: flex; flex-direction: column; gap: 6px; color: rgba(51, 65, 85, 0.9); font-size: 12px; }
        .resource-batch__field-grow { flex: 1; }
        .resource-batch__switch-row { justify-content: space-between; }
        .resource-batch__switch-row .ant-switch { margin-top: 2px; }
        .resource-batch__storage-row { display: flex; gap: 12px; align-items: flex-end; }
        .resource-batch__empty-block, .resource-batch__empty-list { min-height: 240px; display: flex; align-items: center; justify-content: center; }
        .resource-batch__sidebar-card .resource-batch__empty-block { min-height: 100%; }
        .resource-batch__results { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; }
        .resource-batch__summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .resource-batch__summary-card { padding: 10px; border-radius: 13px; background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(243,248,255,0.92) 100%); border: 1px solid rgba(37, 99, 235, 0.12); display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .resource-batch__summary-card span { color: rgba(51, 65, 85, 0.72); font-size: 11px; }
        .resource-batch__summary-card strong { color: var(--batch-text); font-size: 18px; line-height: 1; }
        .resource-batch__result-list { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; overflow: auto; padding-right: 4px; }
        .resource-batch__result-card { border-radius: 14px; border: 1px solid rgba(37, 99, 235, 0.1); overflow: hidden; }
        .resource-batch__result-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .resource-batch__status-row, .resource-batch__error-row { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 10px; }
        .resource-batch__status-row { color: #15803d; }
        .resource-batch__error-row { color: #dc2626; }
        .resource-batch__asset-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
        .resource-batch__asset-card { border-radius: 13px; border: 1px solid rgba(37, 99, 235, 0.1); background: rgba(243, 248, 255, 0.86); overflow: hidden; }
        .resource-batch__asset-preview { height: 72px; background: linear-gradient(135deg, #0f172a 0%, #2563eb 100%); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .resource-batch__asset-info { padding: 9px; display: flex; flex-direction: column; gap: 6px; }
        .resource-batch__asset-metrics { display: flex; flex-wrap: wrap; gap: 5px; }
        .resource-batch__asset-metrics span { font-size: 11px; color: var(--batch-text); background: rgba(37, 99, 235, 0.08); border-radius: 999px; padding: 3px 7px; }
        .resource-batch .ant-input, .resource-batch .ant-input-number, .resource-batch .ant-select-selector, .resource-batch .ant-picker, .resource-batch .ant-segmented { border-radius: 10px !important; }
        .resource-batch .ant-input:focus, .resource-batch .ant-input-focused, .resource-batch .ant-select-focused .ant-select-selector, .resource-batch .ant-input-number-focused { border-color: var(--batch-primary) !important; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14) !important; }
        .resource-batch .ant-btn { border-radius: 10px; transition: all 200ms ease; }
        .resource-batch .ant-btn-primary { background: var(--batch-cta); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .resource-batch .ant-btn-primary:hover { opacity: 0.92; transform: translateY(-1px); }
        .resource-batch__workspace::-webkit-scrollbar,
        .resource-batch__sidebar::-webkit-scrollbar,
        .resource-batch__resource-grid::-webkit-scrollbar,
        .resource-batch__result-list::-webkit-scrollbar { width: 10px; height: 10px; }
        .resource-batch__workspace::-webkit-scrollbar-thumb,
        .resource-batch__sidebar::-webkit-scrollbar-thumb,
        .resource-batch__resource-grid::-webkit-scrollbar-thumb,
        .resource-batch__result-list::-webkit-scrollbar-thumb { background: rgba(37, 99, 235, 0.28); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
        .resource-batch__workspace::-webkit-scrollbar-track,
        .resource-batch__sidebar::-webkit-scrollbar-track,
        .resource-batch__resource-grid::-webkit-scrollbar-track,
        .resource-batch__result-list::-webkit-scrollbar-track { background: rgba(37, 99, 235, 0.06); border-radius: 999px; }
        @media (prefers-reduced-motion: reduce) { .resource-batch__operation-item, .resource-batch .ant-btn-primary { transition: none; } }
        @media (max-width: 1320px) { .resource-batch__workbench { grid-template-columns: minmax(0, 1fr) 284px; } .resource-batch__panel-grid { grid-template-columns: minmax(220px, 0.82fr) minmax(0, 1.18fr); } }
        @media (max-width: 1180px) { .resource-batch { grid-template-columns: 1fr; } .resource-batch__sidebar { border-right: 0; border-bottom: 1px solid var(--batch-border); } .resource-batch__workbench, .resource-batch__panel-grid, .resource-batch__summary, .resource-batch__engine-summary { grid-template-columns: 1fr; } .resource-batch__result-sidebar { position: static; max-height: none; height: auto; } }
        @media (max-width: 840px) { .resource-batch__fields--grid2, .resource-batch__fields--grid3, .resource-batch__fields--grid4, .resource-batch__storage-row { grid-template-columns: 1fr; display: grid; } .resource-batch__workspace { padding: 14px; } .resource-batch__sidebar { padding: 12px; } .resource-batch__result-toolbar { gap: 6px; } }
      `}</style>
    </Modal>
  )
}
