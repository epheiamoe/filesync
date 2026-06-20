---
step: 1
agent: architect
task: epheia-files critical bug fixes + 9 new features (Features A-I)
upstream:
  - packages/frontend/src/pages/RoomPage.tsx
  - packages/frontend/src/components/chat/ChatPage.tsx
  - packages/frontend/src/components/chat/MessageBubble.tsx
  - packages/frontend/src/components/transfer/TransferPage.tsx
  - packages/frontend/src/components/transfer/FileList.tsx
  - packages/frontend/src/lib/store.ts
  - packages/shared/src/types.ts
  - packages/frontend/src/i18n/index.ts
  - packages/backend/src/index.ts
  - packages/backend/src/files/download.ts
  - packages/backend/src/files/upload.ts
  - packages/backend/src/admin/rooms.ts
produced_at: 2026-06-21T00:00:00+08:00
status: completed
---

## 执行摘要

修复 2 个关键 bug（Tab 切换消息丢失、静默错误），并实现 9 项新功能：Copy/Recall 按钮、行内图片/文本文件预览、公开文件分享、自动销毁时间设置、Telegram 风格销毁动画、房间删除 UI、批量删除全部房间。后端新增 3 个 API 端点，前端新增 ~8 个组件。

---

## 架构设计

### 整体结构

```
RoomPage (Bug 1 fix: visibility toggle)
├── TabBar
├── ChatPage (ALWAYS mounted, CSS visibility)
│   ├── OnlineMembers
│   ├── [Timeline items]
│   │   ├── MessageBubble → [Copy, Recall] context menu
│   │   │   └── DestroyAnimation wrapper
│   │   └── ChatFileCard → [inline image/lightbox | inline text modal]
│   │       └── DestroyAnimation wrapper
│   └── <div ref={bottomRef} />
├── TransferPage (ALWAYS mounted, CSS visibility)
│   ├── UploadZone → [Public checkbox, Auto-destroy selector]
│   ├── TabBar (Texts | Files)
│   ├── TextListItem → [Copy, Recall]
│   └── FileList
│       └── FileItem → [View, Download, Recall]
├── ChatInput (shared bottom bar)
│   ├── File button
│   └── UploadProgress
└── ErrorBoundary (NEW: catches render errors)

RoomListPage (Feature H: room deletion)
├── Room cards
│   └── [Delete button] → confirmation → api.destroyRoom() → exit animation

Backend (Hono Worker)
├── GET  /api/files/:id/raw       (NEW: raw bytes, no attachment header)
├── GET  /api/files/:id/public    (NEW: public file download, no auth)
├── DELETE /api/admin/rooms       (NEW: delete all rooms)
├── [MODIFIED] /api/files/upload/init    (accepts encrypted flag in customMetadata)
├── [MODIFIED] /api/files/:id/download   (skip decrypt headers for public unencrypted)
└── [EXISTING] all other routes
```

### 模块划分

| 模块 | 职责 | 输入 | 输出 | 依赖 |
|------|------|------|------|------|
| `RoomPage.tsx` (modified) | Tab visibility toggle, error boundary | URL param `code` | ChatPage + TransferPage both rendered | Bug 1 fix |
| `ErrorBoundary.tsx` (NEW) | Catch render errors, show toast + retry | React children | Error UI or children | Bug 2 fix |
| `DestroyAnimation.tsx` (NEW) | Framer-motion scale→0 + opacity→0 wrapper | isDestroying, children, onDestroyed | Animated component | Feature G |
| `MessageBubble.tsx` (modified) | Add Copy button, DestroyAnimation wrapper | message, decryptedContent | Bubble + context menu | Feature A, G |
| `ChatFileCard.tsx` (NEW, extracted) | Inline image, text modal, lightbox | file, roomCode, isSelf | File card bubble | Feature B, C, G |
| `Lightbox.tsx` (NEW) | Full-screen image overlay | imageUrl, filename, isPublic | Modal overlay | Feature B |
| `TextViewModal.tsx` (NEW) | Modal showing file text content | fileId, filename, isPublic | Modal dialog | Feature C |
| `UploadZone.tsx` (modified) | Add "Public" checkbox, auto-destroy selector | roomId, roomCode | Upload UI | Feature D, F |
| `FileItem.tsx` (modified) | Add View/Download/Recall buttons | file, roomCode | File row | Feature E |
| `TransferPage.tsx` (modified) | Wire Copy/Recall for TextListItem | files, messages, decryptedMessages | Transfer UI | Feature A |
| `RoomListPage.tsx` (modified) | Add Delete button per room card | rooms, session | Room cards + delete UI | Feature H |
| `store.ts` (modified) | Add `destroyingItems` set for animation tracking | — | Zustand state | Feature G |
| `api.ts` (modified) | 3 new API methods + modify upload params | — | API client | Feature D, F |
| `types.ts` (shared, modified) | Add new request/response types | — | Type definitions | Feature D, F, I |
| `download.ts` (backend, modified) | Add raw + public endpoints | fileId | R2 stream | Feature B, D |
| `upload.ts` (backend, modified) | Custom metadata for encrypted flag | multipart params | upload_id | Feature D |
| `rooms.ts` (backend, modified) | Add bulk delete all rooms endpoint | — | { deleted_count } | Feature I |
| `index.ts` (backend, modified) | Register new routes, auth middleware skip for public | — | Hono app | Feature D |
| `i18n/index.ts` (modified) | ~30 new translation keys | — | Translations | All features |

