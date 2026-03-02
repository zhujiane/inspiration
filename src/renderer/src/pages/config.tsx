import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Card,
  Tabs,
  Input,
  InputNumber,
  Switch,
  Select,
  Button,
  Space,
  Tooltip,
  Divider,
  Typography,
  Spin,
  App as AntdApp,
  Tag,
  Popconfirm
} from 'antd'
import {
  SettingOutlined,
  DownloadOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  DesktopOutlined,
  UndoOutlined,
  SaveOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
import { trpc } from '../lib/trpc'
import type { Config } from '@shared/db/config-schema'

const { Text, Title } = Typography

/* ============================================================
   常量 & 类型
   ============================================================ */
interface GroupMeta {
  key: string
  label: string
  icon: React.ReactNode
  description: string
}

type ConfigItem = Omit<Config, 'createdAt' | 'updatedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
}

const GROUP_META: GroupMeta[] = [
  {
    key: 'general',
    label: '通用设置',
    icon: <SettingOutlined />,
    description: '语言、启动行为等基础配置'
  },
  {
    key: 'download',
    label: '下载设置',
    icon: <DownloadOutlined />,
    description: '下载路径、并发数、代理等'
  },
  {
    key: 'sniffer',
    label: '嗅探器',
    icon: <EyeOutlined />,
    description: '自动嗅探、过滤规则等'
  },
  {
    key: 'appearance',
    label: '外观',
    icon: <DesktopOutlined />,
    description: '主题模式、字体大小、布局'
  },
  {
    key: 'advanced',
    label: '高级设置',
    icon: <ThunderboltOutlined />,
    description: '硬件加速、日志级别、缓存'
  }
]

/* ============================================================
   值解析 & 格式化
   ============================================================ */
function parseValue(value: string, valueType: string): any {
  switch (valueType) {
    case 'number':
      return Number(value)
    case 'boolean':
      return value === 'true' || value === '1'
    case 'json':
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    default:
      return value
  }
}

function serializeValue(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/* ============================================================
   单项配置编辑器
   ============================================================ */
function ConfigItemEditor({
  config,
  value,
  onChange
}: {
  config: ConfigItem
  value: any
  onChange: (val: any) => void
}) {
  const { valueType, key } = config

  // 特殊处理已知的下拉选项
  if (key === 'general.language') {
    return (
      <Select
        value={value}
        onChange={onChange}
        style={{ width: 200 }}
        options={[
          { value: 'zh-CN', label: '简体中文' },
          { value: 'en-US', label: 'English' }
        ]}
      />
    )
  }

  if (key === 'appearance.theme') {
    return (
      <Select
        value={value}
        onChange={onChange}
        style={{ width: 200 }}
        options={[
          { value: 'light', label: '☀️ 亮色模式' },
          { value: 'dark', label: '🌙 暗色模式' },
          { value: 'auto', label: '🖥️ 跟随系统' }
        ]}
      />
    )
  }

  if (key === 'advanced.logLevel') {
    return (
      <Select
        value={value}
        onChange={onChange}
        style={{ width: 200 }}
        options={[
          { value: 'debug', label: 'Debug' },
          { value: 'info', label: 'Info' },
          { value: 'warn', label: 'Warn' },
          { value: 'error', label: 'Error' }
        ]}
      />
    )
  }

  if (key === 'sniffer.mediaTypes') {
    const arr = Array.isArray(value) ? value : []
    return (
      <Select
        mode="multiple"
        value={arr}
        onChange={onChange}
        style={{ width: 300 }}
        options={[
          { value: 'video', label: '视频' },
          { value: 'audio', label: '音频' },
          { value: 'image', label: '图片' }
        ]}
      />
    )
  }

  // 路径选择（download.path）
  if (key === 'download.path') {
    return (
      <Space.Compact style={{ width: 360 }}>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="选择下载路径或输入路径..." />
        <Tooltip title="选择文件夹">
          <Button
            icon={<FolderOpenOutlined />}
            onClick={async () => {
              try {
                const paths = (await trpc.system.showOpenDialog.mutate({
                  properties: ['openDirectory']
                })) as string[]
                if (paths && paths.length > 0) {
                  onChange(paths[0])
                }
              } catch (e) {
                console.error('Failed to open folder dialog:', e)
              }
            }}
          />
        </Tooltip>
      </Space.Compact>
    )
  }

  // Boolean → Switch
  if (valueType === 'boolean') {
    return <Switch checked={!!value} onChange={onChange} />
  }

  // Number → InputNumber
  if (valueType === 'number') {
    return <InputNumber value={value} onChange={(v) => onChange(v ?? 0)} min={0} style={{ width: 200 }} />
  }

  // Proxy 地址
  if (key === 'download.proxy') {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="socks5://127.0.0.1:7890"
        style={{ width: 360 }}
      />
    )
  }

  // Default: string → Input
  return <Input value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 300 }} />
}

