import { useEffect, useMemo, useState } from 'react'
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
  TagsOutlined,
  VideoCameraOutlined,
  FileImageOutlined,
  AudioOutlined,
  FileTextOutlined,
  EllipsisOutlined
} from '@ant-design/icons'
import { trpc } from '../lib/trpc'
import { buildPreviewProxyUrl } from '../lib/media'
import type { Resource } from '@shared/db/resource-schema'
import type { Tag as ResourceTag } from '@shared/db/tag-schema'
import { formatDuration, formatSize } from '@shared/utils/format'
import SmartVideo from '../components/Media/SmartVideo'
import PreviewModal from '../components/PreviewModal'

const { Search } = Input
const RESOURCE_LIBRARY_REFRESH_EVENT = 'resource-library:refresh'
const TAG_COLORS = ['blue', 'green', 'gold', 'magenta', 'cyan', 'orange', 'geekblue', 'lime'] as const

type ResourceRecord = Resource & {
  createdAt: string | Date
  updatedAt: string | Date
  tags?: ResourceTag[]
}

/* ============================================================
   Formatters
   ============================================================ */
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
  container?: string
  mimeType?: string
  videoCodec?: string
  audioCodec?: string
  browserPlayable?: boolean
  cover?: string
}

const getLocalMediaMeta = async (filePath: string): Promise<LocalMediaMeta> => {
  return (await trpc.system.getLocalMediaMeta.mutate({ filePath })) as LocalMediaMeta
}

const parseResourceMeta = (metadata?: string | null): LocalMediaMeta | null => {
  if (!metadata) return null

  try {
    return JSON.parse(metadata) as LocalMediaMeta
  } catch (error) {
    console.error('Failed to parse resource metadata:', error)
    return null
  }
}

const getTypeTagColor = (type?: string) => {
  if (type === '视频') return 'blue'
  if (type === '图片') return 'green'
  if (type === '音频') return 'purple'
  return 'default'
}

function ResourceKeywordSearch({
  initialValue = '',
  onKeywordChange
}: {
  initialValue?: string
  onKeywordChange: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onKeywordChange(value.trim())
    }, 300)

    return () => window.clearTimeout(timer)
  }, [value, onKeywordChange])

  return (
    <Search
      placeholder="搜索素材名称、类型、描述..."
      allowClear
      value={value}
      onChange={(e) => setValue(e.target.value)}
      style={{ width: 250 }}
      prefix={<SearchOutlined />}
    />
  )
}

/* ============================================================
   Resource Page Component
   ============================================================ */
