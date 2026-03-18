import { z } from 'zod'

export const batchVideoOperationKeys = [
  'transcode',
  'compress',
  'resize',
  'crop',
  'extractFrames',
  'watermark',
  'trim',
  'audio'
] as const

export type BatchVideoOperationKey = (typeof batchVideoOperationKeys)[number]

export const batchVideoItemSchema = z.object({
  path: z.string().trim().min(1),
  name: z.string().trim().min(1)
})

const transcodeTaskSchema = z.object({
  operation: z.literal('transcode'),
  format: z.enum(['mp4', 'mkv', 'mov', 'webm']),
  quality: z.enum(['high', 'balanced', 'small']),
  preset: z.enum(['fast', 'medium', 'slow'])
})

const compressTaskSchema = z.object({
  operation: z.literal('compress'),
  level: z.enum(['light', 'balanced', 'aggressive']),
  keepAudio: z.boolean().default(true)
})

const resizeTaskSchema = z.object({
  operation: z.literal('resize'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fitMode: z.enum(['contain', 'cover', 'stretch'])
})

const cropTaskSchema = z.object({
  operation: z.literal('crop'),
  mode: z.enum(['autoBlackBars', 'ratio', 'custom']),
  ratioPreset: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional()
})

const extractFramesTaskSchema = z.object({
  operation: z.literal('extractFrames'),
  captureMode: z.enum(['interval', 'fps']),
  everySeconds: z.number().positive().optional(),
  fps: z.number().positive().optional(),
  format: z.enum(['jpg', 'png'])
})

const watermarkTaskSchema = z.object({
  operation: z.literal('watermark'),
  watermarkType: z.enum(['text', 'image']),
  text: z.string().trim().optional(),
  imagePath: z.string().trim().optional(),
  position: z.enum(['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'center']),
  opacity: z.number().min(0.1).max(1),
  margin: z.number().int().min(0).max(200),
  fontSize: z.number().int().min(12).max(120).optional(),
  imageScalePercent: z.number().int().min(5).max(60).optional()
})

const trimTaskSchema = z.object({
  operation: z.literal('trim'),
  startTime: z.string().trim().min(1),
  endMode: z.enum(['duration', 'endTime']),
  duration: z.string().trim().optional(),
  endTime: z.string().trim().optional()
})

const audioTaskSchema = z.object({
  operation: z.literal('audio'),
  audioMode: z.enum(['remove', 'extract']),
  format: z.enum(['mp3', 'wav', 'aac', 'flac']).optional(),
  bitrate: z.enum(['128k', '192k', '256k']).optional()
})

export const batchVideoTaskSchema = z.discriminatedUnion('operation', [
  transcodeTaskSchema,
  compressTaskSchema,
  resizeTaskSchema,
  cropTaskSchema,
  extractFramesTaskSchema,
  watermarkTaskSchema,
  trimTaskSchema,
  audioTaskSchema
])

export const batchVideoProcessSchema = z.object({
  items: z.array(batchVideoItemSchema).min(1),
  outputDir: z.string().trim().min(1),
  task: batchVideoTaskSchema
})

export type BatchVideoItemInput = z.infer<typeof batchVideoItemSchema>
export type BatchVideoTaskInput = z.infer<typeof batchVideoTaskSchema>
export type BatchVideoProcessInput = z.infer<typeof batchVideoProcessSchema>

export type BatchVideoProcessResultItem = {
  inputPath: string
  inputName: string
  outputPaths: string[]
  outputDir: string
  status: 'success' | 'error'
  error?: string
}

export type VideoAdapterVendor = 'nvidia' | 'intel' | 'amd' | 'other'
export type VideoAdapterKind = 'discrete' | 'integrated' | 'virtual' | 'unknown'
export type VideoProcessingEncoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264'

export type VideoAdapterInfo = {
  name: string
  vendor: VideoAdapterVendor
  kind: VideoAdapterKind
  isVirtual: boolean
  isPreferred: boolean
}

export type VideoProcessingStrategy = {
  acceleration: 'gpu' | 'cpu'
  encoder: VideoProcessingEncoder
  vendor: VideoAdapterVendor | 'cpu'
  deviceName?: string
  deviceKind?: VideoAdapterKind
  title: string
  description: string
  ffmpegArgs: string[]
  commandExample: string
}

export type VideoProcessingCapability = {
  platform: string
  detectedAt: string
  availableEncoders: string[]
  adapters: VideoAdapterInfo[]
  preferredStrategy: VideoProcessingStrategy
}

export type BatchVideoProcessTaskState = 'pending' | 'running' | 'completed' | 'failed'

export type BatchVideoProcessStatus = {
  taskId: string
  state: BatchVideoProcessTaskState
  outputDir: string
  totalItems: number
  completedItems: number
  successCount: number
  errorCount: number
  percent: number
  currentItemIndex?: number
  currentItemName?: string
  currentCommand?: string
  message: string
  startedAt: string
  updatedAt: string
  finishedAt?: string
  results: BatchVideoProcessResultItem[]
  capability: VideoProcessingCapability
}
