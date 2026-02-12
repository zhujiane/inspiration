import { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Tooltip, Modal, Form, Input, Select, App as AntdApp, Popconfirm, Empty } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LeftOutlined,
  RightOutlined,
  CaretDownOutlined,
  GlobalOutlined,
  FolderOutlined,
  AppstoreOutlined,
  HolderOutlined,
  AppstoreAddOutlined,
  LinkOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '../../lib/trpc'
import type { Bookmark } from '@shared/db/bookmark-schema'

/* ============================================================
   Interfaces & Types
   ============================================================ */

export interface NavItem extends Bookmark {}

export interface NavGroup {
  id: number
  title: string
  icon?: string | null
  items: NavItem[]
  order: number
  isDefault: number
}

export interface LeftSidebarRef {
  refresh: () => void
}

interface LeftSidebarProps {
  activeItemId: string | number
  collapsed: boolean
  onToggle: () => void
  onItemSelect?: (item: Bookmark) => void
}

/* ============================================================
   Helpers
   ============================================================ */
const HighlightText = ({ text, highlight }: { text: string; highlight?: string }) => {
  if (!highlight?.trim()) return <span>{text}</span>
  const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'))
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="sidebar__highlight">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  )
}

/* ============================================================
   Sortable Components
   ============================================================ */

// --- Draggable Item (Level 2) ---
interface SortableItemProps {
  item: Bookmark
  isActive: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  searchText?: string
}

const SortableItem = ({ item, isActive, onClick, onEdit, onDelete, searchText }: SortableItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `item-${item.id}`, data: { type: 'item', item } })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 1
  }

  return (
    <div ref={setNodeRef} style={style} className={`sidebar__item ${isActive ? 'sidebar__item--active' : ''}`} onClick={onClick} title={item.url || item.name}>
      <div className="sidebar__item-drag-handle" {...attributes} {...listeners}>
        <HolderOutlined style={{ fontSize: 10, cursor: 'grab' }} />
      </div>
      <span className="sidebar__item-icon">
        {item.icon && item.icon.startsWith('data:image') ? (
          <img src={item.icon} style={{ width: 14, height: 14, borderRadius: 2 }} alt="" />
        ) : item.type === 3 ? (
          <AppstoreOutlined />
        ) : (
          <GlobalOutlined />
        )}
      </span>
      <span className="sidebar__item-label">
        <HighlightText text={item.name} highlight={searchText} />
      </span>
      <div className="sidebar__item-actions">
        <Tooltip title="编辑" mouseEnterDelay={0.5}>
          <button
            className="sidebar__action-btn"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            style={{ width: 18, height: 18 }}
          >
            <EditOutlined style={{ fontSize: 10 }} />
          </button>
        </Tooltip>
        {item.isDefault !== 1 && (
          <Popconfirm
            title="确定删除吗？"
            onConfirm={(e) => {
              e?.stopPropagation()
              onDelete()
            }}
            onCancel={(e) => e?.stopPropagation()}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除" mouseEnterDelay={0.5}>
              <button className="sidebar__action-btn" onClick={(e) => e.stopPropagation()} style={{ width: 18, height: 18 }}>
                <DeleteOutlined style={{ fontSize: 10 }} />
              </button>
            </Tooltip>
          </Popconfirm>
        )}
      </div>
    </div>
  )
}

// --- Draggable Group (Level 1) ---
interface SortableGroupProps {
  group: NavGroup
  isCollapsed: boolean
  activeItemId: string | number
  onToggle: () => void
  onAddItem: () => void
  onEdit: () => void
  onDelete: () => void
  onItemSelect: (item: Bookmark) => void
  onItemEdit: (item: Bookmark) => void
  onItemDelete: (item: Bookmark) => void
  searchText?: string
}

