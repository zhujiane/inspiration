import { Tooltip } from 'antd'
import {
    CheckSquareOutlined,
    ClearOutlined,
    MergeCellsOutlined,
    ThunderboltOutlined,
    LeftOutlined,
    RightOutlined,
    FilterOutlined
} from '@ant-design/icons'
import MediaCard from './MediaCard'
import type { MediaResource } from './MediaCard'

interface SnifferPanelProps {
    resources: MediaResource[]
    collapsed: boolean
    searchText: string
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

    return (
        <aside
            className={`sniffer-panel ${collapsed ? 'sniffer-panel--collapsed' : ''}`}
            id="sniffer-panel"
        >
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
                    {/* 4.1 Toolbar */}
                    <div className="sniffer-panel__toolbar">
                        <div className="sniffer-panel__toolbar-group">
                            <Tooltip title="全选" mouseEnterDelay={0.5}>
                                <button
                                    className="sniffer-panel__toolbar-btn"
                                    onClick={onSelectAll}
                                    aria-label="全选"
                                >
                                    <CheckSquareOutlined />
                                    <span>全选</span>
                                </button>
                            </Tooltip>
                            <Tooltip title="清空" mouseEnterDelay={0.5}>
                                <button
                                    className="sniffer-panel__toolbar-btn sniffer-panel__toolbar-btn--danger"
                                    onClick={onClearAll}
                                    aria-label="清空"
                                >
                                    <ClearOutlined />
                                    <span>清空</span>
                                </button>
                            </Tooltip>
                            <Tooltip title="合并" mouseEnterDelay={0.5}>
                                <button
                                    className="sniffer-panel__toolbar-btn"
                                    onClick={onMerge}
                                    aria-label="合并"
                                >
                                    <MergeCellsOutlined />
                                    <span>合并</span>
                                </button>
                            </Tooltip>
                            <Tooltip title="批量操作" mouseEnterDelay={0.5}>
                                <button
                                    className="sniffer-panel__toolbar-btn"
                                    onClick={onBatchAction}
                                    aria-label="批量操作"
                                >
                                    <ThunderboltOutlined />
                                    <span>批量</span>
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
                                        onClick={onAdvancedSearch}
                                        aria-label="高级搜索"
                                    >
                                        <FilterOutlined style={{ marginRight: 2 }} />
                                        高级
                                    </button>
                                </Tooltip>
                            </div>
                        </div>
                    </div>

                    {/* 4.1 Grid */}
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
                                <FilterOutlined style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }} />
                                <span>暂无嗅探到的资源</span>
                            </div>
                        )}
                    </div>
                </>
            )}
        </aside>
    )
}
