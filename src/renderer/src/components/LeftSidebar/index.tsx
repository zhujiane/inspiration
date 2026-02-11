import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
  LinkOutlined
} from '@ant-design/icons'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '../../lib/trpc'
import type { Bookmark } from '../../../../shared/db/bookmark-schema'

/* ============================================================
   Interfaces & Types
   ============================================================ */

export interface NavItem extends Bookmark {}

export interface NavGroup {
  id: number
  title: string
  items: NavItem[]
  order: number
}

interface LeftSidebarProps {
  activeItemId: string | number
  collapsed: boolean
  onToggle: () => void
  onItemSelect?: (item: Bookmark) => void
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
}

const SortableItem = ({ item, isActive, onClick, onEdit, onDelete }: SortableItemProps) => {
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
      <span className="sidebar__item-icon">{item.type === 3 ? <AppstoreOutlined /> : <GlobalOutlined />}</span>
      <span className="sidebar__item-label">{item.name}</span>
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
  onItemSelect: (item: Bookmark) => void
  onItemEdit: (item: Bookmark) => void
  onItemDelete: (item: Bookmark) => void
}

const SortableGroup = ({ group, isCollapsed, activeItemId, onToggle, onAddItem, onEdit, onItemSelect, onItemEdit, onItemDelete }: SortableGroupProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `group-${group.id}`, data: { type: 'group', group } })

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
        <CaretDownOutlined className={`sidebar__group-arrow ${isCollapsed ? 'sidebar__group-arrow--collapsed' : ''}`} />
        <FolderOutlined style={{ fontSize: 12, marginRight: 2 }} />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.title}</span>

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
        </div>
      </div>

      {!isCollapsed && (
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

export default function LeftSidebar({ activeItemId, collapsed, onToggle, onItemSelect }: LeftSidebarProps): React.JSX.Element {
  const { message } = AntdApp.useApp()
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Partial<Bookmark> | null>(null)
  const [form] = Form.useForm()

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
      order: folder.order || 0,
      items: bookmarks.filter((b) => b.parentId === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0))
    }))
  }, [bookmarks])

  // --- Handlers ---
  const toggleGroup = (groupId: number): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
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
    } catch (error) {
      message.error('删除失败')
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
            <span className="sidebar__title">导航</span>
            <div className="sidebar__actions">
              <Tooltip title="新建目录" mouseEnterDelay={0.5}>
                <button className="sidebar__action-btn" onClick={handleAddGroup} aria-label="新建目录">
                  <AppstoreAddOutlined />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="sidebar__content">
            {groups.length === 0 ? (
              <div style={{ padding: '20px 0' }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类" />
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={groups.map((g) => `group-${g.id}`)} strategy={verticalListSortingStrategy}>
                  {groups.map((group) => (
                    <SortableGroup
                      key={group.id}
                      group={group}
                      isCollapsed={collapsedGroups.has(group.id)}
                      activeItemId={activeItemId}
                      onToggle={() => toggleGroup(group.id)}
                      onAddItem={() => handleAddItem(group.id)}
                      onEdit={() => handleEdit(bookmarks.find((b) => b.id === group.id)!)}
                      onItemSelect={(item) => onItemSelect?.(item)}
                      onItemEdit={handleEdit}
                      onItemDelete={handleDelete}
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
      `}</style>
    </aside>
  )
}