export default function ResourcePage() {
  const { message, modal } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ResourceRecord[]>([])
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([])
  const [keyword, setKeyword] = useState('')
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([])
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBatchTagModalOpen, setIsBatchTagModalOpen] = useState(false)
  const [batchTagSubmitting, setBatchTagSubmitting] = useState(false)
  const [editingResource, setEditingResource] = useState<ResourceRecord | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [form] = Form.useForm()
  const [batchTagForm] = Form.useForm()
  const watchedName = Form.useWatch('name', form)
  const watchedType = Form.useWatch('type', form)
  const watchedPlatform = Form.useWatch('platform', form)
  const watchedTagNames = Form.useWatch('tagNames', form)
  const watchedDescription = Form.useWatch('description', form)
  const editingMeta = useMemo(() => parseResourceMeta(editingResource?.metadata), [editingResource?.metadata])
  const editingPreviewSrc = editingResource?.localPath || editingResource?.url || undefined
  const editingImageSrc = buildPreviewProxyUrl(editingResource?.cover || editingPreviewSrc)
  const editingAudioSrc = buildPreviewProxyUrl(editingPreviewSrc)
  const currentEditName = watchedName || editingResource?.name || '未命名素材'
  const currentEditType = watchedType || editingResource?.type || '其他'
  const currentEditPlatform = watchedPlatform || editingResource?.platform || '未填写平台来源'
  const currentEditTagNames =
    (watchedTagNames as string[] | undefined) ?? editingResource?.tags?.map((tag) => tag.name) ?? []
  const currentEditDescription = watchedDescription || editingResource?.description || '暂无备注说明'

  // --- Fetch Data ---
  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await trpc.resource.list.query({
        keyword,
        tagNames: selectedTagNames,
        page: pagination.current,
        pageSize: pagination.pageSize
      })
      setData(result.items as unknown as ResourceRecord[])
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

  const fetchTagOptions = async () => {
    try {
      const result = await trpc.tag.list.query({ type: 'resource' })
      setTagOptions(
        result.map((item) => ({
          label: item.name,
          value: item.name
        }))
      )
    } catch (error) {
      console.error('Failed to fetch tags:', error)
      message.error('获取标签失败')
    }
  }

  useEffect(() => {
    fetchData()
  }, [keyword, selectedTagNames, pagination.current, pagination.pageSize])

  useEffect(() => {
    fetchTagOptions()
  }, [])

  useEffect(() => {
    const handleRefresh = () => {
      fetchData()
    }

    window.addEventListener(RESOURCE_LIBRARY_REFRESH_EVENT, handleRefresh)
    return () => {
      window.removeEventListener(RESOURCE_LIBRARY_REFRESH_EVENT, handleRefresh)
    }
  }, [keyword, selectedTagNames, pagination.current, pagination.pageSize])

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
              cover: meta.cover,
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

  const handleEdit = (resource: ResourceRecord) => {
    setEditingResource(resource)
    form.setFieldsValue({
      ...resource,
      tagNames: resource.tags?.map((tag) => tag.name) ?? []
    })
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

  const handleOpenBatchTagModal = () => {
    if (selectedRowKeys.length === 0) return
    batchTagForm.setFieldsValue({ tagNames: [] })
    setIsBatchTagModalOpen(true)
  }

  const handleBatchTagSubmit = async () => {
    try {
      const values = await batchTagForm.validateFields()
      const nextTagNames = (values.tagNames ?? []).filter(Boolean)
      if (nextTagNames.length === 0) {
        message.warning('请选择至少一个标签')
        return
      }

      setBatchTagSubmitting(true)

      const resourceIds = selectedRowKeys.map((id) => Number(id))
      const currentTagsList = await Promise.all(
        resourceIds.map((mapId) =>
          trpc.tag.getMapTags.query({
            type: 'resource',
            mapId
          })
        )
      )

      await Promise.all(
        resourceIds.map((mapId, index) => {
          const mergedTagNames = Array.from(
            new Set([...(currentTagsList[index] ?? []).map((tag) => tag.name), ...nextTagNames])
          )

          return trpc.tag.setMapTags.mutate({
            type: 'resource',
            mapId,
            tagNames: mergedTagNames
          })
        })
      )

      message.success(`已为 ${resourceIds.length} 个素材添加标签`)
      setIsBatchTagModalOpen(false)
      batchTagForm.resetFields()
      await fetchTagOptions()
      await fetchData()
    } catch (error) {
      console.error('Batch tag submit error:', error)
      message.error('批量添加标签失败')
    } finally {
      setBatchTagSubmitting(false)
    }
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
        const { tagNames = [], ...resourceValues } = values
        await trpc.resource.update.mutate({ ...editingResource, ...resourceValues, id: editingResource.id })
        await trpc.tag.setMapTags.mutate({
          type: 'resource',
          mapId: editingResource.id,
          tagNames
        })
        message.success('更新成功')
        await fetchTagOptions()
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
    setKeyword((prev) => (prev === value ? prev : value))
    setPagination((prev) => ({
      ...prev,
      current: 1
    }))
  }

  const handleTagFilterChange = (values: string[]) => {
    setSelectedTagNames(values)
    setPagination((prev) => ({
      ...prev,
      current: 1
    }))
  }

  const renderEditingPreview = () => {
    if (!editingResource) {
      return <div className="resource-edit-modal__empty">请选择要编辑的素材</div>
    }

    if (editingResource.type === '视频' && editingPreviewSrc) {
      return (
        <SmartVideo
          src={editingPreviewSrc}
          controls
          playsInline
          preload="metadata"
          poster={editingResource.cover || undefined}
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#111827' }}
        />
      )
    }

    if (editingResource.type === '图片' && editingImageSrc) {
      return <img src={editingImageSrc} alt={currentEditName} className="resource-edit-modal__image" />
    }

    if (editingResource.type === '音频' && editingAudioSrc) {
      return (
        <div className="resource-edit-modal__audio">
          <div className="resource-edit-modal__audio-icon">
            <AudioOutlined />
          </div>
          <div className="resource-edit-modal__audio-name">{currentEditName}</div>
          <audio src={editingAudioSrc} controls preload="metadata" style={{ width: '100%' }} />
        </div>
      )
    }

    if (editingImageSrc) {
      return <img src={editingImageSrc} alt={currentEditName} className="resource-edit-modal__image" />
    }

    return (
      <div className="resource-edit-modal__empty">
        {editingPreviewSrc ? '当前素材暂不支持内嵌预览' : '该素材暂无可预览内容'}
      </div>
    )
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
      render: (name: string, res: ResourceRecord) => (
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
              <Tag color={getTypeTagColor(res.type)} style={{ marginRight: 0, flexShrink: 0 }}>
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
          {res.tags && res.tags.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 4 }}>
              {res.tags.map((tag, index) => (
                <Tag key={tag.id} color={TAG_COLORS[index % TAG_COLORS.length]} style={{ marginRight: 0 }}>
                  {tag.name}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )
    },
    {
      title: '属性',
      key: 'properties',
      width: 150,
      render: (res: Resource) => {
        const meta = parseResourceMeta(res.metadata)
        if (!meta) return '-'
        return (
          <Space orientation="vertical" size={0} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {meta.size && <div>大小: {formatSize(meta.size)}</div>}
            {meta.width && (
              <div>
                分辨率: {meta.width}x{meta.height}
              </div>
            )}
            {meta.duration && res.type !== '图片' && <div>时长: {formatDuration(meta.duration) || '-'}</div>}
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
            <ResourceKeywordSearch initialValue={keyword} onKeywordChange={handleSearchChange} />
            <Select
              mode="multiple"
              allowClear
              placeholder="按标签筛选"
              value={selectedTagNames}
              options={tagOptions}
              onDropdownVisibleChange={(open) => {
                if (open) fetchTagOptions()
              }}
              onChange={handleTagFilterChange}
              style={{ width: 160 }}
              maxTagCount="responsive"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddLocal} loading={loading}>
              添加本地素材
            </Button>
            {selectedRowKeys.length > 0 && (
              <Button icon={<TagsOutlined />} onClick={handleOpenBatchTagModal}>
                批量加标签 ({selectedRowKeys.length})
              </Button>
            )}
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
        title={`批量添加标签 (${selectedRowKeys.length} 个素材)`}
        open={isBatchTagModalOpen}
        onOk={handleBatchTagSubmit}
        onCancel={() => setIsBatchTagModalOpen(false)}
        okText="添加"
        cancelText="取消"
        confirmLoading={batchTagSubmitting}
        centered
        width={500}
      >
        <Form form={batchTagForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="tagNames"
            label="标签"
            rules={[{ required: true, message: '请至少选择一个标签' }]}
            extra="会在保留原有标签的基础上，追加到所有已选素材"
          >
            <Select mode="tags" placeholder="输入后回车创建标签" options={tagOptions} tokenSeparators={[',', '，']} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑素材记录"
        open={isModalOpen}
        onOk={handleModalSubmit}
        onCancel={() => setIsModalOpen(false)}
        okText="保存"
        cancelText="取消"
        centered
        width={1080}
        destroyOnHidden
        styles={{ body: { padding: 0, maxHeight: '78vh', overflow: 'hidden' } }}
      >
        <div className="resource-edit-modal">
          <div className="resource-edit-modal__preview-pane">
            <div className="resource-edit-modal__header">
              <div style={{ minWidth: 0 }}>
                <div className="resource-edit-modal__title-row">
                  <h3>{currentEditName}</h3>
                  <Tag color={getTypeTagColor(currentEditType)} style={{ marginRight: 0 }}>
                    {currentEditType}
                  </Tag>
                </div>
                <div className="resource-edit-modal__subline">
                  <span>上传时间：{formatDateTime(editingResource?.createdAt)}</span>
                  <span>平台：{currentEditPlatform}</span>
                </div>
              </div>
            </div>

            <div className="resource-edit-modal__viewer">{renderEditingPreview()}</div>

            <div className="resource-edit-modal__section">
              <div className="resource-edit-modal__section-title">素材标签</div>
              <div className="resource-edit-modal__tags">
                {currentEditTagNames.length > 0 ? (
                  currentEditTagNames.map((tagName, index) => (
                    <Tag
                      key={`${tagName}-${index}`}
                      color={TAG_COLORS[index % TAG_COLORS.length]}
                      style={{ marginRight: 0 }}
                    >
                      {tagName}
                    </Tag>
                  ))
                ) : (
                  <span className="resource-edit-modal__placeholder">暂未设置标签</span>
                )}
              </div>
            </div>

            <div className="resource-edit-modal__stats">
              <div className="resource-edit-modal__stat-card">
                <span className="resource-edit-modal__stat-label">时长</span>
                <strong>{editingMeta?.duration ? formatDuration(editingMeta.duration) : '-'}</strong>
              </div>
              <div className="resource-edit-modal__stat-card">
                <span className="resource-edit-modal__stat-label">分辨率</span>
                <strong>
                  {editingMeta?.width && editingMeta?.height ? `${editingMeta.width} x ${editingMeta.height}` : '-'}
                </strong>
              </div>
              <div className="resource-edit-modal__stat-card">
                <span className="resource-edit-modal__stat-label">大小</span>
                <strong>{editingMeta?.size ? formatSize(editingMeta.size) : '-'}</strong>
              </div>
            </div>

            <div className="resource-edit-modal__section">
              <div className="resource-edit-modal__section-title">素材说明</div>
              <div className="resource-edit-modal__description">{currentEditDescription}</div>
            </div>
          </div>

          <div className="resource-edit-modal__form-pane">
            <div className="resource-edit-modal__form-title">编辑信息</div>
            <Form form={form} layout="vertical" className="resource-edit-modal__form">
              <div className="resource-edit-modal__form-block">
                <div className="resource-edit-modal__block-title">基础信息</div>
                <Form.Item name="name" label="素材名称" rules={[{ required: true, message: '请输入素材名称' }]}>
                  <Input size="large" />
                </Form.Item>
                <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
                  <Select
                    size="large"
                    options={[
                      { value: '视频', label: '视频' },
                      { value: '图片', label: '图片' },
                      { value: '音频', label: '音频' },
                      { value: '其他', label: '其他' }
                    ]}
                  />
                </Form.Item>
                <Form.Item name="platform" label="平台来源">
                  <Input size="large" placeholder="例如：本地、抖音、YouTube..." />
                </Form.Item>
              </div>

              <div className="resource-edit-modal__form-block">
                <div className="resource-edit-modal__block-title">标签设置</div>
                <Form.Item name="tagNames" label="标签">
                  <Select
                    mode="tags"
                    size="large"
                    placeholder="输入后回车创建标签"
                    options={tagOptions}
                    tokenSeparators={[',', '，']}
                  />
                </Form.Item>
              </div>

              <div className="resource-edit-modal__form-block">
                <div className="resource-edit-modal__block-title">备注说明</div>
                <Form.Item name="description" label="备注说明" style={{ marginBottom: 0 }}>
                  <Input.TextArea autoSize={{ minRows: 6, maxRows: 10 }} placeholder="补充素材背景、用途或使用说明" />
                </Form.Item>
              </div>
            </Form>
          </div>
        </div>
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
        .resource-edit-modal {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) 360px;
          min-height: 680px;
          background: linear-gradient(180deg, #ffffff 0%, #fafcff 100%);
        }
        .resource-edit-modal__preview-pane {
          padding: 24px;
          border-right: 1px solid rgba(5, 5, 5, 0.08);
          display: flex;
          flex-direction: column;
          gap: 20px;
          min-width: 0;
          overflow: auto;
        }
        .resource-edit-modal__form-pane {
          padding: 24px 20px;
          background: linear-gradient(180deg, #fcfdff 0%, #f5f8ff 100%);
          overflow: auto;
        }
        .resource-edit-modal__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }
        .resource-edit-modal__title-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          margin-bottom: 8px;
        }
        .resource-edit-modal__title-row h3 {
          margin: 0;
          font-size: 24px;
          line-height: 1.25;
          color: #1f2937;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .resource-edit-modal__subline {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          color: #6b7280;
          font-size: 13px;
        }
        .resource-edit-modal__viewer {
          height: 380px;
          border-radius: 18px;
          overflow: hidden;
          background:
            radial-gradient(circle at top, rgba(59, 130, 246, 0.2), transparent 42%),
            linear-gradient(135deg, #101828 0%, #1f2937 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        .resource-edit-modal__image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        .resource-edit-modal__audio,
        .resource-edit-modal__empty {
          width: 100%;
          max-width: 420px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          color: #f3f4f6;
          text-align: center;
        }
        .resource-edit-modal__audio-icon {
          width: 88px;
          height: 88px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36px;
          background: rgba(255, 255, 255, 0.12);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        }
        .resource-edit-modal__audio-name {
          font-size: 18px;
          font-weight: 600;
        }
        .resource-edit-modal__section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .resource-edit-modal__section-title,
        .resource-edit-modal__form-title,
        .resource-edit-modal__block-title {
          font-weight: 600;
          color: #111827;
        }
        .resource-edit-modal__tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .resource-edit-modal__placeholder {
          color: #9ca3af;
          font-size: 13px;
        }
        .resource-edit-modal__stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .resource-edit-modal__stat-card {
          padding: 14px 16px;
          border-radius: 14px;
          background: #f7faff;
          border: 1px solid rgba(22, 119, 255, 0.12);
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .resource-edit-modal__stat-card strong {
          color: #111827;
          font-size: 15px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .resource-edit-modal__stat-label {
          color: #6b7280;
          font-size: 12px;
        }
        .resource-edit-modal__description {
          padding: 14px 16px;
          border-radius: 14px;
          background: #f8fafc;
          color: #4b5563;
          line-height: 1.7;
          white-space: pre-wrap;
        }
        .resource-edit-modal__paths {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .resource-edit-modal__path-row {
          display: grid;
          grid-template-columns: 72px minmax(0, 1fr);
          gap: 12px;
          align-items: start;
          font-size: 13px;
          color: #6b7280;
        }
        .resource-edit-modal__path-row code {
          padding: 10px 12px;
          border-radius: 12px;
          background: #f8fafc;
          color: #334155;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .resource-edit-modal__form-title {
          font-size: 18px;
          margin-bottom: 16px;
        }
        .resource-edit-modal__form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .resource-edit-modal__form-block {
          padding: 16px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.86);
          border: 1px solid rgba(148, 163, 184, 0.18);
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
        }
        .resource-edit-modal__block-title {
          margin-bottom: 14px;
          font-size: 15px;
        }
        .resource-edit-modal__form-block .ant-form-item:last-child {
          margin-bottom: 0;
        }
        @media (max-width: 960px) {
          .resource-edit-modal {
            grid-template-columns: 1fr;
            min-height: auto;
          }
          .resource-edit-modal__preview-pane {
            border-right: 0;
            border-bottom: 1px solid rgba(5, 5, 5, 0.08);
          }
          .resource-edit-modal__stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
