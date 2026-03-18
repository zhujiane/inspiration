import { Form, Input, Modal, Select } from 'antd'
import type { FormInstance } from 'antd'
import type { TitleBarBookmark } from './types'

export interface BookmarkFormValues {
  name: string
  url: string
  parentId: number
  userDataPath?: string
}

interface BookmarkModalProps {
  open: boolean
  form: FormInstance<BookmarkFormValues>
  bookmarkGroups: TitleBarBookmark[]
  onSubmit: () => void
  onCancel: () => void
}

export default function BookmarkModal({
  open,
  form,
  bookmarkGroups,
  onSubmit,
  onCancel
}: BookmarkModalProps): React.JSX.Element {
  return (
    <Modal
      title="添加收藏"
      open={open}
      onOk={onSubmit}
      onCancel={onCancel}
      okText="添加"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="url" label="网址" rules={[{ required: true, message: '请输入网址' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="parentId" label="收藏分组" rules={[{ required: true, message: '请选择分组' }]}>
          <Select
            placeholder="请选择分组"
            options={bookmarkGroups.map((group) => ({
              label: group.name,
              value: group.id
            }))}
          />
        </Form.Item>
        <Form.Item
          name="userDataPath"
          label="持久化目录 (Partition)"
          tooltip="每个标签页可以拥有独立的持久化数据，留空则使用默认配置"
        >
          <Input placeholder="输入持久化标识，例如: user1" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