/* ============================================================
   配置分组面板
   ============================================================ */
function ConfigGroupPanel({
  groupKey,
  configs,
  onSave,
  onResetGroup,
  saving
}: {
  groupKey: string
  configs: ConfigItem[]
  onSave: (changes: { key: string; value: string; valueType: string }[]) => void
  onResetGroup: (group: string) => void
  saving: boolean
}) {
  const { message } = AntdApp.useApp()

  // 本地编辑状态：{ [configKey]: parsedValue }
  const [localValues, setLocalValues] = useState<Record<string, any>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // 初始化本地值
  useEffect(() => {
    const values: Record<string, any> = {}
    configs.forEach((c) => {
      values[c.key] = parseValue(c.value, c.valueType)
    })
    setLocalValues(values)
    setHasChanges(false)
  }, [configs])

  const handleChange = useCallback((key: string, val: any) => {
    setLocalValues((prev) => ({ ...prev, [key]: val }))
    setHasChanges(true)
  }, [])

  const handleSave = useCallback(() => {
    const changes = configs.map((c) => ({
      key: c.key,
      value: serializeValue(localValues[c.key]),
      valueType: c.valueType
    }))
    onSave(changes)
  }, [configs, localValues, onSave])

  const handleResetItem = useCallback(
    (config: ConfigItem) => {
      if (config.defaultValue !== null && config.defaultValue !== undefined) {
        const parsed = parseValue(config.defaultValue, config.valueType)
        setLocalValues((prev) => ({ ...prev, [config.key]: parsed }))
        setHasChanges(true)
        message.info(`已恢复 "${config.label || config.key}" 到默认值`)
      }
    },
    [message]
  )

  const meta = GROUP_META.find((g) => g.key === groupKey)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Group header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div>
            <Title level={5} style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {meta?.label || groupKey}
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {meta?.description}
            </Text>
          </div>
          <Space>
            <Popconfirm
              title="恢复默认"
              description={`确定要将"${meta?.label || groupKey}"所有配置恢复为默认值吗？`}
              onConfirm={() => onResetGroup(groupKey)}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" icon={<UndoOutlined />}>
                恢复默认
              </Button>
            </Popconfirm>
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              disabled={!hasChanges}
            >
              保存
            </Button>
          </Space>
        </div>
        <Divider style={{ margin: '12px 0' }} />
      </div>

      {/* Config items */}
      {configs.map((config, idx) => (
        <div key={config.id}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              padding: '12px 0',
              gap: 24
            }}
          >
            {/* Left: label + description */}
            <div style={{ flex: '0 0 200px', minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4
                }}
              >
                <Text strong style={{ fontSize: 13 }}>
                  {config.label || config.key}
                </Text>
                {config.isSystem === 1 && (
                  <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    系统
                  </Tag>
                )}
              </div>
              {config.description && (
                <Text type="secondary" style={{ fontSize: 11, lineHeight: '16px' }}>
                  {config.description}
                </Text>
              )}
            </div>

            {/* Right: editor + reset */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: 1,
                justifyContent: 'flex-end'
              }}
            >
              <ConfigItemEditor
                config={config}
                value={localValues[config.key]}
                onChange={(val) => handleChange(config.key, val)}
              />
              {config.defaultValue !== null && config.defaultValue !== undefined && (
                <Tooltip title={`默认值: ${config.defaultValue}`}>
                  <Button
                    type="text"
                    size="small"
                    icon={<UndoOutlined />}
                    onClick={() => handleResetItem(config)}
                    style={{ opacity: 0.5 }}
                  />
                </Tooltip>
              )}
            </div>
          </div>
          {idx < configs.length - 1 && <Divider style={{ margin: 0 }} dashed />}
        </div>
      ))}

      {/* Save hint */}
      {hasChanges && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '12px 16px',
            background: 'linear-gradient(transparent, var(--color-bg-container) 30%)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16
          }}
        >
          <Tag icon={<InfoCircleOutlined />} color="warning">
            有未保存的更改
          </Tag>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
            保存更改
          </Button>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   主页面
   ============================================================ */
