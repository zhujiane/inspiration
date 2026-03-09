export type ProbeStream = {
  codec_type?: string
  width?: number
  height?: number
  codec_name?: string
  codec_tag_string?: string
  disposition?: {
    attached_pic?: number | boolean
  }
}

export type ProbeMetadata = {
  format?: {
    format_name?: string
    duration?: string | number
  }
  streams?: ProbeStream[]
}

export type AnalyzeResult = {
  type: 'image' | 'video' | 'audio' | 'other'
  size: number
  width?: number
  height?: number
  duration?: number
  format?: string
  videoCodec?: string
  audioCodec?: string
  md5?: string
  cover?: string
}

export type AnalyzeInput = {
  path: string
  header?: Record<string, string>
}