---

## 验收标准

### Bug 1: Tab switching (CRITICAL)

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | 在 Chat 标签发送 3 条消息后切换到 Transfer 再切回 Chat | 3 条消息 | 所有 3 条消息仍显示，解密内容不丢失 | P0 |
| 2 | 在 Transfer 标签上传文件后切换回 Chat | 1 个文件 | 文件来源 timeline 中可见 | P0 |
| 3 | 快速连续切换标签 10 次 | 快速点击 | 消息和文件列表完全一致，无闪烁或丢失 | P0 |
| 4 | ChatPage 和 TransferPage 在 DOM 中同时存在 | 打开 RoomPage | 两个组件均渲染，仅 CSS visibility 不同 | P0 |

### Bug 2: Silent failures

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | API 返回 500 时 | 模拟 API 故障 | 显示 toast "出错了，请重试"，有"重试"按钮 | P0 |
| 2 | 消息解密失败时 | 无效密文 | 显示 "[解密失败]" 而非空泡泡 | P1 |
| 3 | 组件抛出未捕获异常时 | ErrorBoundary 捕获 | 显示内联错误提示 + "刷新"按钮，不影响其他 UI | P1 |

### Feature A: Copy and Recall buttons

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | 右键点击自己发送的消息 | 右键 | 上下文菜单显示"复制"和"撤回"两个选项 | P0 |
| 2 | 长按自己发送的消息（移动端） | 长按 500ms | BottomSheet 显示"复制"和"撤回" | P0 |
| 3 | 点击"复制" | 点击 | 明文内容写入 clipboard，toast "已复制" | P0 |
| 4 | 右键点击他人发送的消息 | 右键 | 上下文菜单显示"复制"（无"撤回"） | P0 |
| 5 | Transfer 中 text 项的 Copy 和 Recall | 点击 | 同上行为 | P0 |
| 6 | Transfer 中 file 项的 Recall | 点击 | 调用 api.recallFile，从 store 移除 | P0 |
| 7 | Chat view 中 file card 的 Recall | 右键/点击 | 调用 api.recallFile，启动销毁动画 | P0 |

