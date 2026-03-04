# Inspiration - 媒体资源嗅探桌面应用

## 项目概述

Inspiration 是一款基于 Electron + React + TypeScript 开发的桌面浏览器应用，核心功能是**媒体资源嗅探**。它可以在用户浏览网页时自动捕获视频、音频、图片等媒体资源，并提供下载、收藏、预览等功能。

**主要特性：**

- 内嵌浏览器功能（类似简易版浏览器）
- 三层媒体资源嗅探器（DOM 扫描 + 响应头分析 + ffprobe 探测）
- 收藏夹管理（支持分组、站点 favicon 持久化）
- 素材资源库管理
- 系统配置面板
- 无窗口边框自定义标题栏

---

## 技术栈

### 核心框架

| 类别     | 技术          | 版本    |
| -------- | ------------- | ------- |
| 桌面框架 | Electron      | ^39.2.6 |
| 前端框架 | React         | ^19.2.1 |
| 构建工具 | electron-vite | ^5.0.0  |
| 语言     | TypeScript    | ^5.9.3  |
| 包管理器 | pnpm          | -       |

### 前端生态

| 类别      | 技术                | 版本    |
| --------- | ------------------- | ------- |
| UI 组件库 | antd (Ant Design)   | ^6.2.2  |
| 图标      | @ant-design/icons   | ^6.1.0  |
| 拖拽排序  | @dnd-kit/core       | ^6.3.1  |
|           | @dnd-kit/sortable   | ^10.0.0 |
| 状态/通信 | @trpc/server/client | ^11.9.0 |

### 后端/数据层

| 类别       | 技术           | 版本    |
| ---------- | -------------- | ------- |
| ORM        | drizzle-orm    | ^0.45.1 |
| 数据库     | better-sqlite3 | ^12.6.2 |
| 数据库工具 | drizzle-kit    | ^0.31.8 |
| 数据校验   | zod            | ^3.24.1 |
|            | drizzle-zod    | ^0.8.3  |

### 多媒体处理

| 类别         | 技术           | 版本   |
| ------------ | -------------- | ------ |
| ffmpeg 工具  | ffmpeg-static  | ^5.3.0 |
| ffprobe 工具 | ffprobe-static | ^3.1.0 |
| ffmpeg 封装  | fluent-ffmpeg  | ^2.1.3 |

### 开发工具链

| 类别            | 技术                 | 版本    |
| --------------- | -------------------- | ------- |
| 代码规范        | ESLint               | ^9.39.1 |
| 代码格式化      | Prettier             | ^3.7.4  |
| Electron 工具包 | @electron-toolkit/\* | ^4.0.0  |
| 日志            | electron-log         | ^5.4.3  |
| 自动更新        | electron-updater     | ^6.3.9  |
| 环境变量        | dotenv               | ^17.2.4 |

---

## 功能模块

### 1. 浏览器核心 (Main Browser)

- **多标签页管理**：支持打开多个网页标签，支持标签切换、关闭、关闭其他等操作
- **导航控制**：前进、后退、刷新
- **地址栏**：支持 URL 输入和搜索引擎跳转
- **自定义标题栏**：无边框窗口，包含标签栏和窗口控制按钮（最小化、最大化、关闭）

### 2. 媒体资源嗅探器 (Sniffer)

**三层嗅探架构：**

- **Layer 1 - DOM 扫描**：通过 `executeJavaScript` 扫描页面中的 `<img>`、`<video>`、`<audio>`、`<script>` 等标签
- **Layer 2 - 响应头分析**：`onResponseStarted` 监听，通过 `Content-Type` 直接确认媒体类型
- **Layer 3 - ffprobe 兜底**：对模糊类型（`application/octet-stream`）进行探测，结合 URL 启发式分析

**嗅探功能：**

- 自动捕获视频（mp4, webm, mkv, flv, m3u8, mpd 等）
- 自动捕获音频（mp3, aac, ogg, flac, wav 等）
- 自动捕获图片（jpg, png, gif, webp, avif 等）
- 携带原始请求头（Cookie、Referer）解决 403 问题
- 资源预览、下载、复制链接

