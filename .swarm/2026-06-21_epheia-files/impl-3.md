---
step: 3
agent: implementer
task: frontend-application
upstream:
  - .swarm/2026-06-21_epheia-files/architecture.md
  - .swarm/2026-06-21_epheia-files/plan.md
  - DESIGN.md
  - packages/shared/src/types.ts
  - packages/backend/src/index.ts
produced_at: 2026-06-21T01:30:00+08:00
status: completed
estimated_time: ~3.5h
tdd_mode: false
tdd_cycles: 0
---

## 实现摘要

完成了 epheia-files 的完整 React 前端应用（Task #3）。所有计划阶段（A-N）均已实现，TypeScript 编译零错误，Vite 生产构建成功，PWA service worker 已生成。

Git commit: `8c2faa1`

## 变更清单

### Phase A: 项目脚手架 (7 文件)
- [x] `packages/frontend/package.json` — npm 包配置，React 18 + Vite + Tailwind + framer-motion
- [x] `packages/frontend/vite.config.ts` — Vite 配置（React 插件、PWA 插件、API 代理）
- [x] `packages/frontend/tsconfig.json` — TS 配置，路径别名 @/ 和 @shared/
- [x] `packages/frontend/tsconfig.node.json` — Vite 配置文件的 TS 配置
- [x] `packages/frontend/index.html` — 入口 HTML，Google Fonts 预连接，meta 标签
- [x] `packages/frontend/postcss.config.js` — PostCSS + Tailwind CSS + Autoprefixer
- [x] `packages/frontend/tailwind.config.js` — Tailwind 主题扩展（所有 DESIGN.md 令牌）
- [x] `.gitignore` — 添加 `packages/frontend/dist/` 排除
- [x] `pnpm-workspace.yaml` — 排除 frontend 包（使用 npm 管理）
- [x] `package.json` (root) — 添加 `dev:frontend` 和 `build:frontend` 脚本

### Phase B: 设计系统 & i18n (2 文件)
- [x] `src/styles/globals.css` — CSS 自定义属性（54 个设计令牌）、Tailwind 指令、全局样式重置、自定义滚动条、无障碍焦点样式
- [x] `src/i18n/index.ts` — 完整 i18n 系统：t() 函数、zh-CN/en-US 翻译（80+ 键）、语言检测、localStorage 持久化

### Phase C: API 客户端 (1 文件)
- [x] `src/lib/api.ts` — 类型化 fetch 封装：Bearer 令牌自动附加、401 拦截、25 个 API 方法（auth/rooms/files/chat/admin/ws）

### Phase D: 状态管理 (2 文件)
- [x] `src/lib/store.ts` — Zustand 全局状态：认证、当前房间、消息列表、文件列表、在线成员、设备标签、Toast 通知
- [x] `src/lib/device.ts` — User-Agent 解析：OS + 浏览器检测，生成如 "Windows Chrome" 的设备标签

### Phase E: E2EE 加密 (1 文件)
- [x] `src/lib/crypto.ts` — Web Crypto API 封装：
  - 32 字节随机密钥生成
  - Crockford Base32 编解码（无 I/L/O/U）
  - 分享字符串格式 "ROOM-KEY-KEY-KEY"
  - SHA-256 密钥哈希（用于服务端验证）
  - AES-256-GCM 加密/解密（消息和文件）
  - localStorage 密钥持久化

### Phase F: WebSocket 客户端 (1 文件)
- [x] `src/lib/ws.ts` — RoomSocket 类：
  - 票据式 WS 连接
  - 事件处理器：message/recall/file_shared/presence
  - 指数退避自动重连（1s→30s 上限，20 次尝试）

### Phase G: 页面 (4 文件)
- [x] `src/pages/LoginPage.tsx` — 3 标签登录（管理员/API密钥/临时凭证）、摇动错误动画、Claude 风格设计
- [x] `src/pages/RoomListPage.tsx` — 房间列表 + 创建/加入、QR 分享模态框、交错动画
- [x] `src/pages/RoomPage.tsx` — 聊天/传输双标签页、WebSocket 连接、E2EE 解密、在线成员显示
- [x] `src/pages/AdminPage.tsx` — 统计卡片、凭证创建、房间销毁（含确认）

