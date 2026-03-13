import { useState, useEffect, useMemo } from 'react'
import {
  Table,
  Button,
  Input,
  Space,
  Tag,
  Modal,
  Form,
  Select,
  App as AntdApp,
  Tooltip,
  Empty,
  Card,
  Badge
} from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  PlayCircleOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  EditOutlined,
  VideoCameraOutlined,
  FileImageOutlined,
  AudioOutlined,
  FileTextOutlined,
  EllipsisOutlined
} from '@ant-design/icons'
import { trpc } from '../lib/trpc'
import type { Resource } from '@shared/db/resource-schema'
import PreviewModal from '../components/PreviewModal'

const { Search } = Input
const RESOURCE_LIBRARY_REFRESH_EVENT = 'resource-library:refresh'

/* ============================================================
   Formatters
   ============================================================ */
const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDuration = (seconds: number) => {
  if (!seconds) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return [h, m, s]
    .map((v) => (v < 10 ? '0' + v : v))
    .filter((v, i) => v !== '00' || i > 0)
    .join(':')
}

type LocalMediaMeta = {
  type: 'image' | 'video' | 'audio' | 'other'
  size?: number
  width?: number
  height?: number
  duration?: number
  cover?: string
}

const createFileUrl = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('file://') ? normalized : `file:///${normalized}`
}

const readLocalFileSize = async (fileUrl: string): Promise<number | undefined> => {
  try {
    const response = await fetch(fileUrl)
    const blob = await response.blob()
    return blob.size
  } catch {
    return undefined
  }
}

const loadImageMeta = async (fileUrl: string): Promise<Pick<LocalMediaMeta, 'width' | 'height' | 'cover'>> =>
  await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({
        width: image.naturalWidth || undefined,
        height: image.naturalHeight || undefined,
        cover: fileUrl
      })
    }
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = fileUrl
  })

const captureVideoCover = async (video: HTMLVideoElement): Promise<string | undefined> => {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return undefined
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return undefined
  }
}

const loadMediaElementMeta = async (
  fileUrl: string,
  tagName: 'video' | 'audio'
): Promise<Pick<LocalMediaMeta, 'width' | 'height' | 'duration' | 'cover' | 'type'>> =>
  await new Promise((resolve, reject) => {
    const media = document.createElement(tagName)
    media.preload = 'metadata'
    media.crossOrigin = 'anonymous'

    const cleanup = () => {
      media.pause()
      media.removeAttribute('src')
      media.load()
    }

    media.onloadedmetadata = async () => {
      const hasVideo =
        tagName === 'video' && media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0
      const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined
      const cover = hasVideo ? await captureVideoCover(media as HTMLVideoElement) : undefined

      resolve({
        type: hasVideo ? 'video' : 'audio',
        width: hasVideo ? (media as HTMLVideoElement).videoWidth : undefined,
        height: hasVideo ? (media as HTMLVideoElement).videoHeight : undefined,
        duration,
        cover
      })
      cleanup()
    }

    media.onerror = () => {
      cleanup()
      reject(new Error(`${tagName} metadata load failed`))
    }

    media.src = fileUrl
  })

const getLocalMediaMeta = async (filePath: string): Promise<LocalMediaMeta> => {
  const fileUrl = createFileUrl(filePath)
  const extension = filePath.split('.').pop()?.toLowerCase() || ''
  const size = await readLocalFileSize(fileUrl)

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) {
    const imageMeta = await loadImageMeta(fileUrl)
    return { type: 'image', size, ...imageMeta }
  }

  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(extension)) {
    const audioMeta = await loadMediaElementMeta(fileUrl, 'audio')
    return { size, ...audioMeta }
  }

  try {
    const videoMeta = await loadMediaElementMeta(fileUrl, 'video')
    return { size, ...videoMeta }
  } catch {
    return { type: 'other', size }
  }
}

/* ============================================================
   Resource Page Component
   ============================================================ */
