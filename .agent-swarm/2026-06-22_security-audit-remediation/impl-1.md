---
step: 2
agent: implementer
task: filesync-backend-security-audit-remediation
upstream:
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_security-audit-remediation\context.md
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_security-audit-remediation\architecture.md
produced_at: 2026-06-22T17:45:00+08:00
status: completed
---

# filesync 后端安全改进实现报告

## 1. 实现范围

本次实现覆盖了架构设计中全部高/中优先级后端安全债务项：

- **密码哈希迁移（高）**：新增 PBKDF2-SHA256 实现，默认 600,000 次迭代；保留旧 SHA-256(salt+password) 验证路径，登录成功后自动重哈希并写回 D1。
- **CORS 白名单（高）**：替换全局 `cors()` 为基于 `CORS_ALLOWED_ORIGINS` 的动态白名单；开发环境可反射任意 origin，生产环境必须精确匹配。
- **登录速率限制（高）**：基于 KV 实现 IP + username 双维度计数与锁定；默认 300 秒窗口、5 次失败、900 秒锁定。
- **会话 Token 熵提升（中）**：`generateSessionToken` 改为 256-bit 随机 hex（64 字符），旧 32 字符 token 仍可验证。
- **Scope 常量（中）**：新增 `auth/scopes.ts`，统一 `ADMIN_SCOPE` / `API_KEY_SCOPE` / `TEMP_CREDENTIAL_SCOPE`。
- **孤立 R2 对象清理（中）**：`cron/cleanup.ts` 实现活跃 `r2_key` 集合比对、R2 分页 list、cursor 持久化到 KV、单点失败继续。
- **临时凭证熵提升（中）**：`generateTempCode` 改为 8 字符 Crockford Base32（40 bit），schema 放宽到 6-12 兼容旧码。
- **最小化操作审计日志（中）**：新增 `audit_log` 表与 `audit/logger.ts`，在登录、改密、凭证生命周期、文件撤回、清理任务中记录事件，写入失败不阻塞主流程。

## 2. 修改文件列表

### 新增文件

| 文件 | 说明 |
|------|------|
| `packages/backend/src/crypto/pbkdf2.ts` | PBKDF2-SHA256 哈希、验证、needsRehash，自描述格式 `$pbkdf2-sha256$i=600000$<salt>$<hash>`。 |
| `packages/backend/src/auth/scopes.ts` | Scope 常量与组合字符串。 |
| `packages/backend/src/auth/rate-limit.ts` | KV 登录速率限制：`checkRateLimit`、`recordFailedAttempt`、`clearRateLimit`、`getClientIP`。 |
| `packages/backend/src/audit/logger.ts` | 审计日志写入 `audit_log`，失败捕获不抛错。 |
| `packages/backend/db/migrations/0003_add_audit_log.sql` | 创建 `audit_log` 表与 action/actor/target 索引。 |

### 修改文件

| 文件 | 改动要点 |
|------|----------|
| `packages/backend/src/crypto/hash.ts` | 保留 `sha256`；旧 `hashPassword`/`verifyPassword` 重命名为 `legacyHashPassword`/`legacyVerifyPassword`；重新导出 PBKDF2 版本的 `hashPassword`/`verifyPassword`/`needsRehash`。 |
| `packages/backend/src/utils/id.ts` | `generateSessionToken` → 64 字符 hex；`generateTempCode` → 8 字符 Crockford Base32。 |
| `packages/backend/src/auth/session.ts` | `createSession` 使用新的 `generateSessionToken`。 |
| `packages/backend/src/auth/login.ts` | 集成速率限制、审计日志、Scope 常量、自动重哈希；`tempCodeLoginSchema` min/max 调整为 6-12。 |
| `packages/backend/src/auth/credentials.ts` | 使用 Scope 常量；临时凭证长度随生成器改变；集成审计日志。 |
| `packages/backend/src/admin/password.ts` | 改密写入 PBKDF2 hash；集成审计日志。 |
| `packages/backend/src/cron/cleanup.ts` | 实现孤立 R2 清理（活跃 key 集合 + R2 list + cursor 持久化）；记录 `cleanup_completed` / `orphan_deleted`。 |
| `packages/backend/src/files/download.ts` | 文件撤回时记录 `file_recalled` 审计事件。 |
| `packages/backend/src/index.ts` | CORS 改为基于 `CORS_ALLOWED_ORIGINS` 的白名单回调。 |
| `packages/backend/src/types.ts` | `Bindings` 增加 `CORS_ALLOWED_ORIGINS` 与 `RATE_LIMIT_*` 可选 var 类型。 |
| `packages/backend/wrangler.jsonc.template` | 增加 `CORS_ALLOWED_ORIGINS`、`RATE_LIMIT_WINDOW_SECONDS`、`RATE_LIMIT_MAX_FAILURES`、`RATE_LIMIT_BLOCK_SECONDS` 示例。 |

## 3. 关键决策