### 3. 收藏夹系统 (Bookmarks)

- 分组管理（树形结构）
- 站点 favicon 自动持久化（Base64 存储）
- 支持独立 session/partition（每个标签页可拥有独立的 Cookie 和存储）

### 4. 素材资源库 (Resource Library)

- 下载的媒体资源统一管理
- 支持平台、类型、元数据存储

### 5. 系统配置 (System Config)

- Key-Value 模式的配置存储
- 配置分组：general、download、sniffer、appearance、shortcut、advanced

### 6. 协议拦截

- 拦截自定义协议（bitbrowser, bytedance, snssdk 等），防止意外弹窗
- WebView 内安全链接过滤

---

## UI 风格

### 整体风格

- **现代简洁**：基于 Ant Design 6.x 的紧凑主题
- **深色/浅色主题支持**（基于 antd 主题配置）
- **紧凑布局**：使用 `compact` 主题 token，减小间距和字号

### 主题配置

```typescript
const antdTheme = {
  token: {
    colorPrimary: '#1677ff',
    fontSize: 12,
    borderRadius: 4,
    controlHeight: 28
  },
  components: {
    Button: { controlHeight: 24, paddingInline: 8 },
    Input: { controlHeight: 26 },
    Select: { controlHeight: 26 }
  }
}
```

### 布局结构

```
┌─────────────────────────────────────────────────────────┐
│  TitleBar (自定义标题栏 + 标签页)                         │
├──────────┬──────────────────────────────────────────────┤
│          │  Content Area                                │
│  Left    │  ┌────────────────────────────────────────┐  │
│  Sidebar │  │  WebView / Resource Page / Config Page  │  │
│          │  │                                        │  │
│  (收藏夹) │  └────────────────────────────────────────┘  │
│          ├──────────────────────────────────────────────┤
│          │  Sniffer Panel (右侧嗅探面板，可折叠)          │
├──────────┴──────────────────────────────────────────────┤
│  Status Bar                                             │
└─────────────────────────────────────────────────────────┘
```

### 组件设计

- **TitleBar**：集成导航、地址栏、标签管理、窗口控制
- **LeftSidebar**：收藏夹树形导航，支持折叠
- **MainContent**：WebView 嵌入或内部页面渲染
- **SnifferPanel**：资源列表、搜索、批量操作
- **PreviewModal**：媒体预览（图片/视频/音频）
- **FloatingCompass**：悬浮罗盘（快捷导航）

---

## 架构设计

### 目录结构

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 应用入口，窗口管理
│   ├── logger.ts            # 日志初始化
│   ├── router.ts            # tRPC 主路由聚合
│   ├── trpc.ts              # tRPC IPC 处理器
│   ├── db/                  # 数据库初始化和种子数据
│   │   ├── index.ts
│   │   └── seeds.ts
│   ├── routers/             # 业务路由
│   │   ├── sniffer.ts       # 嗅探器核心逻辑
│   │   ├── ffmpeg.ts        # FFmpeg 处理
│   │   ├── system.ts        # 系统操作（窗口控制）
│   │   └── ...
│   └── migrations/          # Drizzle 迁移文件
│
├── preload/                 # 预加载脚本
│   └── index.ts             # 暴露 IPC 桥接
│
├── renderer/                # React 前端
│   ├── index.html
│   └── src/
│       ├── App.tsx          # 主应用组件
│       ├── main.tsx         # 入口
│       ├── components/      # UI 组件
│       │   ├── TitleBar/
│       │   ├── LeftSidebar/
│       │   ├── MainContent/
│       │   ├── SnifferPanel/
│       │   ├── PreviewModal/
│       │   └── ...
│       ├── pages/           # 页面组件
│       │   ├── config.tsx
│       │   └── resource.tsx
│       ├── lib/              # 工具库
│       │   └── trpc.ts       # tRPC 客户端
│       ├── app/              # 应用级目录
│       │   ├── constants/
│       │   ├── hooks/
│       │   └── utils/
│       ├── assets/          # 静态资源
│       │   └── main.css
│       └── types/
│
└── shared/                  # 主进程和渲染进程共享
    ├── db/                  # 数据库 Schema
    │   ├── index.ts
    │   ├── base.ts          # 基础字段定义
    │   ├── bookmark-schema.ts
    │   ├── config-schema.ts
    │   └── resource-schema.ts
    └── routers/             # tRPC 路由定义（共享）
        ├── router.ts
        ├── trpc.ts
        ├── bookmark.ts
        ├── config.ts
        └── resource.ts
