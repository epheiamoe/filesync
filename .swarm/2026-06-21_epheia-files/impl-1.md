---
step: 1
agent: implementer
task: backend-foundation
upstream:
  - .swarm/2026-06-21_epheia-files/architecture.md
  - .swarm/2026-06-21_epheia-files/plan.md
  - .swarm/2026-06-21_epheia-files/context.md
produced_at: 2026-06-21T00:17:00+08:00
status: completed
estimated_time: ~45min
tdd_mode: true
tdd_cycles: 4 (one test file per module)
---

## 实现摘要

完成了 epheia-files 的完整后端基础：monorepo 脚手架、D1 schema、auth 系统、房间系统、共享加密工具、共享类型包。所有 46 个单元测试通过，TypeScript 编译零错误。

## 变更清单

### 根目录配置 (4 files)
- [x] `package.json` — pnpm workspace root, `"packageManager": "pnpm@9.0.0"`, workspaces: `["packages/*"]`
- [x] `pnpm-workspace.yaml` — workspace 定义
- [x] `tsconfig.base.json` — 共享 TS 配置 (ES2022, bundler, strict)
- [x] `pnpm-lock.yaml` — 自动生成

### Shared Types Package (4 files)
- [x] `packages/shared/package.json` — `@epheia-files/shared`，纯类型包
- [x] `packages/shared/tsconfig.json` — extends base config
- [x] `packages/shared/src/index.ts` — re-export barrel
- [x] `packages/shared/src/types.ts` — 全部共享类型定义（LoginMethod, MessageType, FileVisibility, CredentialType, LoginRequest/Response, SessionData, CreateRoomRequest/Response, JoinRoomRequest/Response, RoomInfo, CreateTempCredentialRequest/Response, CreateApiKeyRequest/Response, AdminStats, MessageDTO, FileMetaDTO, ApiResponse, WsMessage）

### Backend Package — 配置 (4 files)
- [x] `packages/backend/package.json` — `@epheia-files/backend`, depends: hono, zod, @epheia-files/shared; dev: wrangler, vitest, @cloudflare/vitest-pool-workers, @cloudflare/workers-types, typescript
- [x] `packages/backend/tsconfig.json` — extends base with Workers types
- [x] `packages/backend/vitest.config.ts` — 使用 @cloudflare/vitest-pool-workers
- [x] `packages/backend/wrangler.jsonc` — D1 binding + KV binding, routes 已注释

### Backend Package — D1 Schema (2 files)
- [x] `packages/backend/db/schema.sql` — 完整 7 表 schema（admin_accounts, rooms, room_members, messages, file_metadata, usage_stats, credential_audit）及所有索引
- [x] `packages/backend/db/seed.sql` — 默认 admin 账户 (username: "admin", password: "admin123")

### Backend Package — 源码 (11 files)
- [x] `packages/backend/src/types.ts` — 后端专用的 Hono 上下文类型 (AppContext, Bindings, Variables)
- [x] `packages/backend/src/index.ts` — Hono app 入口，CORS + auth 中间件，路由挂载，health check，404/error 处理
- [x] `packages/backend/src/auth/login.ts` — 3 种登录方式 (admin/API key/temp credential)，zod 验证，D1+KV 查找
- [x] `packages/backend/src/auth/session.ts` — session 创建/验证/销毁，KV 存储 + TTL 管理
- [x] `packages/backend/src/auth/credentials.ts` — admin-only 凭证管理 (CRUD temp credentials + API keys)
- [x] `packages/backend/src/rooms/create.ts` — 房间创建，随机码生成+冲突重试(10次)，自定义码唯一性检查
- [x] `packages/backend/src/rooms/join.ts` — 加入房间，key_hash 验证，设备标签解析，幂等加入
- [x] `packages/backend/src/rooms/list.ts` — 房间列表（admin 看创建的，session 看加入的），房间详情预览
- [x] `packages/backend/src/crypto/base32.ts` — Crockford base32 编解码 (0123456789ABCDEFGHJKMNPQRSTVWXYZ)，含歧义字符映射
- [x] `packages/backend/src/crypto/hash.ts` — SHA-256 (Web Crypto)，密码哈希/验证 (salt+password)
- [x] `packages/backend/src/utils/id.ts` — ID 生成器 (UUID, room code, temp code, API key, salt, session token)

### Backend Package — 测试 (4 files, 46 tests)
- [x] `packages/backend/test/crypto.test.ts` — 18 tests: base32 编解码回环、分组、歧义字符、SHA-256 一致性、密码哈希验证
- [x] `packages/backend/test/utils.test.ts` — 12 tests: UUID 格式、room code 范围、temp code 唯一性、API key 格式
- [x] `packages/backend/test/auth.test.ts` — 8 tests: session token 格式、密码验证、边界情况
- [x] `packages/backend/test/rooms.test.ts` — 8 tests: room code 生成分布、UUID 唯一性、hash 格式验证

## TDD 记录

