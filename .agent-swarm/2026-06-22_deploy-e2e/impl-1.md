---
step: 2
agent: implementer
task: 修复 filesync 生产部署 CORS 白名单与管理员密码问题
upstream:
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_deploy-e2e\test-1.md
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_deploy-e2e\plan.md
  - E:\Epheia\dev\apps\serverless\express\AGENTS.local.md
produced_at: 2026-06-23T04:16:45+08:00
status: completed
---

# filesync 生产部署修复报告

## 1. 修复摘要

本次修复处理了 `test-1.md` 中标记的两项关键问题，并在验证过程中发现并修复了一个导致登录 500 的运行时兼容性问题。

| 原问题 | 修复方式 | 状态 |
|---|---|---|
| Critical: `CORS_ALLOWED_ORIGINS` 缺失，生产环境反射任意 Origin | 在 `packages/backend/wrangler.jsonc` 的 `vars` 中补充白名单与速率限制变量，重新部署 | ✅ 已修复并验证 |
| Major: 生产 `admin` 密码未知，无法获取 token | 使用 PBKDF2 模块生成临时密码的 hash，通过 `wrangler d1 execute` 更新 `admin_accounts`，登录验证成功 | ✅ 已修复并验证 |
| 衍生问题: Cloudflare Workers Web Crypto 不支持 600,000 次 PBKDF2 迭代 | 将默认迭代次数调整为 100,000（Workers 支持上限），同步更新测试与文档 | ✅ 已修复并验证 |

## 2. 配置变更

修改文件：`packages/backend/wrangler.jsonc`（已在 `.gitignore` 中）。

`vars` 节点新增/保留内容：

```jsonc
"vars": {
  "FEATURE_FRONTEND_AUTO_DESTROY": "true",
  "CORS_ALLOWED_ORIGINS": "https://epheia-files.pages.dev",
  "RATE_LIMIT_WINDOW_SECONDS": "300",
  "RATE_LIMIT_MAX_FAILURES": "5",
  "RATE_LIMIT_BLOCK_SECONDS": "900"
}
```

> 说明：未在报告中输出真实 hash、密码或其他 secrets。

## 3. 源码与文档变更

在验证登录时发现 Cloudflare Workers 运行时对 PBKDF2 迭代次数有 100,000 的上限（`workerd` issue #1346）。源码默认 600,000 次迭代会导致 `/api/auth/login` 在生产环境抛出 `NotSupportedError` 并返回 500。为使登录与后续密码修改可用，必须将默认迭代次数降至 100,000。

变更文件：

- `packages/backend/src/crypto/pbkdf2.ts`：默认迭代次数 `600_000` → `100_000`，更新模块注释。
- `packages/backend/src/admin/password.ts`：更新注释以反映 100,000 迭代。
- `packages/backend/test/auth.test.ts`：调整默认迭代数断言。
- `packages/backend/test/crypto/pbkdf2.test.ts`：调整默认迭代数断言。
- `docs/architecture/current-state.md`：更新 PBKDF2 迭代数说明。
- `docs/lessons/2026-06-security-remediation.md`：更新迭代数说明。

L1 验证结果：

- `pnpm test`：16 个测试文件、166 个测试全部通过。
- `pnpm lint`：TypeScript 类型检查通过。

## 4. 部署结果

执行了两次 `npx wrangler deploy`：

1. **仅配置变量修复**：Version ID `c0e1c770-f957-47a3-80a6-2e7cf88173fa`。
2. **配置变量 + PBKDF2 迭代修复后重新部署**：Version ID `69727fa1-3d04-47c1-a31e-c9f98ddd23f8`。

最终生产 Worker：`https://filesync-api.epheia.workers.dev`

部署输出确认 `vars` 已生效：

```text
- CORS_ALLOWED_ORIGINS: "https://epheia-files.pages.dev"
- RATE_LIMIT_WINDOW_SECONDS: "300"
- RATE_LIMIT_MAX_FAILURES: "5"
- RATE_LIMIT_BLOCK_SECONDS: "900"
```

## 5. CORS 验证结果

使用 curl 对生产 Worker 进行验证：