const SortableGroup = ({ group, isCollapsed, activeItemId, onToggle, onAddItem, onEdit, onDelete, onItemSelect, onItemEdit, onItemDelete, searchText }: SortableGroupProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `group-${group.id}`, data: { type: 'group', group } })

  const isActuallyCollapsed = searchText
    ? !group.title.toLowerCase().includes(searchText.toLowerCase()) && !group.items.some((item) => item.name.toLowerCase().includes(searchText.toLowerCase())) && isCollapsed
    : isCollapsed

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div ref={setNodeRef} style={style} className="sidebar__group">
      <div className="sidebar__group-header" onClick={onToggle}>
        <div className="sidebar__group-drag-handle" {...attributes} {...listeners} style={{ marginRight: 4 }}>
          <HolderOutlined style={{ fontSize: 10, cursor: 'grab' }} />
        </div>
        <CaretDownOutlined className={`sidebar__group-arrow ${isActuallyCollapsed ? 'sidebar__group-arrow--collapsed' : ''}`} />
        <FolderOutlined
          style={{
            fontSize: 12,
            marginRight: 2,
            color: group.icon && group.icon.startsWith('#') ? group.icon : 'inherit'
          }}
        />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <HighlightText text={group.title} highlight={searchText} />
        </span>

        <div className="sidebar__group-actions" style={{ display: 'flex', gap: 2 }}>
          <Tooltip title="编辑目录" mouseEnterDelay={0.5}>
            <button
              className="sidebar__action-btn"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              style={{ width: 18, height: 18 }}
            >
              <EditOutlined style={{ fontSize: 10 }} />
            </button>
          </Tooltip>
          <Tooltip title="添加书签" mouseEnterDelay={0.5}>
            <button
              className="sidebar__action-btn"
              onClick={(e) => {
                e.stopPropagation()
                onAddItem()
              }}
              style={{ width: 18, height: 18 }}
            >
              <PlusOutlined style={{ fontSize: 10 }} />
            </button>
          </Tooltip>
          {group.isDefault !== 1 && (
            <Popconfirm
              title="确定删除目录及其内容吗？"
              onConfirm={(e) => {
                e?.stopPropagation()
                onDelete()
              }}
              onCancel={(e) => e?.stopPropagation()}
              okText="确定"
              cancelText="取消"
            >
              <Tooltip title="删除目录" mouseEnterDelay={0.5}>
                <button className="sidebar__action-btn" onClick={(e) => e.stopPropagation()} style={{ width: 18, height: 18 }}>
                  <DeleteOutlined style={{ fontSize: 10 }} />
                </button>
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      </div>

      {!isActuallyCollapsed && (
        <div className="sidebar__group-items">
          <SortableContext items={group.items.map((item) => `item-${item.id}`)} strategy={verticalListSortingStrategy}>
            {group.items.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                isActive={String(item.id) === String(activeItemId)}
                onClick={() => onItemSelect(item)}
                onEdit={() => onItemEdit(item)}
                onDelete={() => onItemDelete(item)}
                searchText={searchText}
              />
            ))}
            {group.items.length === 0 && <div style={{ padding: '8px 24px', fontSize: 11, color: '#999', fontStyle: 'italic' }}>暂无书签</div>}
          </SortableContext>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Main Component
   ============================================================ */

const LeftSidebar = forwardRef<LeftSidebarRef, LeftSidebarProps>(({ activeItemId, collapsed, onToggle, onItemSelect }, ref) => {
  const { message } = AntdApp.useApp()
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Partial<Bookmark> | null>(null)
  const [searchText, setSearchText] = useState('')
  const [form] = Form.useForm()

  useImperativeHandle(ref, () => ({
    refresh: () => {
      fetchBookmarks()
    }
  }))

  // --- Fetch Data ---
  const fetchBookmarks = useCallback(async () => {
    try {
      const data = await trpc.bookmark.list.query()
      setBookmarks(data as any)
    } catch (error) {
      console.error('Failed to fetch bookmarks:', error)
      message.error('获取书签失败')
    }
  }, [message])

  useEffect(() => {
    fetchBookmarks()
  }, [fetchBookmarks])

  // --- Transform Data into Groups ---
  const groups = useMemo(() => {
    const folders = bookmarks.filter((b) => b.type === 1 && b.parentId === 0).sort((a, b) => (a.order || 0) - (b.order || 0))

    return folders.map((folder) => ({
      id: folder.id,
      title: folder.name,
      icon: folder.icon,
      order: folder.order || 0,
      isDefault: folder.isDefault,
      items: bookmarks.filter((b) => b.parentId === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0))
    }))
  }, [bookmarks])

  const filteredGroups = useMemo(() => {
    if (!searchText) return groups
    const term = searchText.toLowerCase()
    return groups
      .map((group) => {
        const matchingItems = group.items.filter((item) => item.name.toLowerCase().includes(term) || (item.url && item.url.toLowerCase().includes(term)))
        const groupMatches = group.title.toLowerCase().includes(term)

        if (groupMatches || matchingItems.length > 0) {
          return {
            ...group,
            items: groupMatches ? group.items : matchingItems
          }
        }
        return null
      })
      .filter(Boolean) as NavGroup[]
  }, [groups, searchText])

  // --- Handlers ---
  const toggleGroup = (groupId: number): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const isAllCollapsed = useMemo(() => {
    return groups.length > 0 && groups.every((g) => collapsedGroups.has(g.id))
  }, [groups, collapsedGroups])

  const toggleAllGroups = () => {
    if (isAllCollapsed) {
      setCollapsedGroups(new Set())
    } else {
      setCollapsedGroups(new Set(groups.map((g) => g.id)))
    }
  }

  const handleAddGroup = () => {
    setEditingItem({ type: 1, parentId: 0, order: groups.length })
    form.setFieldsValue({ name: '', type: 1, url: '' })
    setIsModalOpen(true)
  }

  const handleAddItem = (groupId: number) => {
    const group = groups.find((g) => g.id === groupId)
    setEditingItem({
      type: 2,
      parentId: groupId,
      order: group?.items.length || 0
    })
    form.setFieldsValue({ name: '', type: 2, url: '', parentId: groupId })
    setIsModalOpen(true)
  }

  const handleEdit = (item: Bookmark) => {
    setEditingItem(item)
    form.setFieldsValue(item)
    setIsModalOpen(true)
  }

  const handleDelete = async (item: Bookmark) => {
    try {
      await trpc.bookmark.delete.mutate({ id: item.id })
      message.success('删除成功')
      fetchBookmarks()
    } catch (error: any) {
      console.error('Delete error:', error)
      message.error(error.message || '删除失败')
    }
  }

  const handleModalSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingItem?.id) {
        await trpc.bookmark.update.mutate({ ...editingItem, ...values, id: editingItem.id })
        message.success('更新成功')
      } else {
        await trpc.bookmark.create.mutate({ ...editingItem, ...values })
        message.success('添加成功')
      }
      setIsModalOpen(false)
      fetchBookmarks()
    } catch (error) {
      console.error('Submit error:', error)
    }
  }

  // --- DnD Sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // --- DnD Logic ---
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeData = active.data.current
    const overData = over.data.current

    if (!activeData) return

    // 1. Reordering Groups
    if (activeData.type === 'group') {
      const oldIndex = groups.findIndex((g) => `group-${g.id}` === active.id)
      const newIndex = groups.findIndex((g) => `group-${g.id}` === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newGroups = arrayMove(groups, oldIndex, newIndex)
        const updates = newGroups.map((g, index) => ({ id: g.id, order: index }))

        // Optimistic update
        const idMap = new Map(updates.map((u) => [u.id, u.order]))
        setBookmarks((prev) => prev.map((b) => (idMap.has(b.id) ? { ...b, order: idMap.get(b.id) as number } : b)))

        await trpc.bookmark.reorder.mutate(updates)
      }
    }

    // 2. Reordering Items
    else if (activeData.type === 'item') {
      const activeItem = activeData.item as Bookmark

      let newParentId = activeItem.parentId
      let newOrder = activeItem.order

      // Case A: Dragging over another item
      if (overData?.type === 'item') {
        const overItem = overData.item as Bookmark
        newParentId = overItem.parentId

        const sameGroupItems = bookmarks.filter((b) => b.parentId === newParentId).sort((a, b) => (a.order || 0) - (b.order || 0))

        const oldIndex = sameGroupItems.findIndex((b) => b.id === activeItem.id)
        let newIndex = sameGroupItems.findIndex((b) => b.id === overItem.id)

        if (oldIndex === -1) {
          // Moving from another group
          const updatedItems = [...sameGroupItems]
          updatedItems.splice(newIndex, 0, { ...activeItem, parentId: newParentId })
          const updates = updatedItems.map((b, index) => ({ id: b.id, order: index, parentId: newParentId }))
          await trpc.bookmark.reorder.mutate(updates)
        } else {
          // Reordering within same group
          const updatedItems = arrayMove(sameGroupItems, oldIndex, newIndex)
          const updates = updatedItems.map((b, index) => ({ id: b.id, order: index }))
          await trpc.bookmark.reorder.mutate(updates)
        }
      }
      // Case B: Dragging over a group header
      else if (overData?.type === 'group') {
        newParentId = (overData.group as NavGroup).id
        const sameGroupItems = bookmarks.filter((b) => b.parentId === newParentId)
        newOrder = sameGroupItems.length

        await trpc.bookmark.update.mutate({ id: activeItem.id, parentId: newParentId, order: newOrder })
      }

      fetchBookmarks()
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} id="left-sidebar">
      {!collapsed && (
        <>
          <div className="sidebar__brand">
            <div className="sidebar__brand-icon">
              <AppstoreOutlined style={{ color: '#fff', fontSize: 12 }} />
            </div>
            <span className="sidebar__brand-name">Inspiration</span>
          </div>
          <div className="sidebar__header">
            <div className="sidebar__search-container">
              <Input
                placeholder="搜索侧边栏..."
                variant="borderless"
                prefix={<SearchOutlined style={{ color: 'var(--color-text-quaternary)', fontSize: 12 }} />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                className="sidebar__search-input"
              />
            </div>
            <div className="sidebar__actions">
              <Tooltip title={isAllCollapsed ? '全部展开' : '全部收起'} mouseEnterDelay={0.5}>
                <button className="sidebar__action-btn" onClick={toggleAllGroups} aria-label={isAllCollapsed ? '全部展开' : '全部收起'}>
                  <CaretDownOutlined style={{ transform: isAllCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
              </Tooltip>
              <Tooltip title="新建目录" mouseEnterDelay={0.5}>
                <button className="sidebar__action-btn" onClick={handleAddGroup} aria-label="新建目录">
                  <AppstoreAddOutlined />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="sidebar__content">
            {filteredGroups.length === 0 ? (
              <div style={{ padding: '20px 0' }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={searchText ? '未找到匹配内容' : '暂无分类'} />
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={filteredGroups.map((g) => `group-${g.id}`)} strategy={verticalListSortingStrategy}>
                  {filteredGroups.map((group) => (
                    <SortableGroup
                      key={group.id}
                      group={group}
                      isCollapsed={collapsedGroups.has(group.id)}
                      activeItemId={activeItemId}
                      onToggle={() => toggleGroup(group.id)}
                      onAddItem={() => handleAddItem(group.id)}
                      onEdit={() => handleEdit(bookmarks.find((b) => b.id === group.id)!)}
                      onDelete={() => handleDelete(bookmarks.find((b) => b.id === group.id)!)}
                      onItemSelect={(item) => onItemSelect?.(item)}
                      onItemEdit={handleEdit}
                      onItemDelete={handleDelete}
                      searchText={searchText}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </>
      )}

      {/* Toggle Handle */}
      <button className="sidebar__toggle" onClick={onToggle} aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}>
        {collapsed ? <RightOutlined /> : <LeftOutlined />}
      </button>

      {/* CRUD Modal */}
      <Modal
        title={editingItem?.id ? '编辑' : editingItem?.type === 1 ? '新建目录' : '新建书签'}
        open={isModalOpen}
        onOk={handleModalSubmit}
        onCancel={() => setIsModalOpen(false)}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
        centered
        width={400}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="名称" />
          </Form.Item>

          {editingItem?.type !== 1 && (
            <>
              <Form.Item name="url" label="链接" rules={[{ required: true, message: '请输入链接' }]}>
                <Input placeholder="https://..." prefix={<LinkOutlined />} />
              </Form.Item>
              <Form.Item name="type" label="类型" initialValue={2}>
                <Select
                  options={[
                    { value: 2, label: '网页', icon: <GlobalOutlined /> },
                    { value: 3, label: '应用', icon: <AppstoreOutlined /> }
                  ]}
                />
              </Form.Item>
            </>
          )}

          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="可选" autoSize={{ minRows: 2 }} />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .sidebar__group-drag-handle, .sidebar__item-drag-handle {
          display: flex;
          align-items: center;
          opacity: 0;
          transition: opacity 0.2s;
          color: var(--color-text-quaternary);
        }
        .sidebar__group-header:hover .sidebar__group-drag-handle,
        .sidebar__item:hover .sidebar__item-drag-handle {
          opacity: 1;
        }
        .sidebar__item-drag-handle {
          margin-right: 4px;
        }
        .sidebar__group-actions {
          opacity: 0;
          transition: opacity 0.2s;
        }
        .sidebar__group-header:hover .sidebar__group-actions {
          opacity: 1;
        }
        .sidebar__item--active .sidebar__item-drag-handle {
          color: var(--color-primary);
        }
        .sidebar__search-container {
          flex: 1;
          margin-right: 8px;
        }
        .sidebar__search-input {
          height: 24px;
          padding: 0 4px;
          font-size: 12px;
          background: var(--color-bg-layout);
          border-radius: 4px;
        }
        .sidebar__search-input:hover, .sidebar__search-input:focus {
          background: var(--color-bg-container);
        }
        .sidebar__highlight {
          background-color: #ffe58f;
          color: rgba(0, 0, 0, 0.88);
          padding: 0 2px;
          border-radius: 2px;
        }
      `}</style>
    </aside>
  )
})

LeftSidebar.displayName = 'LeftSidebar'

export default LeftSidebar