### Phase H: 聊天组件 (4 文件)
- [x] `src/components/chat/ChatPage.tsx` — 消息列表 + 输入框 + 在线成员侧边栏
- [x] `src/components/chat/MessageList.tsx` — 交错弹簧动画的消息列表、空状态处理
- [x] `src/components/chat/MessageBubble.tsx` — 设备标签、解密内容、自动折叠长文本、右键/长按撤回菜单
- [x] `src/components/chat/ChatInput.tsx` — 自动调整高度的文本域、圆形珊瑚色发送按钮、脉冲动画

### Phase I: 传输组件 (4 文件)
- [x] `src/components/transfer/TransferPage.tsx` — 文本/文件双标签页、上传区域
- [x] `src/components/transfer/FileList.tsx` — 多选批量删除、交错动画、加载状态
- [x] `src/components/transfer/FileItem.tsx` — MIME 类型图标、展开/折叠元数据、下载/撤回按钮、过期倒计时、可见性标记
- [x] `src/components/transfer/UploadZone.tsx` — 拖放/点击/粘贴上传、文件加密、分片上传、进度跟踪

### Phase J: 上传系统 (1 文件)
- [x] `src/components/transfer/UploadProgress.tsx` — 弹簧动画进度条、取消按钮、状态指示

### Phase K: PWA (5 文件)
- [x] `public/manifest.json` — PWA 清单（SVG 图标、cream 主题色、dark 背景色）
- [x] `public/favicon.svg` — 珊瑚色文件夹图标
- [x] `public/icons/icon-192.svg` — 192px PWA 图标
- [x] `public/icons/icon-512.svg` — 512px PWA 图标
- [x] `vite.config.ts` PWA 配置 — NetworkFirst API 缓存、CacheFirst 静态资源、离线后备、autoUpdate 注册

### Phase L: 动画 (内嵌于各组件)
- [x] 页面过渡：淡入 + Y 偏移（App.tsx）
- [x] 消息气泡：弹簧入场（stiffness: 300, damping: 30）
- [x] 标签切换：水平滑动（spring stiffness: 400, damping: 35）
- [x] 上下文菜单：缩放 + 淡入（duration: 0.15s）
- [x] 列表项：交错子项（50ms 延迟）
- [x] 进度条：弹性缓出（spring stiffness: 200, damping: 25）
- [x] 按钮：悬停缩放(1.02) / 按下缩放(0.98)
- [x] 底部弹出/模态框：从底部滑入（spring damping: 30, stiffness: 300）
- [x] QR 码：缩放 + 旋转展示（spring stiffness: 260, damping: 20）

### Phase M: QR 分享 (1 文件)
- [x] `src/components/shared/QRShare.tsx` — qrcode 包生成 QR、复制按钮、导出密钥文件、弹簧动画展示

### Phase N: UI 组件 (11 文件)
- [x] `Button.tsx` — 5 种变体（primary/secondary/dark/ghost/danger）、3 种尺寸、加载状态、图标支持
- [x] `Input.tsx` — 标签、错误状态（珊瑚色聚焦环）、提示文本、aria 属性
- [x] `Card.tsx` — 3 种变体（cream/dark/flat）、4 种内边距
- [x] `Badge.tsx` — 5 种变体（default/coral/success/error/warning）、药丸形状
- [x] `TabBar.tsx` — 水平标签栏、活动指示器动画（layoutId）
- [x] `ContextMenu.tsx` — 右键菜单、缩放动画、Esc 关闭
- [x] `BottomSheet.tsx` — 移动端底部弹出、滑入动画、拖动指示条
- [x] `ExpandableText.tsx` — >300 字符自动折叠、展开/收起动画
- [x] `EmptyState.tsx` — 空列表插图 + 消息 + 操作按钮
- [x] `Spinner.tsx` — 旋转加载指示器（framer-motion）
- [x] `Toast.tsx` — 通知提示容器、弹簧动画入场、自动消失

### 入口文件 (3 文件)
- [x] `src/App.tsx` — 路由配置、认证守卫、PWA 安装提示、会话恢复
- [x] `src/main.tsx` — React 18 createRoot 入口
- [x] `src/vite-env.d.ts` — Vite 类型声明

## 关键决策

