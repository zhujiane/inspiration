import { Tooltip, Progress } from 'antd'
import {
  CheckSquareOutlined,
  ClearOutlined,
  MergeCellsOutlined,
  ThunderboltOutlined,
  LeftOutlined,
  RightOutlined,
  FilterOutlined,
  RadarChartOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import MediaCard from './MediaCard'
import type { MediaResource } from './MediaCard'

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
  onToggle: () => void
  onSearchChange?: (text: string) => void
  onSelectAll?: () => void
  onClearAll?: () => void
  onMerge?: () => void
  onBatchAction?: () => void
  onAdvancedSearch?: () => void
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
  onToggle,
  onSearchChange,
  onSelectAll,
  onClearAll,
  onMerge,
  onBatchAction,
  onAdvancedSearch,
  onResourceSelect,
  onResourceDelete,
  onResourcePreview,
  onResourceDownload,
  onResourceCopyUrl
}: SnifferPanelProps): React.JSX.Element {
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
                  <button className="sniffer-panel__advanced-btn" onClick={onAdvancedSearch} aria-label="高级搜索">
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
    </aside>
  )
}