- **PBKDF2 不引入 npm 包**：直接使用 Web Crypto API，避免 Workers 中 WASM 启动抖动与包体积问题。迭代数采用 OWASP 2023 建议最低值 600,000。
- **兼容旧哈希**：`verifyPassword` 通过前缀识别格式；旧格式验证通过后由登录流程异步重哈希，失败不影响登录响应。
- **CORS 白名单解析**：`CORS_ALLOWED_ORIGINS` 支持 `*`（开发）或逗号分隔 origin 列表（生产）。未配置时默认反射 origin，与现有开发行为一致。
- **速率限制双维度**：分别计数 `ratelimit:ip:{ip}:*` 与 `ratelimit:user:{username}:*`，兼顾 NAT 共享 IP 与 IP 轮换攻击。
- **审计日志非阻塞**：所有 `logAudit` 调用均包在 `try/catch` 中，写入失败仅输出 `console.error`，不中断主业务。
- **孤立 R2 清理安全**：先加载 D1 活跃 `r2_key` 集合，再分页 list R2；删除前对未命中集合的 key 再做一次 `SELECT 1` 二次确认，避免误删上传中文件。

## 4. 测试覆盖

### 新增测试

| 文件 | 覆盖功能 |
|------|----------|
| `test/crypto/pbkdf2.test.ts` | PBKDF2 hash/verify/needsRehash、自定义参数、旧格式兼容、非法输入。 |
| `test/auth/rate-limit.test.ts` | 计数、锁定、解锁、retryAfter、IP/username 双维度、过期窗口重置。 |
| `test/auth/scopes.test.ts` | 常量值与组合字符串检查。 |
| `test/audit/logger.test.ts` | 写入成功、失败不抛错、details JSON 序列化。 |
| `test/auth/login.test.ts` | admin 登录成功、legacy 自动重哈希、速率限制触发、API key / temp code 登录与失败。 |
| `test/admin/password.test.ts` | 改密写入 PBKDF2、旧密码错误拒绝、非 admin 拒绝。 |
| `test/cron/cleanup.test.ts` | 孤立 R2 删除、D1 二次确认不删、cursor 持久化。 |

### 更新测试

| 文件 | 更新内容 |
|------|----------|
| `test/utils.test.ts` | `generateTempCode` 改为 8 字符 Crockford；`generateSessionToken` 改为 64 字符 hex。 |
| `test/crypto.test.ts` | 密码哈希测试改为 PBKDF2 格式；保留旧 seed hash 兼容验证。 |
| `test/auth.test.ts` | 会话 token 与密码验证断言更新为 PBKDF2 与 legacy 兼容。 |

### 验证结果

- `pnpm test`：14 个测试文件全部通过，共 155 个测试。
- `pnpm lint`：无 TypeScript 错误。

## 5. 遇到的问题与决策

- **循环依赖风险**：最初考虑过让 `crypto/hash.ts` 导入 `pbkdf2.ts` 并重新导出，同时 `pbkdf2.ts` 又需要 `sha256`。为避免 ESM 循环依赖隐患，`pbkdf2.ts` 内部自实现了 PBKDF2 所需的最小 SHA-256 辅助函数，`hash.ts` 仅负责重新导出与保留 legacy 函数。
- **审计写入顺序导致 mock 断言困难**：`admin/password.ts` 先执行 `UPDATE` 再写审计，`MockD1` 的 `lastRun` 被审计 SQL 覆盖。改为记录完整 runs 数组并过滤定位 `UPDATE` 断言。
- **生产 CORS 严格匹配**：当前实现只要 `CORS_ALLOWED_ORIGINS` 设置为非 `*` 列表即进入严格匹配，不依赖额外的 `ENVIRONMENT` 变量，简化了配置模型。

## 6. 验证命令

```bash
# 运行单元测试
cd E:\Epheia\dev\apps\serverless\express
pnpm test

# 运行类型检查
pnpm lint
```

## 7. 已知限制

- **审计日志表增长**：`audit_log` 目前无 TTL 或归档策略，长期运行后需设计保留/归档/清理机制（本次仅创建表与索引）。
- **重哈希异步可靠性**：在 Hono 测试环境中 `executionCtx.waitUntil` 可用；若某些运行时不支持，重哈希仍会通过 `catch` 抑制错误，但可能无法在响应返回前完成，属于可接受行为。
- **CORS 生产切换**：生产部署前必须显式设置 `CORS_ALLOWED_ORIGINS` 为合法 origin 列表；留空会在开发模式下继续反射 origin，生产脚本应额外校验该变量非空且非通配。
- **速率限制默认阈值**：IP 维度默认 5 次/5 分钟，在大型 NAT 后出口可能造成误锁； architecture.md 建议后续可放宽 IP 阈值或提供 KV 手动解锁命令文档。
- **审计查询 admin endpoint**：架构中提到的 `GET /api/admin/audit` 可选查询接口本次未实现，留待后续按需补充。

## 8. 关键提交

- **Commit**: `392133771db546cc915b3fa3bbe60895caf0bca3`
- **Message**: `security(audit): backend security remediation - PBKDF2, CORS whitelist, rate limits, audit logs`