```

### 进程间通信

- **tRPC**：主推方式，用于业务逻辑调用
  - 主进程：`@trpc/server` + `ipcMain.handle`
  - 渲染进程：`@trpc/client` + `createTRPCReact`
- **IPC 桥接**：Preload 脚本暴露 `snifferBridge` 用于实时事件推送

### 数据流

```
User Action → React Component → tRPC Client
                                     ↓
                              IPC Channel
                                     ↓
                              tRPC Server (Main)
                                     ↓
                              SQLite (better-sqlite3)
```

### 数据库设计

- **better-sqlite3**：同步操作，高性能
- **drizzle-orm**：类型安全的 ORM
- **drizzle-kit**：迁移管理
- **Schema 共享**：`src/shared/db` 同时被 main 和 build 输出使用

---

## 代码规范

### 语言规范

- **TypeScript**：全项目使用 TypeScript，严格类型检查
- **ESLint**：代码质量检查，基于 `@electron-toolkit/eslint-config-ts`
- **Prettier**：代码格式化
- **EditorConfig**：编辑器统一配置

### Prettier 配置

```yaml
singleQuote: true # 使用单引号
semi: false # 不使用分号
printWidth: 120 # 行宽 120
trailingComma: none # 不使用尾随逗号
```

### ESLint 规则

- 关闭：`@typescript-eslint/no-explicit-any`、`explicit-function-return-type`
- 警告：`@typescript-eslint/no-unused-vars`、`prefer-const`
- React Hooks：启用 `eslint-plugin-react-hooks`
- React Refresh：支持 Vite HMR

### 代码风格

- **组件文件结构**：组件代码直接写在 `index.tsx` 中，不拆分单独文件
- **Hooks 分离**：复杂逻辑提取到 `app/hooks/` 目录
- **类型定义**：统一放在 `types/` 目录或组件同级目录
- **Schema 导出**：`src/shared/db` 集中管理所有数据表 Schema

### 数据库 Schema 规范

- 使用 `drizzle-orm` 定义表结构
- 使用 `drizzle-zod` 自动生成 Zod 验证 Schema
- 统一导出类型：`$inferSelect`（查询）、`$inferInsert`（插入）
- 基础字段（id, createdAt, updatedAt）统一在 `base.ts` 中管理

### 命名规范

- **文件命名**：
  - 组件目录：`PascalCase`（如 `TitleBar/`）
  - 组件文件：`index.tsx`（目录即组件）
  - 其他文件：`camelCase`（如 `trpc.ts`、`sniffer.ts`）
- **变量命名**：
  - 组件：`PascalCase`
  - 函数/变量：`camelCase`
  - 常量：`UPPER_SNAKE_CASE`
- **CSS 类名**：BEM 风格或 `kebab-case`

---

## 常用库

### UI 库

| 库                | 用途      | 关键特性                   |
| ----------------- | --------- | -------------------------- |
| antd              | UI 组件库 | 完整的企业级组件，主题定制 |
| @ant-design/icons | 图标库    | 配套 antd 的图标集         |

### 拖拽交互

| 库                 | 用途         |
| ------------------ | ------------ |
| @dnd-kit/core      | 拖拽核心     |
| @dnd-kit/sortable  | 排序列表     |
| @dnd-kit/utilities | 拖拽工具函数 |

### 数据层

| 库             | 用途          |
| -------------- | ------------- |
| drizzle-orm    | Type-safe ORM |
| better-sqlite3 | SQLite 驱动   |
| drizzle-kit    | 迁移管理      |
| zod            | 运行时校验    |
| drizzle-zod    | Zod 集成      |

### Electron 生态

| 库                   | 用途                 |
| -------------------- | -------------------- |
| electron-vite        | Vite + Electron 构建 |
| @electron-toolkit/\* | Electron 工具集      |
| electron-log         | 日志系统             |
| electron-builder     | 打包发布             |

### 多媒体

| 库             | 用途            |
| -------------- | --------------- |
| fluent-ffmpeg  | FFmpeg 命令封装 |
| ffmpeg-static  | FFmpeg 二进制   |
| ffprobe-static | ffprobe 二进制  |

### 通信

| 库           | 用途        |
| ------------ | ----------- |
| @trpc/server | 服务端 tRPC |
| @trpc/client | 客户端 tRPC |
| zod          | 输入校验    |

---

## 最佳实践

### 1. 项目初始化

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 数据库迁移
pnpm db:run    # generate + migrate
pnpm db:push   # push schema to db
pnpm db:studio # GUI 管理
```

