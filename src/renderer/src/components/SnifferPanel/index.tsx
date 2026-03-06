import { useEffect, useState } from 'react'
import { Tooltip, Progress, Modal, Select, InputNumber, Button, Space } from 'antd'
import {
  CheckSquareOutlined,
  ClearOutlined,
  MergeCellsOutlined,
  ThunderboltOutlined,
  LeftOutlined,
  RightOutlined,
  FilterOutlined,
  RadarChartOutlined,
  LoadingOutlined,
  UndoOutlined,
  CloseOutlined
} from '@ant-design/icons'
import MediaCard from './MediaCard'
import type { MediaResource } from './MediaCard'

export interface AdvancedSearchFilters {
  type: 'all' | 'image' | 'video' | 'audio'
  minWidth: number
  minHeight: number
  minSize: number // KB
  minDuration: number // seconds
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedSearchFilters = {
  type: 'all',
  minWidth: 120,
  minHeight: 120,
  minSize: 100, // 100KB
  minDuration: 5 // 5s
}

export const EMPTY_ADVANCED_FILTERS: AdvancedSearchFilters = {
  type: 'all',
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
}

interface SnifferPanelProps {
  resources: MediaResource[]
  collapsed: boolean
  searchText: string
  stats?: SnifferStats
  advancedFilters?: AdvancedSearchFilters
  onToggle: () => void
  onSearchChange?: (text: string) => void
  onSelectAll?: () => void
  onClearAll?: () => void
  onMerge?: () => void
  onBatchAction?: () => void
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
  onToggle,
  onSearchChange,
  onSelectAll,
  onClearAll,
  onMerge,
  onBatchAction,
  onAdvancedFiltersChange,
  onResourceSelect,
  onResourceDelete,
  onResourcePreview,
  onResourceDownload,
  onResourceCopyUrl
}: SnifferPanelProps): React.JSX.Element {
  const [advancedModalVisible, setAdvancedModalVisible] = useState(false)
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
  const progressPct = sniffedCount > 0 ? Math.round(((identifiedCount + discardedCount) / sniffedCount) * 100) : 0

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
                  <span className="sniffer-panel__stats-badge sniffer-panel__stats-badge--discarded">
                    {discardedCount} 丢弃
                  </span>
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
                <button className="sniffer-panel__toolbar-btn" onClick={onSelectAll} aria-label="全选">
                  <CheckSquareOutlined />
                </button>
              </Tooltip>
              <Tooltip title="清空" mouseEnterDelay={0.5}>
                <button
                  className="sniffer-panel__toolbar-btn sniffer-panel__toolbar-btn--danger"
                  onClick={onClearAll}
                  aria-label="清空"
                >
                  <ClearOutlined />
                </button>
              </Tooltip>
              <Tooltip title="合并" mouseEnterDelay={0.5}>
                <button className="sniffer-panel__toolbar-btn" onClick={onMerge} aria-label="合并">
                  <MergeCellsOutlined />
                </button>
              </Tooltip>
              <Tooltip title="批量操作" mouseEnterDelay={0.5}>
                <button className="sniffer-panel__toolbar-btn" onClick={onBatchAction} aria-label="批量操作">
                  <ThunderboltOutlined />
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
              </Tooltip>
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
              value={tempFilters?.type ?? 'all'}
              onChange={(val) => setTempFilters((prev) => ({ ...prev!, type: val }))}
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
    </aside>
  )
}