### 5.1 合法 Origin `https://epheia-files.pages.dev`

- `GET /api/health`：HTTP 200，响应头包含 `Access-Control-Allow-Origin: https://epheia-files.pages.dev`，无 `*`。
- `OPTIONS /api/auth/login`：HTTP 204，响应头包含 `Access-Control-Allow-Origin: https://epheia-files.pages.dev`、`Access-Control-Allow-Credentials: true`、允许的 Methods 与 Headers。

状态：**通过**。

### 5.2 非法 Origin `https://evil.example.com`

- `OPTIONS /api/auth/login`：HTTP 204，响应中**未返回** `Access-Control-Allow-Origin`。
- `GET /api/health`：HTTP 200，响应中**未返回** `Access-Control-Allow-Origin`。
- 全程未出现 `Access-Control-Allow-Origin: *`。

状态：**通过**（非法 Origin 不再被允许携带凭证调用）。

## 6. 密码重置与登录验证结果

### 6.1 重置前状态

通过 D1 查询确认 `admin` 账户原 hash 为 **legacy** 格式（长度 96），与 `test-1.md` 一致。

### 6.2 重置操作

1. 选择临时管理员密码（未在报告与聊天记录中披露明文）。
2. 使用本地 Node `crypto.pbkdf2Sync` 按 PBKDF2-SHA256、100,000 次迭代生成 hash（与 Worker 端 `crypto.subtle.deriveBits` 输出一致）。
3. 通过 SQL 文件方式执行 `wrangler d1 execute filesync-db --remote --file <temp.sql>`，更新 `admin_accounts.password_hash`。

> 使用 SQL 文件而非在命令行中直接嵌入 hash，避免 secrets 进入 shell 历史。

### 6.3 重置后状态

D1 查询确认 hash 格式变为 **pbkdf2**（长度 121）。

### 6.4 登录验证

请求：

```bash
curl -X POST https://filesync-api.epheia.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d @login_payload.json
```

验证结果：

- HTTP 200 OK。
- 响应体：`{"success":true,"data":{"account_type":"admin","scope":"admin create_rooms join_room",...}}`。
- 响应头包含 `Set-Cookie: epheia_session=...; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=604800`。

### 6.5 登录后 hash 格式

再次查询 D1，`admin.password_hash` 仍为 **pbkdf2** 格式（长度 121）。由于重置后的 hash 已使用当前默认参数（100,000 次迭代），`needsRehash` 返回 false，未触发额外的自动重哈希；密码已处于新 PBKDF2 格式。

## 7. 关键决策

1. **CORS 白名单使用精确匹配**：`wrangler.jsonc` 中只配置生产 Pages URL，不配置 `*`，符合安全目标。
2. **速率限制变量显式配置**：即使代码有默认值，也在 `vars` 中显式声明，避免生产阈值不可控。
3. **PBKDF2 迭代数降至 100,000**：这是 Cloudflare Workers Web Crypto 当前支持的上限（见 `workerd` issue #1346）。虽然低于 OWASP 2023 对 PBKDF2-SHA256 的 600,000 建议，但高于不支持运行时下的“无法登录”。后续若 Workers 提升上限，可通过单点修改 `DEFAULT_ITERATIONS` 恢复或提升。
4. **不披露临时密码与 hash**：验证完成后，临时密码仍存储于 D1 中，已明确列为遗留风险，建议用户立即修改。

## 8. 已知遗留问题

- **临时管理员密码需要立即修改**：当前 `admin` 密码为本次修复设置的临时密码。建议用户尽快通过 `PUT /api/admin/password` 设置为强最终密码。由于 PBKDF2 迭代数已调整为 Workers 支持值，该接口现在可以正常工作。
- **PBKDF2 迭代数受平台限制**：当前使用 100,000 次迭代，这是 Cloudflare Workers 的运行时上限。若未来平台放宽限制，应重新评估并提升迭代数。
- **wrangler 版本**：当前使用 wrangler 3.114.17，部署时提示有新版本。升级 wrangler 到 v4 是后续维护窗口的待办项，但不是本次修复的阻塞项。

(End of file)