export default function ResourcePage() {
  const { message, modal } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Resource[]>([])
  const [searchText, setSearchText] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingResource, setEditingResource] = useState<Partial<Resource> | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [form] = Form.useForm()

  // --- Fetch Data ---
  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await trpc.resource.list.query()
      setData(result as any)
    } catch (error) {
      console.error('Failed to fetch resources:', error)
      message.error('获取素材列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    const handleRefresh = () => {
      fetchData()
    }

    window.addEventListener(RESOURCE_LIBRARY_REFRESH_EVENT, handleRefresh)
    return () => {
      window.removeEventListener(RESOURCE_LIBRARY_REFRESH_EVENT, handleRefresh)
    }
  }, [])

  // --- Filtered Data ---
  const filteredData = useMemo(() => {
    if (!searchText) return data
    const term = searchText.toLowerCase()
    return data.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        item.type.toLowerCase().includes(term) ||
        (item.description && item.description.toLowerCase().includes(term))
    )
  }, [data, searchText])

  // --- Handlers ---
  const handleAddLocal = async () => {
    try {
      // 弹出文件选择对话框
      const paths = (await trpc.system.showOpenDialog.mutate({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Media Files',
            extensions: ['mp4', 'mkv', 'avi', 'mov', 'jpg', 'jpeg', 'png', 'gif', 'mp3', 'wav', 'flac']
          }
        ]
      })) as string[]

      if (paths && paths.length > 0) {
        setLoading(true)
        for (const filePath of paths) {
          try {
            const meta = await getLocalMediaMeta(filePath)
            const fileName = filePath.split(/[\\/]/).pop() || '未知文件'
            const extension = fileName.split('.').pop()?.toLowerCase() || ''

            let type = '其他'
            if (['mp4', 'mkv', 'avi', 'mov'].includes(extension)) type = '视频'
            else if (['jpg', 'jpeg', 'png', 'gif'].includes(extension)) type = '图片'
            else if (['mp3', 'wav', 'flac'].includes(extension)) type = '音频'
            else if (meta.type === 'video') type = '视频'
            else if (meta.type === 'image') type = '图片'
            else if (meta.type === 'audio') type = '音频'

            const resource = {
              name: fileName,
              type,
              localPath: filePath,
              cover: meta.cover,
              platform: '本地',
              metadata: JSON.stringify(meta),
              description: `从本地添加: ${filePath}`
            }

            // 创建素材记录
            await trpc.resource.create.mutate(resource)
          } catch (e) {
            console.error(`Failed to add ${filePath}:`, e)
            message.error(`添加 ${filePath} 失败`)
          }
        }
        message.success(`成功添加 ${paths.length} 个素材`)
        fetchData()
      }
    } catch (error) {
      console.error('Failed to add local materials:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (resource: Resource) => {
    setEditingResource(resource)
    form.setFieldsValue(resource)
    setIsModalOpen(true)
  }

  const handleDelete = (id: number) => {
    modal.confirm({
      title: '确定删除该素材吗？',
      content: '此操作不可撤销',
      okText: '确定',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await trpc.resource.delete.mutate({ id })
          message.success('删除成功')
          fetchData()
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return
    modal.confirm({
      title: `确定删除选中的 ${selectedRowKeys.length} 个素材吗？`,
      okText: '确定',
      okType: 'danger',
      onOk: async () => {
        try {
          for (const id of selectedRowKeys) {
            await trpc.resource.delete.mutate({ id: id as number })
          }
          message.success('批量删除成功')
          setSelectedRowKeys([])
          fetchData()
        } catch (error) {
          message.error('部分素材删除失败')
        }
      }
    })
  }

  const handleOpenFolder = async (path: string) => {
    try {
      await trpc.system.openFolder.mutate({ path })
    } catch (error) {
      message.error('无法打开文件夹: ' + (error as any).message)
    }
  }

  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewResource, setPreviewResource] = useState<Resource | null>(null)

  const handlePlay = (resource: Resource) => {
    setPreviewResource(resource)
    setPreviewVisible(true)
  }

  const handleModalSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingResource?.id) {
        await trpc.resource.update.mutate({ ...editingResource, ...values, id: editingResource.id })
        message.success('更新成功')
      }
      setIsModalOpen(false)
      fetchData()
    } catch (error) {
      console.error('Submit error:', error)
    }
  }

  // --- Table Columns ---
  const columns = [
    {
      title: '预览',
      key: 'cover',
      width: 100,
      render: (res: Resource) => {
        const typeIcons: Record<string, React.ReactNode> = {
          视频: <VideoCameraOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
          图片: <FileImageOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
          音频: <AudioOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
          文本: <FileTextOutlined style={{ fontSize: 24, color: '#faad14' }} />
        }
        return (
          <div
            className="resource-table__cover"
            onClick={() => handlePlay(res)}
            style={{ cursor: 'pointer', position: 'relative' }}
          >
            {res.cover ? (
              <img src={res.cover} alt="" style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4 }} />
            ) : (
              <div
                style={{
                  width: 80,
                  height: 45,
                  background: 'var(--color-bg-layout)',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {typeIcons[res.type as keyof typeof typeIcons] || <EllipsisOutlined />}
              </div>
            )}
            <div className="resource-table__cover-overlay">
              <PlayCircleOutlined />
            </div>
          </div>
        )
      }
    },
    {
      title: '素材名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, res: Resource) => (
        <Space orientation="vertical" size={0} style={{ maxWidth: 350 }}>
          <Tooltip title={name}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
                color: 'var(--color-text)',
                fontSize: 14
              }}
            >
              <Tag
                color={
                  res.type === '视频'
                    ? 'blue'
                    : res.type === '图片'
                      ? 'green'
                      : res.type === '音频'
                        ? 'purple'
                        : 'default'
                }
                style={{ marginRight: 0, flexShrink: 0 }}
              >
                {res.type}
              </Tag>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {name}
              </span>
            </div>
          </Tooltip>
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-description)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingLeft: 4
            }}
            title={res.localPath || res.url || undefined}
          >
            {res.localPath || res.url}
          </div>
        </Space>
      )
    },
    {
      title: '属性',
      key: 'properties',
      width: 150,
      render: (res: Resource) => {
        const meta = res.metadata ? JSON.parse(res.metadata) : null
        if (!meta) return '-'
        return (
          <Space orientation="vertical" size={0} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {meta.size && <div>大小: {formatSize(meta.size)}</div>}
            {meta.width && (
              <div>
                分辨率: {meta.width}x{meta.height}
              </div>
            )}
            {meta.duration && res.type !== '图片' && <div>时长: {formatDuration(meta.duration)}</div>}
          </Space>
        )
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (res: Resource) => (
        <Space>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(res)} />
          </Tooltip>
          <Tooltip title="打开文件位置">
            <Button
              size="small"
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={() => handleOpenFolder(res.localPath || '')}
              disabled={!res.localPath}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(res.id)} />
          </Tooltip>
        </Space>
      )
    }
  ]

  return (
    <div
      className="resource-page"
      style={{
        height: '100%',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        background: 'var(--color-bg-layout)',
        overflow: 'auto'
      }}
    >
      <Card variant="borderless" styles={{ body: { padding: '16px' } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Space size="middle">
            <h2 style={{ margin: 0, fontSize: 18 }}>素材库</h2>
            <Badge count={filteredData.length} color="blue" />
          </Space>
          <Space>
            <Search
              placeholder="搜索素材名称、类型、描述..."
              allowClear
              onSearch={setSearchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 250 }}
              prefix={<SearchOutlined />}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddLocal} loading={loading}>
              添加本地素材
            </Button>
            {selectedRowKeys.length > 0 && (
              <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
          </Space>
        </div>

        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys
          }}
          columns={columns as any}
          dataSource={filteredData}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: <Empty description="暂无素材，点击上方按钮添加" /> }}
        />
      </Card>

      <PreviewModal
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        title={previewResource?.name}
        type={previewResource?.type}
        src={previewResource?.localPath || previewResource?.url || undefined}
        cover={previewResource?.cover || undefined}
      />

      <Modal
        title="编辑素材记录"
        open={isModalOpen}
        onOk={handleModalSubmit}
        onCancel={() => setIsModalOpen(false)}
        okText="保存"
        cancelText="取消"
        centered
        width={500}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="素材名称" rules={[{ required: true, message: '请输入素材名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              options={[
                { value: '视频', label: '视频' },
                { value: '图片', label: '图片' },
                { value: '音频', label: '音频' },
                { value: '其他', label: '其他' }
              ]}
            />
          </Form.Item>
          <Form.Item name="platform" label="平台来源">
            <Input placeholder="例如：本地, 抖音, YouTube..." />
          </Form.Item>
          <Form.Item name="description" label="备注说明">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .resource-table__cover-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 80px;
          height: 45px;
          background: rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          opacity: 0;
          transition: opacity 0.2s;
          color: #fff;
          font-size: 20px;
        }
        .resource-table__cover:hover .resource-table__cover-overlay {
          opacity: 1;
        }
        .resource-page .ant-card {
          background: var(--color-bg-container);
        }
      `}</style>
    </div>
  )
}
