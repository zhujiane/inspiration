# 项目优化建议报告

## 一、UI 设计层面优化

### 1.1 视觉体验优化

| 问题 | 描述 | 建议 |
|------|------|------|
| 主题定制性不足 | 目前使用硬编码的主题色 `#1677ff`，缺少深色模式支持 | 引入 CSS 变量支持亮/暗主题切换 |
| 字号偏小 | `fontSize: 12` 在高分辨率屏幕上可读性差 | 提供字体大小设置选项，默认 14px |
| 间距一致性 | 组件间距使用魔法数字 | 统一使用 design token 变量 |

### 1.2 交互体验优化

| 问题 | 描述 | 建议 |
|------|------|------|
| 侧边栏折叠动画生硬 | 缺少平滑过渡效果 | 添加 CSS transition 动画 |
| 标签页滚动不流畅 | 滚轮横向滚动体验一般 | 优化滚动行为或添加拖拽排序 |
| 嗅探面板展开无动画 | 面板收起/展开瞬间完成 | 添加滑入滑出动画 |
| 缺少加载状态反馈 | 书签删除等操作无明显反馈 | 添加骨架屏或加载指示器 |

### 1.3 组件优化

```
优化点:
1. TitleBar: 窗口控制按钮在 Linux/Mac 上应显示为标准按钮样式
2. SnifferPanel: 批量操作按钮的 badge 应跟随选中数量实时更新
3. MediaCard: 长标题应支持省略和 tooltip 完整显示
4. FloatingCompass: 考虑增加键盘快捷键支持
```

---

## 二、Preload 层优化

### 2.1 类型安全增强

**当前问题:**
- `TrpcRequest` 类型定义缺少完整的泛型支持
- 回调函数使用 `any` 类型，丢失类型信息

```src/preload/index.ts:6
type TrpcRequest = { path: string; input: unknown; type: 'query' | 'mutation' | 'subscription' }
```

**优化建议:**
```typescript
// 改进类型定义
type TrpcRequest<TInput = unknown, TOutput = unknown> = {
  path: string
  input: TInput
  type: 'query' | 'mutation' | 'subscription'
  signal?: AbortSignal
}

// 添加类型安全的回调注册
interface SnifferCallbacks {
  onResource: (data: MediaResource) => void
  onStats: (data: SnifferStats) => void
}
```

### 2.2 API 扩展

| 改进点 | 当前实现 | 建议 |
|--------|----------|------|
| 事件监听移除 | 手动返回取消函数 | 返回 `Unsubscriber` 接口统一管理 |
| 错误处理 | 静默 catch 错误 | 增加全局错误回调 |
| 连接状态 | 无断线重连机制 | 添加心跳检测和重连 |

### 2.3 安全加固

```typescript
// 当前: 缺少 URL 验证
const trpcBridge = {
  invoke: (payload: TrpcRequest) => ipcRenderer.invoke('trpc-request', payload)
}

// 建议: 添加输入验证
const trpcBridge = {
  invoke: <T extends TrpcRequest>(payload: T) => {
    if (!isValidPath(payload.path)) {
      throw new Error('Invalid path')
    }
    return ipcRenderer.invoke('trpc-request', payload)
  }
}
```

---

## 三、Shared 层优化

### 3.1 数据库 Schema 优化

**问题 1: 索引缺失**
```src/shared/db/config-schema.ts:21-41
export const configs = sqliteTable('configs', {
  key: text('key').notNull(),      // 缺少索引
  group: text('group').notNull().default('general'), // 缺少复合索引
})
```

**建议添加:**
```typescript
// config-schema.ts
key: text('key').notNull().unique(),  // key 应该唯一
// 或创建索引
index('idx_config_key_group').on(configs.key, configs.group)
```

**问题 2: 批量操作效率低**
```src/shared/routers/config.ts:200-222
// 当前: 循环中逐条更新/插入
for (const item of input) {
  const [existing] = await db.select().from(configs).where(eq(configs.key, key))
  // ... 逐条处理
}
```

**建议: 使用批量操作**
```typescript
// 使用 upsert 语法
const results = await db.insert(configs)
  .values(items.map(item => ({...})))
  .onConflictDoUpdate({
    target: [configs.key, configs.group],
    set: { value: excluded.value }
  })
  .returning()
```

### 3.2 tRPC 路由优化