1. **npm 管理 frontend**：根据设计文档要求，frontend 使用 npm（非 pnpm），pnpm workspace 排除 frontend 包。根目录 `npm install` 成功，Vite 构建成功。

2. **TypeScript 路径别名**：添加 `@shared/*` 别名指向 `../shared/src/*`，避免深层相对路径导入。共享类型（API 类型）直接引用，保证前后端契约一致。

3. **SVG PWA 图标**：使用 SVG 格式 PWA 图标（兼容现代浏览器），避免需要 PNG 转换步骤。vite-plugin-pwa 生成 service worker 成功。

4. **E2EE 密钥管理**：使用 Crockford Base32 编码（排除易混淆字符 I/L/O/U），4 字符分组。完整 32 字节密钥存储于 localStorage，分享字符串包含前 16 字符。

5. **WebSocket 票据模式**：遵循 architecture.md 设计——先请求短期票据，再用票据连接 WS，避免在 URL 中传递 session token。

6. **动画统一使用 framer-motion**：所有动画使用 framer-motion spring 物理引擎，无 CSS transition。符合 Telegram 风格设计规范。

## 遇到的问题

### 1. TypeScript Uint8Array BufferSource 类型不匹配
**问题**：`crypto.subtle` API 期望 `BufferSource`，但严格模式下 `Uint8Array` 的 buffer 类型为 `ArrayBufferLike`。
**解决**：在传递前显式转换 `key.buffer as ArrayBuffer`，`iv.buffer as ArrayBuffer`。

### 2. 共享类型包名称不匹配
**问题**：api.ts 导入 `ApiKeyRequest`/`ApiKeyResponse`，但共享类型定义为 `CreateApiKeyRequest`/`CreateApiKeyResponse`。
**解决**：更正导入名称以匹配共享类型定义。

### 3. WebSocket 消息类型安全
**问题**：WS 消息的 `data` 字段类型为 `unknown`，直接访问属性导致 TS 错误。
**解决**：添加运行时类型守卫，将 `data` 转换为 `Record<string, unknown>` 后安全访问。

### 4. 粘贴事件全局监听架构
**问题**：上传区域的粘贴监听需要全局注册。
**解决**：当前使用组件级 ref；标记为 [Debt] 待优化为更健壮的事件委托方案。

## 下游依赖

- **@tester**：前端应用可通过 `npm run dev`（端口 5173）启动。API 代理到 localhost:8787（后端 wrangler dev）。无后端运行时，UI 将渲染但 API 调用失败。建议测试时先启动 `pnpm dev`（后端），再启动 `npm run dev`（前端）。
- **@reviewer**：关注以下关键区域：
  - `src/lib/crypto.ts` E2EE 实现安全性
  - `src/lib/api.ts` 令牌处理
  - `src/lib/store.ts` 状态管理架构
  - 所有组件的无障碍属性（aria-label、semantic HTML）
  - 动画性能（framer-motion 使用是否正确）

## 验证结果

| 检查项 | 状态 |
|--------|------|
| `npm install` 成功 | ✓ 455 packages |
| `npx tsc --noEmit` 零错误 | ✓ |
| `npx vite build` 成功 | ✓ 1.63s, PWA SW 生成 |
| `pnpm install` (root) 成功 | ✓ |
| `.gitignore` 包含 frontend/dist | ✓ |
| 所有字符串使用 t() | ✓ |
| Claude 设计令牌应用 | ✓ |
| Telegram 风格动画 | ✓ |
| QR 码生成 | ✓ |
| E2EE 密钥生成/编码 | ✓ |
| PWA manifest + SW | ✓ |

## 未完成项（MVP 豁免）

- [Debt: Accessibility] 键盘导航在复杂组件（FileItem、TransferPage）中尚未完全实现
- [Debt: i18n] 英文翻译暂为简要版本，需要 native speaker 校对
- [Debt: PWA] PWA 图标为 SVG 格式，iOS Safari < 17 不支持 SVG PWA 图标；需要生成 PNG 版本
- [Debt: Performance] 消息列表未实现虚拟滚动（react-virtuoso），大量消息时可能性能受限
- [Debt: Accessibility] 上传区域粘贴监听为全局注册，需要优化为更精确的事件委托