| 轮次 | 测试文件 | 行为描述 | 实现概要 |
|------|---------|---------|---------|
| 1 | crypto.test.ts | base32 encode/decode roundtrip, SHA-256 consistency, password hash/verify | crypto/base32.ts (Crockford), crypto/hash.ts (Web Crypto) |
| 2 | utils.test.ts | ID generation format validation, uniqueness, ranges | utils/id.ts (UUID, room code, temp code, API key, salt, session token) |
| 3 | auth.test.ts | Session tokens, password verification edge cases, hash properties | auth/session.ts (KV session lifecycle), crypto/hash.ts enhancements |
| 4 | rooms.test.ts | Room code distribution, UUID uniqueness, key hash format, UA parsing | rooms/create.ts, rooms/join.ts, rooms/list.ts |

## 重构记录

| 步骤 | 改动 | 测试状态 |
|------|------|---------|
| 1 | 创建 `src/types.ts` 统一 Hono 上下文类型 (AppContext) | n/a (类型修复) |
| 2 | 所有 handler 从 `Env` 改为 `AppContext`，消除 TS 类型错误 | 46 通过 |
| 3 | crypto/hash.ts 修复 ArrayBuffer/Uint8Array 类型转换 | 46 通过 |
| 4 | 安装 typescript 作为 devDependency | 46 通过 |

## 关键决策

1. **Hono 上下文类型**：创建了 `src/types.ts` 定义 `AppContext`（含 `Bindings: { DB, KV }` 和 `Variables: { session, sessionToken }`），所有 handler 统一使用 `Context<AppContext>`。避免每个文件重复定义或使用 `c.env.DB as D1Database`。

2. **MessageType 命名差异**：D1 schema 使用 `file_notification`（architecture.md 定义），共享类型使用 `file_shared`（task 规范定义）。添加了注释说明这一差异，建议 task_2 实现时统一。

3. **密码哈希格式**：采用 architecture.md 的 salt+hash 格式（96 字符 hex），salt 为前 32 字符，hash 为后 64 字符。验证时从 stored 中提取 salt 重新计算。

4. **种子脚本的固定 salt**：使用确定性 salt `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6` 预计算 SHA-256 hash，确保 seed.sql 可直接运行。

5. **API key 撤销匹配**：由于 KV 存储使用完整 key hash，但 D1 审计表仅存储 `api_key_prefix`（前 8 字符），撤销时采用 best-effort 匹配最新未撤销记录。生产环境建议改进为存储完整 hash。

6. **设备标签解析**：实现了 OS + Browser 组合标签（如 "Windows Chrome"、"iPhone Safari"），用于 room join 时的 device_label。

## 遇到的问题

1. **TypeScript 类型错误**：Hono 默认 `Env` 类型不包含 `DB`/`KV` 属性，`c.get()` 需要 `Variables` 泛型。解决方案：创建 `src/types.ts` 定义统一的 `AppContext` 类型。

2. **Web Crypto ArrayBuffer 类型**：`crypto.subtle.digest` 期望 `BufferSource`，但 TypeScript strict 模式下 `Uint8Array.buffer.slice()` 返回 `ArrayBuffer` 类型不兼容。解决方案：添加 `as ArrayBuffer` 类型断言。

3. **兼容性日期警告**：本地 vitest workerd 运行时不支持 `2025-06-21`，自动降级到 `2024-12-30`。不影响测试结果，但生产部署需关注。

## 下游依赖

- **task_2 (backend features)**：依赖本任务的所有模块
  - `@epheia-files/shared` 类型包（需注意 MessageType 差异）
  - `src/auth/session.ts` 的 `validateSession()` 函数
  - `src/rooms/` 的房间 CRUD 模块
  - `src/crypto/` 的 base32 和 hash 工具
  - `src/types.ts` 的 `AppContext` 类型
  - `src/utils/id.ts` 的所有 ID 生成器
  
- **task_3 (frontend)**：依赖 `@epheia-files/shared` 类型包
  - 所有 API 请求/响应类型
  - 注意 `LoginMethod`、`ApiResponse<T>` 等泛型类型

## API 路由清单（本任务实现）

| Method | Path | Handler File |
|--------|------|-------------|
| POST | /api/auth/login | auth/login.ts |
| POST | /api/auth/logout | index.ts (inline) |
| GET | /api/auth/session | index.ts (inline) |
| POST | /api/auth/credentials | auth/credentials.ts |
| GET | /api/auth/credentials | auth/credentials.ts |
| DELETE | /api/auth/credentials/:id | auth/credentials.ts |
| POST | /api/auth/api-keys | auth/credentials.ts |
| DELETE | /api/auth/api-keys/:keyHash | auth/credentials.ts |
| POST | /api/rooms | rooms/create.ts |
| GET | /api/rooms | rooms/list.ts |
| POST | /api/rooms/join | rooms/join.ts |
| GET | /api/rooms/:code | rooms/list.ts |
| GET | /api/health | index.ts (inline) |