### 2. 添加新功能流程

1. **定义 Schema**：在 `src/shared/db/` 中添加数据表
2. **编写 Router**：在 `src/shared/routers/` 或 `src/main/routers/` 中实现逻辑
3. **创建组件**：在 `src/renderer/src/components/` 中创建 UI
4. **连接前端**：在 `App.tsx` 中使用 tRPC 调用后端

### 3. 数据库操作

```typescript
// 查询
const result = await db.select().from(bookmarks).all()

// 插入
await db.insert(bookmarks).values({ name: '新书签', type: 2 })

// 更新
await db.update(bookmarks).set({ name: '新名称' }).where(eq(bookmarks.id, id))

// 删除
await db.delete(bookmarks).where(eq(bookmarks.id, id))
```

### 4. tRPC 调用

```typescript
// 后端定义
export const bookmarkRouter = router({
  list: publicProcedure.query(async () => { ... }),
  create: publicProcedure
    .input(bookmarkCreateSchema)
    .mutation(async ({ input }) => { ... }),
})

// 前端调用
const bookmarks = await trpc.bookmark.list.query()
await trpc.bookmark.create.mutate({ name: 'test', type: 2 })
```

### 5. 预加载脚本

```typescript
// 暴露 API 到渲染.exposeInMain进程
contextBridgeWorld('api', {
  // 自定义方法
})

// 事件推送（主 → 渲染）
ipcRenderer.on('channel-name', (event, data) => {
  // 处理
})
```

### 6. 日志使用

```typescript
import log from './logger'

log.info('应用启动')
log.debug('调试信息', { data })
log.error('错误', error)
```

### 7. 样式管理

- 使用 CSS 模块或全局 CSS 文件
- 通过 `main.css` 定义全局样式
- 组件特定样式使用 `index.module.css` 或内联

### 8. 配置管理

- 开发环境：项目根目录 `out/db.sqlite`
- 生产环境：`app.getPath('userData')`
- 环境判断：`import { is } from '@electron-toolkit/utils'`

---

## 构建与发布

### 构建命令

```bash
# 开发预览
pnpm start

# Windows 构建
pnpm build:win

# macOS 构建
pnpm build:mac

# Linux 构建
pnpm build:linux

# 仅打包（不签名）
pnpm build:unpack
```

### 打包配置

- 入口：`electron-builder.yml`
- 输出：`dist/`
- Windows：NSIS 安装包
- macOS：DMG
- Linux：AppImage

---

## 开发提示

### 常用快捷键

| 快捷键 | 功能           |
| ------ | -------------- |
| F12    | 开发者工具     |
| Ctrl+R | 刷新（开发时） |

### 调试技巧

1. **主进程调试**：在 VSCode 中添加调试配置
2. **渲染进程调试**：F12 打开 DevTools
3. **数据库调试**：`pnpm db:studio` 打开 GUI

### 常见问题

1. **Native 模块构建失败**：确保运行 `pnpm postinstall`
2. **热更新不生效**：检查 `electron-vite` 配置
3. **数据库锁定**：确保没有多个实例同时运行
