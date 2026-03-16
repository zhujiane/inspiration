import { useEffect, useState } from 'react'
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
import type { TablePaginationConfig } from 'antd/es/table'
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

const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

type LocalMediaMeta = {
  type: 'image' | 'video' | 'audio' | 'other'
  size?: number
  width?: number
  height?: number
  duration?: number
}

const getLocalMediaMeta = async (filePath: string): Promise<LocalMediaMeta> => {
  return (await trpc.system.getLocalMediaMeta.mutate({ filePath })) as LocalMediaMeta
}

/* ============================================================
   Resource Page Component
   ============================================================ */
export default function ResourcePage() {
  const { message, modal } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Resource[]>([])
  const [searchText, setSearchText] = useState('')
  const [keyword, setKeyword] = useState('')
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingResource, setEditingResource] = useState<Partial<Resource> | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [form] = Form.useForm()

  // --- Fetch Data ---
  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await trpc.resource.list.query({
        keyword,
        page: pagination.current,
        pageSize: pagination.pageSize
      })
      setData(result.items as unknown as Resource[])
      setPagination((prev) => ({
        ...prev,
        total: result.total,
        current: result.page,
        pageSize: result.pageSize
      }))
    } catch (error) {
      console.error('Failed to fetch resources:', error)
      message.error('获取素材列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [keyword, pagination.current, pagination.pageSize])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextKeyword = searchText.trim()
      setKeyword((prev) => (prev === nextKeyword ? prev : nextKeyword))
    }, 300)

    return () => window.clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    const handleRefresh = () => {
      fetchData()
    }

    window.addEventListener(RESOURCE_LIBRARY_REFRESH_EVENT, handleRefresh)
    return () => {
      window.removeEventListener(RESOURCE_LIBRARY_REFRESH_EVENT, handleRefresh)
    }
  }, [keyword, pagination.current, pagination.pageSize])

  // --- Handlers ---
  const handleAddLocal = async () => {
    try {
      // 弹出文件选择对话框
      const paths = (await trpc.system.showOpenDialog.mutate({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Media Files',
            extensions: [
              'mp4',
              'mkv',
              'avi',
              'mov',
              'jpg',
              'jpeg',
              'png',
              'gif',
              'webp',
              'bmp',
              'svg',
              'mp3',
              'wav',
              'flac',
              'aac',
              'm4a',
              'ogg'
            ]
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
            else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) type = '图片'
            else if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(extension)) type = '音频'
            else if (meta.type === 'video') type = '视频'
            else if (meta.type === 'image') type = '图片'
            else if (meta.type === 'audio') type = '音频'

            const resource = {
              name: fileName,
              type,
              localPath: filePath,
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
          setPagination((prev) => ({
            ...prev,
            current: prev.current > 1 && data.length === 1 ? prev.current - 1 : prev.current
          }))
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
          setPagination((prev) => ({ ...prev, current: 1 }))
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

  const handleTableChange = (nextPagination: TablePaginationConfig) => {
    setPagination((prev) => ({
      ...prev,
      current: nextPagination.current ?? prev.current,
      pageSize: nextPagination.pageSize ?? prev.pageSize
    }))
  }

  const handleSearchChange = (value: string) => {
    setSearchText(value)
    setPagination((prev) => ({
      ...prev,
      current: 1
    }))
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
      ellipsis: false,
      width: 300,
      render: (name: string, res: Resource) => (
        <div style={{ maxWidth: 300, minWidth: 0 }}>
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
                  flex: 1,
                  minWidth: 0,
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
              width: '100%',
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
        </div>
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
      title: '添加时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (createdAt: string | Date) => formatDateTime(createdAt)
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
            <Badge count={pagination.total} color="blue" />
          </Space>
          <Space>
            <Search
              placeholder="搜索素材名称、类型、描述..."
              allowClear
              value={searchText}
              onSearch={handleSearchChange}
              onChange={(e) => handleSearchChange(e.target.value)}
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
          dataSource={data}
          rowKey="id"
          loading={loading}
          size="small"
          onChange={handleTableChange}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`
          }}
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
