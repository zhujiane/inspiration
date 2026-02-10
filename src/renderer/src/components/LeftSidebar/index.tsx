import { useState } from 'react'
import { Tooltip } from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    LeftOutlined,
    RightOutlined,
    CaretDownOutlined,
    GlobalOutlined,
    FolderOutlined,
    AppstoreOutlined
} from '@ant-design/icons'

export interface NavItem {
    id: string
    label: string
    url?: string
    icon?: React.ReactNode
}

export interface NavGroup {
    id: string
    title: string
    items: NavItem[]
}

interface LeftSidebarProps {
    groups: NavGroup[]
    activeItemId: string
    collapsed: boolean
    onToggle: () => void
    onItemSelect?: (item: NavItem) => void
    onItemAdd?: (groupId: string) => void
    onItemEdit?: (item: NavItem) => void
    onItemDelete?: (item: NavItem) => void
    onGroupAdd?: () => void
}

export default function LeftSidebar({
    groups,
    activeItemId,
    collapsed,
    onToggle,
    onItemSelect,
    onItemAdd,
    onItemEdit,
    onItemDelete,
    onGroupAdd
}: LeftSidebarProps): React.JSX.Element {
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

    const toggleGroup = (groupId: string): void => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(groupId)) next.delete(groupId)
            else next.add(groupId)
            return next
        })
    }

    return (
        <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} id="left-sidebar">
            {!collapsed && (
                <>
                    {/* Brand — moved from TitleBar */}
                    <div className="sidebar__brand">
                        <div className="sidebar__brand-icon">
                            <AppstoreOutlined style={{ color: '#fff', fontSize: 12 }} />
                        </div>
                        <span className="sidebar__brand-name">Inspiration</span>
                    </div>

                    <div className="sidebar__header">
                        <span className="sidebar__title">导航</span>
                        <div className="sidebar__actions">
                            <Tooltip title="新建分组" mouseEnterDelay={0.5}>
                                <button
                                    className="sidebar__action-btn"
                                    onClick={onGroupAdd}
                                    aria-label="新建分组"
                                >
                                    <PlusOutlined />
                                </button>
                            </Tooltip>
                        </div>
                    </div>

                    <div className="sidebar__content">
                        {groups.map((group) => {
                            const isCollapsed = collapsedGroups.has(group.id)
                            return (
                                <div className="sidebar__group" key={group.id}>
                                    <div className="sidebar__group-header" onClick={() => toggleGroup(group.id)}>
                                        <CaretDownOutlined
                                            className={`sidebar__group-arrow ${isCollapsed ? 'sidebar__group-arrow--collapsed' : ''}`}
                                        />
                                        <FolderOutlined style={{ fontSize: 12, marginRight: 2 }} />
                                        <span style={{ flex: 1 }}>{group.title}</span>
                                        <Tooltip title="添加" mouseEnterDelay={0.5}>
                                            <button
                                                className="sidebar__action-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onItemAdd?.(group.id)
                                                }}
                                                aria-label={`添加到${group.title}`}
                                                style={{ width: 18, height: 18 }}
                                            >
                                                <PlusOutlined style={{ fontSize: 10 }} />
                                            </button>
                                        </Tooltip>
                                    </div>
                                    {!isCollapsed && (
                                        <div className="sidebar__group-items">
                                            {group.items.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className={`sidebar__item ${item.id === activeItemId ? 'sidebar__item--active' : ''}`}
                                                    onClick={() => onItemSelect?.(item)}
                                                    title={item.url || item.label}
                                                >
                                                    <span className="sidebar__item-icon">
                                                        {item.icon || <GlobalOutlined />}
                                                    </span>
                                                    <span className="sidebar__item-label">{item.label}</span>
                                                    <div className="sidebar__item-actions">
                                                        <Tooltip title="编辑" mouseEnterDelay={0.5}>
                                                            <button
                                                                className="sidebar__action-btn"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    onItemEdit?.(item)
                                                                }}
                                                                style={{ width: 18, height: 18 }}
                                                            >
                                                                <EditOutlined style={{ fontSize: 10 }} />
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip title="删除" mouseEnterDelay={0.5}>
                                                            <button
                                                                className="sidebar__action-btn"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    onItemDelete?.(item)
                                                                }}
                                                                style={{ width: 18, height: 18 }}
                                                            >
                                                                <DeleteOutlined style={{ fontSize: 10 }} />
                                                            </button>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </>
            )}

            {/* Toggle Handle */}
            <button
                className="sidebar__toggle"
                onClick={onToggle}
                aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            >
                {collapsed ? <RightOutlined /> : <LeftOutlined />}
            </button>
        </aside>
    )
}