### Feature B: Inline image display

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | MIME type 为 image/png 的文件在 chat 中出现 | file mime=image/png | 显示 `<img>` 标签，圆角，max-width 约束 | P0 |
| 2 | MIME type 为 image/jpeg 的文件 | file mime=image/jpeg | 同上，行内显示图片 | P0 |
| 3 | 点击行内图片 | 点击 | 打开 Lightbox 全屏查看，可关闭 | P0 |
| 4 | 右键/long-press 行内图片 | 右键 | 上下文菜单显示"下载"和"撤回"（非"打开"） | P1 |
| 5 | API `/api/files/:id/raw` 返回图片原始字节 | fileId | Content-Type: image/*，Content-Disposition: inline，X-File-Encrypted: true | P0 |

### Feature C: Inline text file viewer

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | MIME type 为 text/plain 的文件在 chat 中出现 | file mime=text/plain | 显示 card 含文件名 + "打开"按钮 | P0 |
| 2 | 点击"打开" | 点击 | 打开 Modal，显示解密后的文件内容 | P0 |
| 3 | Modal 中有"复制"按钮 | 点击 | 复制全部内容到 clipboard，toast "已复制" | P0 |
| 4 | 公开文件在 modal 中显示"复制链接"按钮 | file visibility=public | 点击复制公开 URL | P1 |
| 5 | 所有 text/* 子类型 (md, py, js, etc.) 均支持 | 各种 text/* | 全部显示"打开"按钮 | P1 |

### Feature D: Public file sharing

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | UploadZone 显示"公开"复选框 | 渲染 | 复选框可见，默认未选中 | P0 |
| 2 | 勾选"公开"后上传文件 | 文件 + 公开勾选 | API 传 visibility='public'，文件不加密上传 | P0 |
| 3 | `GET /api/files/:id/public` 无需认证返回文件 | fileId | 返回原始文件字节，content-type 正确 | P0 |
| 4 | 公开文件的 chat card / 文本 modal 显示"复制链接" | public file | 点击复制完整公开 URL | P0 |
| 5 | 私有文件的 `/api/files/:id/public` 返回 | private fileId | 404 或 403 错误 | P0 |
| 6 | 后端存储公开文件时不设置 `encrypted: 'true'` metadata | public upload | R2 customMetadata.encrypted = 'false' | P1 |
| 7 | 公开文件的 raw 响应不含 X-File-Encrypted 头 | public file download | 无 X-File-Encrypted header | P1 |

### Feature E: File view in Transfer page

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | FileItem 展开后显示"查看"按钮（图片/文本/PDF） | expand file item | "查看"按钮可见 | P0 |
| 2 | 点击"查看"图片文件 | 点击 | 新标签页打开 `/api/files/:id/raw` | P0 |
| 3 | 点击"下载"按钮 | 点击 | 触发浏览器下载 | P0 |
| 4 | 点击"撤回"按钮 | 点击 | 调用 API，移除文件，toast "已撤回" | P0 |
| 5 | 已撤回文件不显示操作按钮 | recalled file | 仅显示状态，无按钮 | P1 |

### Feature F: Auto-destroy time setting

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | UploadZone 显示时间选择器 | 渲染 | 下拉菜单显示：10分钟(默认)/30分钟/1小时/6小时/24小时 | P0 |
| 2 | 选择"1小时"后上传文件 | 1h + 文件 | API init 请求的 expires_at 为 now+1h | P0 |
| 3 | RoomPage shared upload 路径同样支持 | 拖拽上传 | 使用当前选中的销毁时间 | P1 |
| 4 | 默认值为 10 分钟 | 无选择 | expires_at = now + 10min | P0 |

### Feature G: Destruction animation

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | 撤回消息时 | 点击撤回 | 消息缩小+淡出动画（~400ms），然后从列表移除 | P0 |
| 2 | 撤回文件时 | 点击撤回 | 文件 card 缩小+淡出动画，然后移除 | P0 |
| 3 | 动画使用 spring 物理效果 | 动画播放 | scale: 0, opacity: 0, spring stiffness: 300, damping: 25 | P1 |
| 4 | 过期文件自动销毁 | expires_at 到达 | 同样动画效果后移除 | P2 |
| 5 | 动画完成后才从 store 移除 | onAnimationComplete | removeMessage/removeFile 在回调中调用 | P0 |

### Feature H: Room deletion from UI

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | Admin 用户看到每个房间 card 上的"删除"按钮 | admin session | "删除"按钮可见 | P0 |
| 2 | 非 admin 但为房间创建者的用户看到"删除"按钮 | room creator | "删除"按钮可见 | P0 |
| 3 | 点击"删除"→确认对话框 | 点击 | 显示"确定要销毁此房间吗？此操作不可撤销" | P0 |
| 4 | 确认删除 | 确认 | 调用 `DELETE /api/admin/rooms/:code`，card 退出动画，从列表移除 | P0 |
| 5 | room card 删除动画使用 framer-motion exit | 删除后 | card 缩小+淡出 | P1 |

### Feature I: Delete all rooms

| # | 行为描述 | 输入 | 期望输出 | 优先级 |
|---|---------|------|---------|--------|
| 1 | Admin 面板显示"删除所有房间"按钮 | admin panel | 按钮可见 | P0 |
| 2 | 点击按钮→双次确认 | 点击 | "确定删除所有房间？输入 DELETE 确认" | P0 |
| 3 | 输入 "DELETE" 并确认 | DELETE + 确认 | 调用 `DELETE /api/admin/rooms`，所有 room cards 动画退出 | P0 |
| 4 | 输入其他文字 | 输错 | 按钮保持 disabled | P1 |
| 5 | API 返回 { deleted_count, deleted_files, deleted_messages } | 调用成功 | toast 显示统计信息 | P1 |

### 非目标（明确不做的）

- [ ] 不支持视频/音频行内播放（仅图片和文本）
- [ ] 不实现公开文件的密码保护
- [ ] 不实现文件预览时的语法高亮（MVP 阶段纯文本显示）
- [ ] 不实现 room 删除的"撤销"功能（软删除不可逆）
- [ ] 不修改文件上传的分块逻辑（保持现有 5MB/10MB chunk）

---

## 关键边界与风险点

| 边界/风险 | 为什么重要 | 建议如何测试 |
|----------|-----------|------------|
| ChatPage+TransferPage 同时挂载导致渲染数量翻倍 | 可能影响低端设备性能 | 用 React DevTools profiler 检查 mount 后的渲染时间 |
| 公开文件不加密上传意味着 R2 中明文存储 | 安全风险：若 R2 被直接访问则暴露文件 | 确认 R2 bucket 不公开，仅通过 Worker proxy 访问 |
| `setCurrentRoom` 清空 messages/files 数组 | 此行为是 Bug 1 的根源之一 | 单元测试：验证 setCurrentRoom 是否被意外调用 |
| 销毁动画期间的竞态：用户快速连续撤回 | 可能导致动画叠加或 DOM 错误 | 快速点击撤回多次，检查 store 最终状态 |
| `/api/admin/rooms` DELETE 批量删除的原子性 | 部分失败时状态不一致 | 手动中断 API 调用（超时），检查数据库状态 |
| 公开文件 public endpoint 的缓存策略 | CDN 可能缓存已过期文件 | 设置 Cache-Control: no-cache 或短 TTL |

---

## 任务分解清单

| 序号 | 环节 | 子代理 | 任务描述 | 依赖 | 可并行 |
|-----|------|--------|---------|------|--------|
| 1 | 后端实现 | @implementer | 新增 3 个 API 端点 (raw, public, bulk-delete)，修改 upload init metadata，修改 auth middleware 跳过 public route，更新 shared types，扩展 D1 schema 新增 encrypted flag 列 | 无 | 是 |
| 2 | 前端核心修复 | @implementer | Bug 1 fix (visibility toggle)，Bug 2 fix (ErrorBoundary + toast)，Feature G (DestroyAnimation wrapper)，修改 store.ts (destroyingItems)，修改 MessageBubble (Copy + Recall + 动画)，提取 ChatFileCard 为独立组件 (Feature B + C 基础结构) | 无 | 是 |
| 3 | 前端功能实现 | @implementer | Feature B (inline image + Lightbox)，Feature C (text viewer modal)，Feature D (public checkbox + copy link)，Feature E (Transfer FileItem buttons)，Feature F (auto-destroy selector)，Feature H (RoomListPage delete)，Feature I (admin delete all rooms)，i18n 新增 ~30 个 key | #2 (依赖 ErrorBoundary, DestroyAnimation, ChatFileCard 提取) | 否 |
| 4 | 审查 | @reviewer | 审查所有修改，验证验收标准 | #1, #2, #3 | 否 |
| 5 | 测试 | @tester | 端到端测试所有验收标准中的功能路径和边界路径 | #1, #2, #3 | 否 |

## 并行组
- **组 1**：#1（后端） 和 #2（前端核心修复）可以并行执行
- **组 2**：#3（前端功能）依赖 #2 完成
- **组 3**：#4（审查）和 #5（测试）依赖 #1, #2, #3

## 关键路径
```
#2 (前端核心, 3h) → #3 (前端功能, 4h) → #4 (审查, 1h) → #5 (测试, 1h)
#1 (后端, 2h) → #4 → #5   [并行路径]
```
**关键路径总时长**：约 9h（#2→#3→#4→#5）

---

## 技术选型

| 方案 | 优点 | 缺点 | 推荐度 |
|-----|------|------|--------|
| **Tab switching fix: CSS visibility toggle** | 零状态丢失、实现简单、无动画库依赖 | 两个组件同时挂载增加内存占用 | ★★★★★ (选用) |
| Tab switching fix: keep AnimatePresence but use key=roomId | 保留动画 | 仍需管理状态同步，Bug 仍可能复发 | ★★☆ |
| **公开文件存储: 同 R2 bucket + metadata flag** | 无需新增 bucket、实现简单 | 同 bucket 中混合加密/明文数据 | ★★★★ (选用) |
| 公开文件存储: 独立 R2 bucket (epheia-files-public) | 隔离更安全 | 需额外 Cloudflare 配置、增加部署复杂度 | ★★★ |
| **内联图片: <img> + /api/files/:id/raw** | 利用已有加密文件流，复用 Worker proxy | 需要解密后渲染（客户端需先下载、解密、再显示为 blob URL） | ★★★★ (选用) |
| 内联图片: 直接渲染 R2 公开 URL | 速度最快 | 仅适用于公开文件，且暴露 R2 | ★★☆ |
| **销毁动画: framer-motion spring** | 与现有动画系统一致，无需额外依赖 | 依赖 framer-motion 已引入 | ★★★★★ (选用) |
| 销毁动画: CSS transition | 零依赖 | 不如 framer-motion 精确控制回调 | ★★★ |

---

## 风险识别

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| 公开文件未加密存储 → 数据泄露 | 高 | 明确在 UI 中标注"公开文件不对内容加密"，R2 bucket 禁止直接公开访问 |
| ChatPage+TransferPage 同时挂载导致双倍 WebSocket 连接 | 中 | WebSocket 由 RoomPage 管理（已复用），子组件不自行创建连接 |
| D1 schema 新增 encrypted_flag 列迁移失败 | 高 | 使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，默认值 'true' 向后兼容 |
| 销毁动画与 React 18 StrictMode 双重渲染冲突 | 低 | onAnimationComplete 回调使用 ref 确保只触发一次 |
| Room 批量删除中部分 R2 对象已被清理 | 低 | handleDestroyRoom 已实现 R2 delete 的 try/catch best-effort 模式 |

---

## 文件传递规划

| 环节 | 输入文件 | 输出文件 |
|-----|---------|---------|
| #1 后端 | `.swarm/2026-06-21_epheia-files/architecture-v2.md`, `packages/backend/src/index.ts`, `packages/backend/src/files/download.ts`, `packages/backend/src/files/upload.ts`, `packages/backend/src/admin/rooms.ts`, `packages/shared/src/types.ts` | `packages/backend/src/index.ts` (modified), `packages/backend/src/files/download.ts` (modified), `packages/backend/src/files/upload.ts` (modified), `packages/backend/src/admin/rooms.ts` (modified), `packages/shared/src/types.ts` (modified) |
| #2 前端核心 | `architecture-v2.md`, `packages/frontend/src/pages/RoomPage.tsx`, `packages/frontend/src/components/chat/ChatPage.tsx`, `packages/frontend/src/components/chat/MessageBubble.tsx`, `packages/frontend/src/lib/store.ts` | `RoomPage.tsx` (modified), `ChatPage.tsx` (modified), `MessageBubble.tsx` (modified), `store.ts` (modified), `DestroyAnimation.tsx` (NEW), `ErrorBoundary.tsx` (NEW), `ChatFileCard.tsx` (NEW extracted) |
| #3 前端功能 | `architecture-v2.md`, 所有 #2 的输出, `packages/frontend/src/components/transfer/FileList.tsx`, `packages/frontend/src/components/transfer/TransferPage.tsx`, `packages/frontend/src/components/transfer/FileItem.tsx`, `packages/frontend/src/components/transfer/UploadZone.tsx`, `packages/frontend/src/pages/RoomListPage.tsx`, `packages/frontend/src/i18n/index.ts`, `packages/frontend/src/lib/api.ts` | `Lightbox.tsx` (NEW), `TextViewModal.tsx` (NEW), `FileItem.tsx` (modified), `TransferPage.tsx` (modified), `UploadZone.tsx` (modified), `RoomListPage.tsx` (modified), `api.ts` (modified), `i18n/index.ts` (modified) |

---

## 数据流设计

### 公开文件上传流

```
User: 勾选"公开"复选框 + 选择文件
    ↓
UploadZone: visibility='public', encrypted_flag=false
    ↓
api.initUpload(filename, size, chunkSize, roomId, 'public', expiresAt)
    ↓  (client-side: 不加密文件内容，但加密文件名)
Worker: POST /api/files/upload/init
    ↓  R2 customMetadata.encrypted = 'false'
    ↓
api.uploadPart(...) → R2 multipart (明文存储)
    ↓
api.completeUpload(..., visibility='public')
    ↓  D1: INSERT file_metadata (visibility='public', r2_key=...)
    ↓  Broadcast file_shared via RoomDO
    ↓
Chat UI: ChatFileCard 检测 visibility='public' → 显示"复制链接"按钮
    ↓
User: 点击"复制链接" → clipboard: https://epheia-files-api.epheia.workers.dev/api/files/{id}/public
```

### 公开文件下载流

```
External User: 打开 https://epheia-files-api.epheia.workers.dev/api/files/{id}/public
    ↓
Worker: GET /api/files/:id/public
    ↓  (auth middleware SKIP for this route)
    ↓  SELECT visibility FROM file_metadata WHERE id = ?
    ↓  if visibility != 'public' → 404
    ↓  if recalled OR expired → 410
    ↓  R2: get(r2_key)
    ↓  Response: Content-Type = mime_type, Content-Disposition = inline,
    ↓            NO X-File-Encrypted header (文件为明文)
    ↓
Browser: 直接显示 (图片/文本) 或下载 (其他类型)
```

### 内联图片渲染流

```
ChatPage timeline: file item with mime_type = 'image/png'
    ↓
ChatFileCard: 检测 mime_type.startsWith('image/')
    ↓
Step 1: 调用 api.downloadFile(fileId) → 获取加密 blob
    ↓
Step 2: 客户端解密 (decryptFile or similar)
    ↓
Step 3: 创建 blob URL: URL.createObjectURL(decryptedBlob)
    ↓
Step 4: 渲染 <img src={blobUrl} />
    ↓  (useEffect 清理: URL.revokeObjectURL)
    ↓
User: 点击图片 → Lightbox 打开（全屏，含关闭和下载按钮）
    ↓
User: 右键图片 → ContextMenu: ["下载", "撤回"]
```

### 销毁动画流

```
User: 点击"撤回"
    ↓
handleRecall(): api.recallMessage(id) / api.recallFile(id)
    ↓ (API 返回成功)
store.setDestroyingItems() → 添加 item id
    ↓
MessageBubble / ChatFileCard: 检测 isDestroying={store.destroyingItems.has(id)}
    ↓
DestroyAnimation: framer-motion animate={{ scale: 0, opacity: 0 }}
    ↓  transition: spring(stiffness: 300, damping: 25), duration ~400ms
    ↓
onAnimationComplete()
    ↓
store.removeMessage(id) / store.removeFile(id)  ← 从列表移除
store.clearDestroying(id)  ← 清理动画状态
```

---

## API 变更详情

### 新增端点

#### 1. `GET /api/files/:id/raw`
- **用途**：返回原始文件字节（用于内联图片渲染），不设 Content-Disposition: attachment
- **认证**：需要（私有文件验证 room membership，公开文件需验证）
- **响应**：
  - 200: 文件字节流，Content-Type 为实际 MIME，Content-Disposition: inline
  - 404: 文件不存在
  - 410: 文件已撤回/过期
  - 403: 无权限（私有文件非 member）

#### 2. `GET /api/files/:id/public`
- **用途**：公开文件的无认证下载
- **认证**：**不需要**（需在 auth middleware 中添加例外路径）
- **响应**：
  - 200: 文件字节流（明文，无 X-File-Encrypted header）
  - 404: 文件不存在或非公开
  - 410: 已撤回/过期

#### 3. `DELETE /api/admin/rooms`
- **用途**：批量删除所有未删除的房间
- **认证**：需要 admin scope
- **请求体**：无
- **响应**：`{ success: true, data: { deleted_rooms: number, deleted_files: number, deleted_messages: number } }`

### 修改的端点

#### `POST /api/files/upload/init`
- **变更**：在 R2 createMultipartUpload 时，根据 visibility 设置 `customMetadata.encrypted`:
  - `visibility === 'public'` → `encrypted: 'false'`
  - `visibility === 'private'` → `encrypted: 'true'`（默认/现有行为）

#### `GET /api/files/:id/download`
- **变更**：
  - 对于公开文件：Content-Disposition: inline，不添加 X-File-Encrypted header
  - 对于私有文件：行为不变

#### Auth Middleware (`index.ts`)
- **变更**：添加公开文件路由的豁免：
  - `c.req.path.startsWith('/api/files/') && c.req.path.endsWith('/public')` → 跳过认证

---

## i18n 新增 Key 清单

```typescript
// 复制
'common.copy':       { 'zh-CN': '复制', 'en-US': 'Copy' }        // 已存在

// Feature A: Copy / Recall
'chat.copy':         { 'zh-CN': '复制文本', 'en-US': 'Copy Text' }
'chat.copyLink':     { 'zh-CN': '复制链接', 'en-US': 'Copy Link' }

// Feature B: Image
'chat.openImage':    { 'zh-CN': '查看图片', 'en-US': 'Open Image' }
'chat.closeImage':   { 'zh-CN': '关闭', 'en-US': 'Close' }
'chat.downloadImage':{ 'zh-CN': '下载图片', 'en-US': 'Download Image' }

// Feature C: Text file
'chat.openFile':     { 'zh-CN': '打开', 'en-US': 'Open' }
'chat.viewFile':     { 'zh-CN': '查看文件内容', 'en-US': 'View File Content' }
'chat.copyContent':  { 'zh-CN': '复制全部内容', 'en-US': 'Copy All Content' }
'chat.fileUnavailable':{ 'zh-CN': '文件不可用', 'en-US': 'File unavailable' }

// Feature D: Public file sharing
'transfer.public':       { 'zh-CN': '公开（不加密内容）', 'en-US': 'Public (unencrypted)' }
'transfer.publicDesc':   { 'zh-CN': '公开文件可直接通过链接访问', 'en-US': 'Public files accessible via direct link' }
'transfer.publicUrl':    { 'zh-CN': '公开链接', 'en-US': 'Public URL' }
'transfer.copyPublicUrl':{ 'zh-CN': '复制公开链接', 'en-US': 'Copy Public URL' }

// Feature E: View in Transfer
'transfer.view':     { 'zh-CN': '查看', 'en-US': 'View' }

// Feature F: Auto-destroy
'transfer.autoDestroy':  { 'zh-CN': '自动销毁', 'en-US': 'Auto-destroy' }
'transfer.ttl10min':     { 'zh-CN': '10 分钟', 'en-US': '10 min' }
'transfer.ttl30min':     { 'zh-CN': '30 分钟', 'en-US': '30 min' }
'transfer.ttl1hour':     { 'zh-CN': '1 小时', 'en-US': '1 hour' }
'transfer.ttl6hours':    { 'zh-CN': '6 小时', 'en-US': '6 hours' }
'transfer.ttl24hours':   { 'zh-CN': '24 小时', 'en-US': '24 hours' }

// Feature H: Room deletion
'rooms.delete':          { 'zh-CN': '删除房间', 'en-US': 'Delete Room' }
'rooms.deleteConfirm':   { 'zh-CN': '确定要销毁此房间吗？所有消息和文件将被永久删除，此操作不可撤销。', 'en-US': 'Are you sure? All messages and files will be permanently deleted. This cannot be undone.' }
'rooms.deleted':         { 'zh-CN': '房间已销毁', 'en-US': 'Room destroyed' }

// Feature I: Delete all rooms
'admin.deleteAllRooms':       { 'zh-CN': '删除所有房间', 'en-US': 'Delete All Rooms' }
'admin.deleteAllRoomsConfirm':{ 'zh-CN': '此操作将删除所有非已删除的房间及其全部数据。输入 DELETE 以确认。', 'en-US': 'This will delete ALL non-deleted rooms and all data. Type DELETE to confirm.' }
'admin.deleteAllDone':        { 'zh-CN': '已删除 {count} 个房间', 'en-US': 'Deleted {count} rooms' }

// Bug 2: Error handling
'common.somethingWentWrong':  { 'zh-CN': '出了点问题', 'en-US': 'Something went wrong' }
'common.refresh':             { 'zh-CN': '刷新页面', 'en-US': 'Refresh page' }
```

---

## D1 Schema 变更

```sql
-- 新增列：标记文件是否加密存储（默认 true，向后兼容）
ALTER TABLE file_metadata ADD COLUMN encrypted_flag TEXT NOT NULL DEFAULT 'true';

-- 可选：为公开文件查询创建索引
CREATE INDEX IF NOT EXISTS idx_file_visibility ON file_metadata(visibility);
```

---

## 组件树变更详情

### RoomPage.tsx 变更

**Before** (Bug 1 root cause):
```tsx
<AnimatePresence mode="wait">
  <motion.div key={activeTab} initial={{...}} animate={{...}} exit={{...}}>
    {activeTab === 'chat' ? <ChatPage ... /> : <TransferPage ... />}
  </motion.div>
</AnimatePresence>
```

**After** (Bug 1 fix):
```tsx
{/* Both always mounted — visibility controlled by CSS */}
<div className={activeTab === 'chat' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'chat'}>
  <ErrorBoundary>
    <ChatPage ... />
  </ErrorBoundary>
