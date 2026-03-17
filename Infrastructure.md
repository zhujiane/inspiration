# Inspiration

Inspiration 是一个基于 Electron + React + TypeScript 的桌面媒体资源嗅探工具。它提供内嵌浏览器、媒体资源识别、预览、批量下载和资源管理能力，适合作为个人效率工具或二次开发基础。

## License

本项目采用半开源的 source-available 发布方式。

- 源码可查看、可自行修改、可用于个人和内部用途
- 默认不允许商用分发、SaaS 化托管、二次售卖
- 详细条款见 [LICENSE](./LICENSE)

如果你计划将本项目用于商业产品、客户交付、托管服务或二次销售，需要额外获得授权。

## Release

面向普通用户的安装包会发布在 GitHub Releases 页面。

- Windows: 下载 `inspiration-x.y.z-setup.exe`
- 首次运行如出现安全提示，请校验发布页信息后再决定是否继续
- 当前仓库已包含 GitHub Actions 发布流程，推送 `v*` 标签后可自动构建 Release

## Features

- 内嵌多标签浏览器
- 三层媒体资源嗅探
- 视频、音频、图片资源识别与预览
- 批量下载与资源管理
- 收藏夹和站点图标持久化
- 本地 SQLite 数据存储

## Compliance Notice

本工具只应用于你有权访问和保存的内容。

- 不承诺适配所有网站
- 不包含 DRM 绕过能力
- 用户需自行遵守目标网站服务条款及所在地法律法规

## Screenshots

建议在这里补 2 到 4 张真实界面截图，至少包含：

- 主界面
- 嗅探面板
- 批量下载或资源管理页面

## Installation

### For End Users

1. 打开 GitHub Releases
2. 下载最新的 Windows 安装包
3. 安装并启动应用

### For Developers

要求：

- Node.js 22+
- pnpm 10+
- Windows 环境下构建 Windows 安装包

安装依赖：

```bash
pnpm install
```

启动开发环境：

```bash
npm run dev
```

类型检查与构建：

```bash
npm run typecheck
npm run build
```

构建安装包：

```bash
npm run build:win
```

## Release Workflow

仓库已提供 GitHub Actions 工作流：[release.yml](./.github/workflows/release.yml)

发布步骤：

1. 更新 [package.json](./package.json) 中的版本号
2. 提交变更
3. 打标签并推送

```bash
git tag v1.0.0
git push origin main --tags
```

工作流会在 GitHub 上自动：

- 安装依赖
- 构建 Windows 安装包
- 创建或更新对应版本的 Release
- 上传安装包和相关更新文件

## Project Structure

```text
src/
  main/        Electron 主进程
  preload/     预加载桥接
  renderer/    React 渲染进程
  shared/      主进程与渲染进程共享模块
```

## Stack

- Electron
- React
- TypeScript
- electron-vite
- Ant Design
- tRPC
- Drizzle ORM
- better-sqlite3
- ffmpeg-static

## Notes Before Publishing Publicly

正式公开前，建议你逐项确认：

- 是否移除了私有接口地址、密钥、测试账号和内部说明
- 是否确认许可证文本符合你的商业边界
- 是否补充了真实截图、下载地址和项目主页
- 是否准备了 `CHANGELOG.md` 和 issue 模板
- 是否验证过安装包在全新 Windows 环境可以正常运行

## Roadmap

- 完善自动更新发布链路
- 区分 Community 与 Pro 能力边界
- 补齐贡献指南、变更日志和问题模板