| 问题 | 建议 |
|------|------|
| `list` 查询无分页 | 添加 pagination 支持 |
| 缺少缓存机制 | 考虑添加 tRPC 内置缓存 |
| 中间件日志冗余 | 生产环境关闭 console.log |

### 3.3 代码复用

**当前:** 辅助函数分散在各个 router 文件中
**建议:** 提取到统一工具库

```typescript
// src/shared/utils/db.ts
export function parseConfigValue(value: string, valueType: ConfigValueType): unknown
export function serializeConfigValue(value: unknown): string
export async function paginateQuery<T>(query: SelectQueryBuilder<T>, page: number, pageSize: number)
```

---

## 四、Renderer 层优化

### 4.1 性能优化

**问题 1: 状态管理过于集中**
```src/renderer/src/App.tsx:1-627
// 单个组件包含大量状态
const [tabs, setTabs] = useState<Tab[]>([])
const [resources, setResources] = useState<MediaResource[]>([])
const [snifferStats, setSnifferStats] = useState<SnifferStats>(...)
// ... 30+ 个 useState
```

**建议:** 使用 Context 拆分或 Zustand 状态管理

**问题 2: useEffect 依赖不精确**
```src/renderer/src/App.tsx:185-187
useEffect(() => {
  fetchBookmarkGroups()
}, [fetchBookmarkGroups]) // fetchBookmarkGroups 是 useCallback，仍会触发重渲染
```

**建议:** 使用 useCallback + useRef 模式减少不必要的重新获取

**问题 3: 列表渲染无虚拟化**
```src/renderer/src/components/SnifferPanel/index.tsx:206-218
// 大量资源时会出现性能问题
resources.map((res) => <MediaCard key={res.id} ... />)
```

**建议:** 使用 `react-window` 或 `virtua` 实现虚拟列表

### 4.2 代码质量

**问题 1: any 类型滥用**
```src/renderer/src/App.tsx:73-74
const [allBookmarks, setAllBookmarks] = useState<any[]>([])
const [bookmarkGroups, setBookmarkGroups] = useState<any[]>([])
```

**建议:** 引入 proper 类型定义

**问题 2: 魔法字符串**
```src/renderer/src/App.tsx:79-82
const getActivePartition = useCallback(() => {
  const tab = tabs.find((t) => t.id === activeTabId)
  return tab?.userDataPath ? `persist:${tab.userDataPath}` : 'persist:default'
}, [tabs, activeTabId])
```

**建议:** 提取常量
```typescript
const PARTITION_PREFIX = 'persist:'
const DEFAULT_PARTITION = 'persist:default'
```

**问题 3: 内联样式**
```src/renderer/src/components/MainContent/index.tsx:208
style={{ display: isActive ? 'block' : 'none', height: '100%', width: '100%', overflow: 'auto' }}
```

**建议:** 使用 CSS classes 或 styled-components

### 4.3 组件拆分建议

| 当前组件 | 问题 | 建议拆分 |
|----------|------|----------|
| App.tsx | 600+ 行 | 拆分 hooks: useBookmarks, useSniffer, useNavigation |
| MainContent | 功能过多 | 拆分 WebviewManager, PageRenderer |
| LeftSidebar | 700+ 行 | 拆分 SortableGroup, SortableItem 为独立文件 |

### 4.4 错误处理增强

```typescript
// 当前: 静默失败
.catch(() => {})

// 建议: 统一错误边界
// src/renderer/src/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  
  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(error, info)
  }
}
```

---

## 五、综合建议

### 5.1 架构优化路线图

```
Phase 1: 类型安全 (1-2天)
├── 完善 preload 类型定义
├── 移除 any 类型
└── 添加 Zod schema 验证

Phase 2: 性能优化 (2-3天)
├── 实现列表虚拟化
├── 优化 useEffect 依赖
└── 添加 React.memo

Phase 3: 状态管理重构 (3-5天)
├── 拆分 App.tsx 状态
├── 引入 Zustand
└── 实现数据缓存层

Phase 4: UI/UX 提升 (2-3天)
├── 添加主题切换
├── 完善动画效果
└── 优化加载状态
```

### 5.2 重点优先项

1. **高优先级**: Preload 类型安全增强、列表虚拟化
2. **中优先级**: 数据库批量操作优化、主题切换
3. **低优先级**: 动画细节、代码拆分

---

*报告生成时间: 2026-03-03*