</div>
<div className={activeTab === 'transfer' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'transfer'}>
  <ErrorBoundary>
    <TransferPage ... />
  </ErrorBoundary>
</div>

{/* Tab switch fade animation via CSS transition on the content wrapper */}
<style>{`
  .tab-content-enter { opacity: 0; }
  .tab-content-active { opacity: 1; transition: opacity 150ms ease; }
`}</style>
```

### ChatPage.tsx 变更

- 移除 ChatFileCard 内部定义（`function ChatFileCard`）
- 从新文件 `./ChatFileCard` import
- 在 file timeline item 渲染处直接使用 `<ChatFileCard>`

### ChatFileCard.tsx (NEW, extracted from ChatPage.tsx)

```
Props: { file: FileMetaDTO; roomCode: string; isSelf: boolean }

State:
  - decryptedName: string | null
  - imageBlobUrl: string | null      (for inline image rendering)
  - lightboxOpen: boolean             (full-screen image view)
  - textModalOpen: boolean            (text file content modal)
  - isDestroying: boolean             (from store.destroyingItems)

Rendering logic:
  if (mimeType.startsWith('image/'))
    → <DestroyAnimation>
        <img src={imageBlobUrl} onClick={openLightbox} onContextMenu={showImageMenu} />
        <Lightbox open={lightboxOpen} ... />
      </DestroyAnimation>
  else if (isTextMime(mimeType))   // .txt, .md, .py, .js, etc.
    → <DestroyAnimation>
        <File name + Open button>
        <TextViewModal open={textModalOpen} ... />
      </DestroyAnimation>
  else
    → <DestroyAnimation>
        <Original ChatFileCard content with Download button />
      </DestroyAnimation>
