import { useEffect, useState } from 'react'
import { Tooltip, Progress, Modal, Select, InputNumber, Button, Space, message, Popconfirm, Dropdown } from 'antd'
import {
  CheckSquareOutlined,
  ClearOutlined,
  MergeCellsOutlined,
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
  FilterOutlined,
  RadarChartOutlined,
  LoadingOutlined,
  UndoOutlined,
  CloseOutlined,
  MoreOutlined
} from '@ant-design/icons'
import MediaCard from './MediaCard'
import type { MediaResource } from './MediaCard'
import BatchActionModal from './BatchActionModal'
import type { BatchActionItem } from './BatchActionModal'
import { trpc } from '../../lib/trpc'

export interface AdvancedSearchFilters {
  type: Array<'all' | 'image' | 'video' | 'audio'>
  minWidth: number
  minHeight: number
  minSize: number // KB
  minDuration: number // seconds
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedSearchFilters = {
  type: ['video', 'audio'],
  minWidth: 0,
  minHeight: 0,
  minSize: 0, // 100KB
  minDuration: 0 // 5s
}

export const EMPTY_ADVANCED_FILTERS: AdvancedSearchFilters = {
  type: ['video', 'audio'],
  minWidth: 0,
  minHeight: 0,
  minSize: 0,
  minDuration: 0
}

export interface SnifferStats {
  active: boolean
  sniffedCount: number
  identifiedCount: number
  discardedCount: number
  /** 精确的正在分析中数量（来自主进程 analyzingUrls.size） */
  analyzingCount?: number
  discardedUrls?: string[]
}

interface SnifferPanelProps {
  resources: MediaResource[]
  collapsed: boolean
  searchText: string
  stats?: SnifferStats
  advancedFilters?: AdvancedSearchFilters
  mergeTasks?: BatchActionItem[]
  mergeModalVisible?: boolean
  mergeSubmitting?: boolean
  downloadTasks?: BatchActionItem[]
  downloadModalVisible?: boolean
  downloadSubmitting?: boolean
  onToggle: () => void
  onSearchChange?: (text: string) => void
  onSelectAll?: () => void
  onInvertSelect?: () => void
  onClearAll?: () => void
  onMerge?: () => void
  onMergeCancel?: () => void
  onMergeConfirm?: () => void
  onBatchDownload?: () => void
  onBatchDownloadCancel?: () => void
  onBatchDownloadConfirm?: () => void
  onAdvancedSearch?: () => void
  onAdvancedFiltersChange?: (filters: AdvancedSearchFilters) => void
  onResourceSelect?: (id: string, selected: boolean) => void
  onResourceDelete?: (id: string) => void
  onResourcePreview?: (id: string) => void
  onResourceDownload?: (id: string) => void
  onResourceCopyUrl?: (id: string) => void
}

export default function SnifferPanel({
  resources,
  collapsed,
  searchText,
  stats,
  advancedFilters,
  mergeTasks = [],
  mergeModalVisible = false,
  mergeSubmitting = false,
  downloadTasks = [],
  downloadModalVisible = false,
  downloadSubmitting = false,
  onToggle,
  onSearchChange,
  onInvertSelect,
  onClearAll,
  onMerge,
  onMergeCancel,
  onMergeConfirm,
  onBatchDownload,
  onBatchDownloadCancel,
  onBatchDownloadConfirm,
  onAdvancedFiltersChange,
  onResourceSelect,
  onResourceDelete,
  onResourcePreview,
  onResourceDownload,
  onResourceCopyUrl
}: SnifferPanelProps): React.JSX.Element {
  const [advancedModalVisible, setAdvancedModalVisible] = useState(false)
  const [discardedModalVisible, setDiscardedModalVisible] = useState(false)
  const [tempFilters, setTempFilters] = useState<AdvancedSearchFilters | undefined>(advancedFilters)

  // Sync temp filters when props change
  useEffect(() => {
    if (!advancedModalVisible) {
      setTempFilters(advancedFilters)
    }
  }, [advancedFilters, advancedModalVisible])
  const selectedCount = resources.filter((r) => r.selected).length

  // 优先使用主进程广播的精确值，兼容旧版 fallback 到差值推算
  const analyzing =
    stats?.analyzingCount ??
    Math.max(0, (stats?.sniffedCount ?? 0) - (stats?.identifiedCount ?? 0) - (stats?.discardedCount ?? 0))
  const sniffedCount = stats?.sniffedCount ?? 0
  const identifiedCount = stats?.identifiedCount ?? 0
  const discardedCount = stats?.discardedCount ?? 0
  const discardedUrls = stats?.discardedUrls ?? []
  const progressPct = sniffedCount > 0 ? Math.round(((identifiedCount + discardedCount) / sniffedCount) * 100) : 0
  const batchMenuItems = [
    {
      key: 'merge',
      label: '合并',
      icon: <MergeCellsOutlined />,
      onClick: () => onMerge?.()
    },
    {
      key: 'download',
      label: '下载',
      icon: <DownloadOutlined />,
      onClick: () => onBatchDownload?.()
    }
  ]

  const handleOpenDiscardedUrl = async (url: string) => {
    try {
      await trpc.system.openExternal.mutate({ url })
    } catch (error) {
      console.error('Open discarded URL failed:', error)
      message.error('打开链接失败')
    }
  }

  const handleCopyDiscardedUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      message.success('链接已复制')
    } catch (error) {
      console.error('Copy discarded URL failed:', error)
      message.error('复制链接失败')
    }
  }

  return (
    <aside className={`sniffer-panel ${collapsed ? 'sniffer-panel--collapsed' : ''}`} id="sniffer-panel">
      {/* Toggle Handle */}
      <button
        className="sniffer-panel__toggle"
        onClick={onToggle}
        aria-label={collapsed ? '展开嗅探面板' : '收起嗅探面板'}
      >
        {collapsed ? <LeftOutlined /> : <RightOutlined />}
      </button>

      {!collapsed && (
        <>
          {/* ── Stats Bar ── */}
          <div className="sniffer-panel__stats">
            <div className="sniffer-panel__stats-header">
              <span className="sniffer-panel__stats-title">
                {stats?.active ? (
                  <>
                    <LoadingOutlined spin style={{ marginRight: 4, color: 'var(--color-primary)' }} />
                    嗅探中
                  </>
                ) : (
                  <>
                    <RadarChartOutlined style={{ marginRight: 4 }} />
                    嗅探结果
                  </>
                )}
              </span>
              <div className="sniffer-panel__stats-counts">
                <Tooltip title="已嗅探URL数">
                  <span className="sniffer-panel__stats-badge sniffer-panel__stats-badge--sniffed">
                    {sniffedCount} 嗅探
                  </span>
                </Tooltip>
                <Tooltip title="已识别媒体资源">
                  <span className="sniffer-panel__stats-badge sniffer-panel__stats-badge--identified">
                    {identifiedCount} 识别
                  </span>
                </Tooltip>
                <Tooltip title="已丢弃非媒体URL">
                  <button
                    type="button"
                    className="sniffer-panel__stats-badge sniffer-panel__stats-badge--discarded"
                    onClick={() => discardedUrls.length > 0 && setDiscardedModalVisible(true)}
                    disabled={discardedUrls.length === 0}
                    aria-label="查看已丢弃URL列表"
                    style={{ cursor: discardedUrls.length > 0 ? 'pointer' : 'default', border: 'none' }}
                  >
                    {discardedCount} 丢弃
                  </button>
                </Tooltip>
                {analyzing > 0 && (
                  <Tooltip title="正在分析中">
                    <span className="sniffer-panel__stats-badge sniffer-panel__stats-badge--analyzing">
                      {analyzing} 分析中
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
            {sniffedCount > 0 && (
              <Progress
                percent={progressPct}
                size="small"
                showInfo={false}
                strokeColor={analyzing > 0 ? 'var(--color-primary)' : 'var(--color-success)'}
                trailColor="var(--color-border)"
                style={{ margin: '4px 0 0' }}
              />
            )}
          </div>

          {/* ── Toolbar ── */}
          <div className="sniffer-panel__toolbar">
            <div className="sniffer-panel__toolbar-group">
              <Tooltip title="全选" mouseEnterDelay={0.5}>
                <button className="sniffer-panel__toolbar-btn" onClick={onInvertSelect} aria-label="反选">
                  <CheckSquareOutlined />
                </button>
              </Tooltip>
              <Popconfirm title="确定清空吗？" onConfirm={onClearAll} okText="确定" cancelText="取消">
                <Tooltip title="清空" mouseEnterDelay={0.5}>
                  <button className="sniffer-panel__toolbar-btn sniffer-panel__toolbar-btn--danger" aria-label="清空">
                    <ClearOutlined />
                  </button>
                </Tooltip>
              </Popconfirm>
              <Dropdown menu={{ items: batchMenuItems }} trigger={['click']} placement="bottomLeft">
                <button className="sniffer-panel__toolbar-btn" aria-label="批量操作">
                  <MoreOutlined />
                  {selectedCount > 0 && (
                    <span
                      style={{
                        background: 'var(--color-primary)',
                        color: '#fff',
                        borderRadius: 8,
                        padding: '0 4px',
                        fontSize: 10,
                        lineHeight: '16px',
                        minWidth: 16,
                        textAlign: 'center'
                      }}
                    >
                      {selectedCount}
                    </span>
                  )}
                </button>
              </Dropdown>
            </div>

            <div className="sniffer-panel__toolbar-search">
              <div className="sniffer-panel__search-wrapper">
                <input
                  className="sniffer-panel__search-input"
                  type="text"
                  placeholder="搜索资源..."
                  value={searchText}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  aria-label="搜索资源"
                  id="sniffer-search"
                />
                <Tooltip title="高级搜索" mouseEnterDelay={0.5}>
                  <button
                    className="sniffer-panel__advanced-btn"
                    onClick={() => {
                      setTempFilters(advancedFilters)
                      setAdvancedModalVisible(true)
                    }}
                    aria-label="高级搜索"
                  >
                    <FilterOutlined style={{ marginRight: 2 }} />
                    高级
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* ── Resource Grid ── */}
          <div className="sniffer-panel__grid">
            {resources.length > 0 ? (
              resources.map((res) => (
                <MediaCard
                  key={res.id}
                  resource={res}
                  onSelect={onResourceSelect}
                  onDelete={onResourceDelete}
                  onPreview={onResourcePreview}
                  onDownload={onResourceDownload}
                  onCopyUrl={onResourceCopyUrl}
                />
              ))
            ) : (
              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 0',
                  color: 'var(--color-text-quaternary)',
                  fontSize: 12
                }}
              >
                <RadarChartOutlined style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }} />
                <span>{stats?.active ? '正在嗅探中，请稍候...' : '暂无嗅探到的资源'}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Advanced Search Modal */}
      <Modal
        title="高级搜索"
        open={advancedModalVisible}
        onCancel={() => setAdvancedModalVisible(false)}
        footer={null}
        width={400}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 类型过滤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 60 }}>类型：</span>
            <Select
              mode="multiple"
              value={tempFilters?.type ?? DEFAULT_ADVANCED_FILTERS.type}
              onChange={(val) => setTempFilters((prev) => ({ ...prev!, type: val as AdvancedSearchFilters['type'] }))}
              style={{ flex: 1 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'image', label: '图片' },
                { value: 'video', label: '视频' },
                { value: 'audio', label: '音频' }
              ]}
            />
          </div>

          {/* 分辨率过滤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 60 }}>分辨率：</span>
            <InputNumber
              value={tempFilters?.minWidth ?? DEFAULT_ADVANCED_FILTERS.minWidth}
              onChange={(val) => setTempFilters((prev) => ({ ...prev!, minWidth: val ?? 0 }))}
              min={0}
              placeholder="宽度"
              style={{ width: 80 }}
            />
            <span>×</span>
            <InputNumber
              value={tempFilters?.minHeight ?? DEFAULT_ADVANCED_FILTERS.minHeight}
              onChange={(val) => setTempFilters((prev) => ({ ...prev!, minHeight: val ?? 0 }))}
              min={0}
              placeholder="高度"
              style={{ width: 80 }}
            />
            <span style={{ color: '#888', fontSize: 12 }}>最小分辨率</span>
          </div>

          {/* 大小过滤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 60 }}>大小：</span>
            <InputNumber
              value={tempFilters?.minSize ?? DEFAULT_ADVANCED_FILTERS.minSize}
              onChange={(val) => setTempFilters((prev) => ({ ...prev!, minSize: val ?? 0 }))}
              min={0}
              style={{ width: 100 }}
            />
            <span>KB 以上</span>
          </div>

          {/* 时长过滤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 60 }}>时长：</span>
            <InputNumber
              value={tempFilters?.minDuration ?? DEFAULT_ADVANCED_FILTERS.minDuration}
              onChange={(val) => setTempFilters((prev) => ({ ...prev!, minDuration: val ?? 0 }))}
              min={0}
              style={{ width: 100 }}
            />
            <span>秒 以上</span>
          </div>

          {/* 按钮组 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <Space>
              <Button icon={<UndoOutlined />} onClick={() => setTempFilters(DEFAULT_ADVANCED_FILTERS)}>
                重置默认
              </Button>
              <Button
                icon={<CloseOutlined />}
                onClick={() => {
                  setTempFilters(EMPTY_ADVANCED_FILTERS)
                  onAdvancedFiltersChange?.(EMPTY_ADVANCED_FILTERS)
                  setAdvancedModalVisible(false)
                }}
              >
                清空搜索
              </Button>
            </Space>
            <Space>
              <Button onClick={() => setAdvancedModalVisible(false)}>取消</Button>
              <Button
                type="primary"
                onClick={() => {
                  onAdvancedFiltersChange?.(tempFilters ?? DEFAULT_ADVANCED_FILTERS)
                  setAdvancedModalVisible(false)
                }}
              >
                应用
              </Button>
            </Space>
          </div>
        </div>
      </Modal>

      <Modal
        title={`已丢弃 URL（${discardedUrls.length}）`}
        open={discardedModalVisible}
        onCancel={() => setDiscardedModalVisible(false)}
        footer={null}
        width={720}
        destroyOnHidden
      >
        {discardedUrls.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {discardedUrls.map((url) => (
              <div
                key={url}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleOpenDiscardedUrl(url)}
                  style={{
                    flex: 1,
                    padding: 0,
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-primary)',
                    cursor: 'pointer',
                    wordBreak: 'break-all'
                  }}
                >
                  {url}
                </button>
                <Button size="small" onClick={() => void handleCopyDiscardedUrl(url)}>
                  复制
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>暂无丢弃 URL</div>
        )}
      </Modal>

      <BatchActionModal
        title="合并详情"
        open={mergeModalVisible}
        items={mergeTasks}
        confirmText={mergeTasks.every((item) => item.status === 'success') ? '已完成' : '开始合并'}
        confirmLoading={mergeSubmitting}
        confirmDisabled={mergeTasks.length === 0 || mergeSubmitting || mergeTasks.every((item) => item.status === 'success')}
        emptyText="当前没有可合并的音视频任务"
        onCancel={() => onMergeCancel?.()}
        onConfirm={() => onMergeConfirm?.()}
      />
      <BatchActionModal
        title="下载详情"
        open={downloadModalVisible}
        items={downloadTasks}
        confirmText={downloadTasks.every((item) => item.status === 'success') ? '已完成' : '开始下载'}
        confirmLoading={downloadSubmitting}
        confirmDisabled={
          downloadTasks.length === 0 || downloadSubmitting || downloadTasks.every((item) => item.status === 'success')
        }
        emptyText="当前没有可下载的资源"
        onCancel={() => onBatchDownloadCancel?.()}
        onConfirm={() => onBatchDownloadConfirm?.()}
      />
    </aside>
  )
}