export default function ConfigPage() {
  const { message } = AntdApp.useApp()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeGroup, setActiveGroup] = useState('general')
  const [allConfigs, setAllConfigs] = useState<ConfigItem[]>([])

  // --- Fetch all configs ---
  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    try {
      const result = await trpc.config.list.query()
      setAllConfigs(result as ConfigItem[])
    } catch (error) {
      console.error('Failed to fetch configs:', error)
      message.error('获取配置失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  // --- Grouped configs ---
  const groupedConfigs = useMemo(() => {
    const map: Record<string, ConfigItem[]> = {}
    allConfigs.forEach((c) => {
      if (!map[c.group]) map[c.group] = []
      map[c.group].push(c)
    })
    // Sort each group by order
    Object.keys(map).forEach((g) => {
      map[g].sort((a, b) => a.order - b.order)
    })
    return map
  }, [allConfigs])

  // --- Count per group ---
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    allConfigs.forEach((c) => {
      counts[c.group] = (counts[c.group] || 0) + 1
    })
    return counts
  }, [allConfigs])

  // --- Save handler ---
  const handleSave = useCallback(
    async (changes: { key: string; value: string; valueType: string }[]) => {
      setSaving(true)
      try {
        await trpc.config.batchSet.mutate(
          changes.map((c) => ({
            key: c.key,
            value: c.value,
            group: activeGroup,
            valueType: c.valueType as 'string' | 'number' | 'boolean' | 'json'
          }))
        )
        message.success({
          content: '配置已保存',
          icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />
        })
        await fetchConfigs()
      } catch (error) {
        console.error('Failed to save configs:', error)
        message.error('保存配置失败')
      } finally {
        setSaving(false)
      }
    },
    [activeGroup, fetchConfigs, message]
  )

  // --- Reset group handler ---
  const handleResetGroup = useCallback(
    async (group: string) => {
      setSaving(true)
      try {
        await trpc.config.resetGroupToDefault.mutate({ group })
        message.success('已恢复默认设置')
        await fetchConfigs()
      } catch (error) {
        console.error('Failed to reset group:', error)
        message.error('恢复默认失败')
      } finally {
        setSaving(false)
      }
    },
    [fetchConfigs, message]
  )

  // --- Tabs items ---
  const tabItems = useMemo(
    () =>
      GROUP_META.filter((g) => groupedConfigs[g.key]?.length > 0).map((g) => ({
        key: g.key,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {g.icon}
            <span>{g.label}</span>
            <Tag
              style={{
                fontSize: 10,
                lineHeight: '16px',
                padding: '0 4px',
                marginLeft: 2,
                borderRadius: 8
              }}
            >
              {groupCounts[g.key] || 0}
            </Tag>
          </span>
        ),
        children: (
          <div style={{ padding: '8px 0' }}>
            <ConfigGroupPanel
              groupKey={g.key}
              configs={groupedConfigs[g.key] || []}
              onSave={handleSave}
              onResetGroup={handleResetGroup}
              saving={saving}
            />
          </div>
        )
      })),
    [groupedConfigs, groupCounts, handleSave, handleResetGroup, saving]
  )

  if (loading) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-layout)'
        }}
      >
        <Spin size="large" tip="加载配置中..." />
      </div>
    )
  }

  return (
    <div
      className="config-page"
      style={{
        height: '100%',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-layout)',
        overflow: 'auto'
      }}
    >
      <Card variant="borderless" styles={{ body: { padding: '16px 24px' } }}>
        {/* Page header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8
          }}
        >
          <Space size="middle">
            <div
              style={{
                width: 36,
                height: 36,
                background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <SettingOutlined style={{ fontSize: 18, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                系统配置
              </Title>
              <Text type="secondary" style={{ fontSize: 11 }}>
                管理应用偏好设置与系统参数
              </Text>
            </div>
          </Space>
          <Text type="secondary" style={{ fontSize: 11 }}>
            共 {allConfigs.length} 项配置
          </Text>
        </div>

        <Divider style={{ margin: '8px 0 0' }} />

        {/* Tab navigation */}
        <Tabs
          activeKey={activeGroup}
          onChange={setActiveGroup}
          items={tabItems}
          size="small"
          style={{ marginTop: -1 }}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </Card>

      <style>{`
        .config-page .ant-card {
          background: var(--color-bg-container);
          border-radius: 8px;
        }
        .config-page .ant-tabs-tab {
          padding: 8px 4px !important;
          font-size: 12px !important;
        }
        .config-page .ant-tabs-tab-active {
          font-weight: 600 !important;
        }
        .config-page .ant-divider-dashed {
          border-color: var(--color-border-secondary, rgba(0,0,0,0.04));
        }
        .config-page .ant-switch {
          min-width: 36px;
        }
      `}</style>
    </div>
  )
}