```

### DestroyAnimation.tsx (NEW)

```tsx
interface DestroyAnimationProps {
  isDestroying: boolean;
  children: React.ReactNode;
  onDestroyed?: () => void;
}

export function DestroyAnimation({ isDestroying, children, onDestroyed }: DestroyAnimationProps) {
  return (
    <motion.div
      animate={isDestroying
        ? { scale: 0, opacity: 0, transition: { type: 'spring', stiffness: 300, damping: 25, duration: 0.4 } }
        : { scale: 1, opacity: 1 }
      }
      onAnimationComplete={() => {
        if (isDestroying) onDestroyed?.();
      }}
    >
      {children}
    </motion.div>
  );
}
```

### ErrorBoundary.tsx (NEW)

```tsx
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
    // TODO: send to structured logging
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ hasError: false, error: null })} />;
    }
    return this.props.children;
  }
}
```

### RoomListPage.tsx 变更

- 每个 room card 增加条件渲染的"删除"按钮：
  ```tsx
  {(isAdmin || isCreator) && (
    <Button variant="danger" size="sm" onClick={handleDeleteRoom}>删除</Button>
  )}
  ```
- 确认对话框使用原生 `window.confirm()` 或自定义 ConfirmDialog 组件
- 删除完成后：`setRooms(prev => prev.filter(r => r.id !== roomId))` + framer-motion exit 动画
- Admin 面板区（若存在）增加"删除所有房间"按钮

### UploadZone.tsx 变更

- 在拖拽区域上方添加两个控件：
  ```tsx
  <div className="flex items-center gap-4 mb-3">
    {/* Public toggle */}
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={isPublic} onChange={...} />
      {t('transfer.public')}
    </label>
    {/* Auto-destroy selector */}
    <select value={ttlMinutes} onChange={...} className="text-sm border rounded">
      <option value={10}>10 min</option>
      <option value={30}>30 min</option>
      <option value={60}>1 hour</option>
      <option value={360}>6 hours</option>
      <option value={1440}>24 hours</option>
    </select>
  </div>
  ```
- 上传时：计算 `expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()`
- 传递 `visibility: isPublic ? 'public' : 'private'`

### FileItem.tsx (Transfer) 变更

展开区域增加三个按钮（根据文件类型和状态条件显示）：

```tsx
{/* 查看按钮 — 仅对图片/文本/PDF */}
{['image/', 'text/', 'application/pdf'].some(t => file.mime_type.startsWith(t)) && (
  <Button variant="secondary" size="sm" onClick={handleView}>查看</Button>
)}
{/* 下载按钮 — 对所有文件 */}
<Button variant="primary" size="sm" loading={downloading} onClick={handleDownload}>下载</Button>
{/* 撤回按钮 — 仅对自己上传的文件 */}
{!isRecalled && isOwnFile && (
  <Button variant="danger" size="sm" onClick={handleRecall}>撤回</Button>
)}
```

"查看"逻辑：
```ts
const handleView = () => {
  const url = `${BASE_URL}/files/${file.id}/raw`;
  window.open(url, '_blank');
};
```

### TransferPage.tsx TextListItem 变更

```tsx
{/* 在 TextListItem 底部增加操作按钮 */}
<div className="flex gap-2 mt-2">
  <Button variant="ghost" size="sm" onClick={handleCopy}>复制</Button>
  {isOwnMessage && <Button variant="ghost" size="sm" danger onClick={handleRecall}>撤回</Button>}
</div>
```

---

## 实现注意事项

### 关于公开文件"不加密"的实现

当前的 `handleFileUpload` 和 `UploadZone.handleFiles` 在客户端对文件内容进行加密 (`encryptFile`)。对于公开文件，我们需要：
- **跳过后端加密**：客户端不上传 `encryptFile()` 的结果，而是直接上传原始 `fileBuffer`
- **仍加密文件名**：出于隐私考虑，文件名始终加密（即使是公开文件，文件名也不应暴露给非 room member）
- **后端 metadata**：`visibility='public'` 时，R2 customMetadata.encrypted = 'false'，D1 新增的 `encrypted_flag` = 'false'

⚠️ **技术决策**：公开文件是否加密文件名？→ **是**。文件名包含创建者的目录结构信息，属于隐私数据。文件内容公开，但文件名仅 room members 可解密。

### 关于 `/api/files/:id/public` 的认证豁免

后端 auth middleware 当前对 `/api/*` 全局应用认证（除了 login 和 ws/connect）。需要修改 `index.ts` 的 middleware：

```ts
// Skip auth for public file access
if (c.req.path.match(/^\/api\/files\/[^/]+\/public$/)) {
  return next();
}
```

### 关于 `uploader_session_id` 与 `isCreator` 的判断

当前 room cards 不存储 `creator_session_id`。需要：
- **方案 A**：在 D1 `rooms` 表增加 `creator_session_id` 列 — 更准确但需要 migration
- **方案 B**：在 `room_members` 表中查找第一个 member 视为 creator — 不准确
- **方案 C** (推荐)：检查当前 session 是否为 admin，若是则显示删除按钮；非 admin 用户不显示删除按钮。MVP 阶段仅 admin 可删除。

选择 **方案 C** for MVP，避免 schema migration。未来可增加 creator 追踪。

### 关于 `isOwnMessage` / `isOwnFile` 的判断

当前：`message.sender_session_id === sessionToken` 或 `file.uploader_session_id === sessionToken`。

在 MessageBubble 和 FileItem 中这些判断已经可用。需确保组件的 props 包含 sessionToken（MessageBubble 从 store 获取 session，ChatFileCard 从 props 获取）。

---

## 变更文件清单（摘要）

| 文件路径 | 变更类型 | 说明 |
|--------|---------|------|
| `packages/backend/src/index.ts` | MODIFIED | 注册 3 个新路由，auth middleware 豁免 public endpoint |
| `packages/backend/src/files/download.ts` | MODIFIED | 新增 handleFileRaw, handleFilePublic 两个导出函数 |
| `packages/backend/src/files/upload.ts` | MODIFIED | upload init 时设置 R2 customMetadata.encrypted |
| `packages/backend/src/admin/rooms.ts` | MODIFIED | 新增 handleDestroyAllRooms 导出函数 |
| `packages/shared/src/types.ts` | MODIFIED | 新增 DestroyAllRoomsResponse, 修改 UploadInitRequest |
| `packages/frontend/src/lib/api.ts` | MODIFIED | 新增 getFileRaw, getFilePublic, destroyAllRooms，修改 initUpload 参数 |
| `packages/frontend/src/lib/store.ts` | MODIFIED | 新增 destroyingItems set + actions |
| `packages/frontend/src/pages/RoomPage.tsx` | MODIFIED | AnimatePresence→CSS visibility toggle, ErrorBoundary |
| `packages/frontend/src/pages/RoomListPage.tsx` | MODIFIED | 新增 room delete button + admin delete all |
| `packages/frontend/src/components/chat/ChatPage.tsx` | MODIFIED | 提取 ChatFileCard，import from new file |
| `packages/frontend/src/components/chat/MessageBubble.tsx` | MODIFIED | Copy button, DestroyAnimation wrapper |
| `packages/frontend/src/components/chat/ChatFileCard.tsx` | NEW | 内联图片/文本/光箱/下载/撤回 |
| `packages/frontend/src/components/chat/Lightbox.tsx` | NEW | 全屏图片查看器 |
| `packages/frontend/src/components/chat/TextViewModal.tsx` | NEW | 文本文件内容模态框 |
| `packages/frontend/src/components/chat/DestroyAnimation.tsx` | NEW | 销毁动画 wrapper |
| `packages/frontend/src/components/ui/ErrorBoundary.tsx` | NEW | React Error Boundary |
| `packages/frontend/src/components/transfer/FileItem.tsx` | MODIFIED | View/Download/Recall buttons |
| `packages/frontend/src/components/transfer/TransferPage.tsx` | MODIFIED | TextListItem Copy/Recall buttons |
| `packages/frontend/src/components/transfer/UploadZone.tsx` | MODIFIED | Public checkbox + auto-destroy selector |
| `packages/frontend/src/i18n/index.ts` | MODIFIED | ~30 new translation keys |
