---
step: 2
agent: implementer
task: filesync-backend-security-audit-remediation-phase3-fixes
upstream:
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_security-audit-remediation\impl-1.md
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_security-audit-remediation\review.md
produced_at: 2026-06-22T18:10:00+08:00
status: completed
---

# filesync 后端安全改进 Phase 3 修复报告

## 1. 修复摘要

针对 reviewer 在 `review.md` 中标记的 **4 个 Major 问题** 全部完成修复，并补充了相应测试。同提交处理了多项 Minor 建议。

| Major | 问题 | 修复措施 |
|-------|------|----------|
| M1 | `admin/password.ts` 使用子串匹配判断 admin 权限 | 改为 `hasScope(session, SCOPES.ADMIN)` 精确匹配 |
| M2 | `auth/credentials.ts` API Key 吊销未按 `keyHash` 匹配审计记录 | 创建 API key 时将 `audit_id` 存入 KV；吊销时先读 KV 按 `audit_id` 精确更新；无 `audit_id` 时回退到 `code_hash` 匹配 |
| M3 | `cron/cleanup.ts` 孤立 R2 清理预加载全部活跃 `r2_key` | 改为单次 Cron 最多处理 `ACTIVE_KEY_BATCH`（1000）条 D1 活跃 key；新增 `cleanup:orphan_d1_offset` cursor；R2 与 D1 双 cursor 协同续传 |
| M4 | 缺少 CORS 白名单测试 | 导出 `createCorsOptions(env)` 纯函数；新增 `test/cors.test.ts` 覆盖反射、白名单命中、非法 origin、`credentials: true` 不返回 `*` |

## 2. 文件改动清单

### 修改文件

| 文件 | 改动要点 |
|------|----------|
| `packages/backend/src/admin/password.ts` | 导入 `hasScope`，权限判断改为精确 scope 匹配。 |
| `packages/backend/src/auth/credentials.ts` | API key KV 数据增加 `audit_id`；`handleRevokeApiKey` 先读 KV 再删除，按 `audit_id` 精确吊销，无 `audit_id` 时按 `code_hash` 回退；`console.error` 加 `[Debt: structured logging]`。 |
| `packages/backend/src/auth/login.ts` | 合并 `sha256` import，移除未使用的 `SCOPES`。 |
| `packages/backend/src/cron/cleanup.ts` | 孤立 R2 清理改为 D1 offset + R2 cursor 双分页；限制单批 D1 key 数量；所有 `console.error` 加 `[Debt: structured logging]`。 |
| `packages/backend/src/index.ts` | 导出 `createCorsOptions(env)`；CORS 中间件按请求 env 动态构建；`console.error`/`console.log` 加 `[Debt: structured logging]`；origin 匹配改为大小写不敏感但返回原始 casing。 |
| `packages/backend/src/utils/id.ts` | 更新顶部注释，说明 session token / temp code 使用 `crypto.getRandomValues`。 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `packages/backend/test/cors.test.ts` | CORS 白名单单元测试。 |
| `packages/backend/test/auth/credentials.test.ts` | API Key 创建（含 `audit_id` 存储）与吊销正确性测试，含 legacy 回退。 |

### 更新测试

| 文件 | 更新内容 |
|------|----------|
| `packages/backend/test/admin/password.test.ts` | 新增 `room_admin` 子串 scope 拒绝测试。 |
| `packages/backend/test/cron/cleanup.test.ts` | 调整 SQL 断言匹配新格式；新增 D1 offset 推进测试。 |

## 3. 关键实现细节

### M2: API Key 吊销精确匹配

- `handleCreateApiKey` 在 KV 中写入 `audit_id: auditId`。
- `handleRevokeApiKey` 流程：
  1. `KV.get(apikey:{hash})` 读取 key 数据。
  2. `KV.delete(apikey:{hash})` 删除 KV。
  3. 若解析出 `audit_id`，执行 `UPDATE credential_audit SET revoked_at = ? WHERE id = ? AND type = 'api_key'`。
  4. 若 KV 无数据或数据无 `audit_id`（旧数据兼容），回退到 `UPDATE ... WHERE type = 'api_key' AND code_hash = ? AND revoked_at IS NULL`。
- 测试验证多 key 场景下仅目标 key 被吊销，且 SQL 按 `id` 精确匹配。

### M3: 孤立 R2 清理双 Cursor 分页

- `cleanup:orphan_d1_offset`：D1 活跃 `r2_key` 的 `OFFSET`。
- `cleanup:orphan_cursor`：R2 `list()` 的 cursor。
- 每次 Cron：
  1. 读取 D1 offset，查询 `LIMIT 1000 OFFSET {offset}` 活跃 keys。
  2. 读取 R2 cursor（如有），`FILES.list({ limit: 1000, cursor })`。
  3. 对未命中 Set 的 object 做 `SELECT 1` 二次确认后删除。
  4. 若 R2 list 仍 truncated，保存 R2 cursor 并保持 D1 offset（下次继续扫同一 D1 批）。
  5. 若 R2 list 完成但 D1 返回满 1000 条，推进 D1 offset（下次扫下一批）。
  6. 若全部完成，重置两个 cursor。
- 保证单次 Cron 内存占用有界（最多 1000 个 D1 key + 1000 个 R2 object）。

### M4: CORS 测试

- `index.ts` 导出 `createCorsOptions(env)`，使测试无需启动完整 Hono app。
- 测试覆盖：
  - 未配置 / `"*"` → 反射 origin。
  - 白名单命中 → 精确 origin。
  - 非法 origin → `null`。
  - 生产白名单模式下绝不返回 `*`（满足 `credentials: true` 要求）。
  - 大小写不敏感匹配但返回原始 casing。

## 4. 测试覆盖

### 新增测试

| 文件 | 覆盖功能 |
|------|----------|
| `test/cors.test.ts` | CORS 反射、白名单命中、非法 origin 拒绝、credentials 约束、大小写处理。 |
| `test/auth/credentials.test.ts` | API key 创建写入 `audit_id`；多 key 场景精确吊销；legacy KV 无 `audit_id` 时按 `code_hash` 回退。 |

### 更新测试

| 文件 | 覆盖功能 |
|------|----------|
| `test/admin/password.test.ts` | `room_admin` 子串 scope 不能改密。 |
| `test/cron/cleanup.test.ts` | R2 cursor 保持、D1 offset 推进、orphan 删除计数、竞态二次确认。 |

### 验证结果

```bash
pnpm test   # 16 个测试文件 / 166 个测试全部通过
pnpm lint   # TypeScript 无错误
```

## 5. Minor 项处理情况

| Minor | 文件 | 状态 | 说明 |
|-------|------|------|------|
| m1 | `auth/credentials.ts:107,289,346` | ✅ 已处理 | 添加 `[Debt: structured logging]` 注释。 |
| m2 | `cron/cleanup.ts:322` | ✅ 已处理 | 添加 `[Debt: structured logging]` 注释。 |
| m3 | `index.ts:234,259,263` | ✅ 已处理 | 添加 `[Debt: structured logging]` 注释。 |
| m4 | `index.ts` 每次请求解析 CORS | ⏸ 未处理 | 实现仍每次请求解析，但解析函数纯且开销极低；未做缓存以避免多环境配置复杂性。 |
| m5 | `auth/login.ts` 未使用 `SCOPES` | ✅ 已处理 | 移除未使用导入。 |
| m6 | `utils/id.ts` 顶部注释 | ✅ 已处理 | 已更新。 |
| m7 | `files/download.ts` `actor_id` 使用原始 token | ⏸ 未处理 | 属于隐私增强建议，不影响功能正确性，留待后续统一审计脱敏策略。 |
| m8 | `crypto/pbkdf2.ts fromHex` 未校验 hex | ⏸ 未处理 | 非法 hex 最终会导致验证失败，结果安全；提前返回 false 是优化项。 |
| m9 | `auth/credentials.ts` API key 审计 `expires_at` 与 KV 不一致 | ⏸ 未处理 | 当前业务 KV 永久有效、审计表填 1 年；需产品层面统一语义。 |
| m10 | 文档更新 | ⏸ 未处理 | `docs/architecture/current-state.md` 与 `docs/guide/development.md` 不在本次修复范围，建议后续由 docs-maintainer 补充。 |

## 6. 验证命令

```bash
cd E:\Epheia\dev\apps\serverless\express
pnpm test
pnpm lint
```

## 7. 已知限制

- 同 `impl-1.md` 中列出的已知限制（审计日志保留策略、重哈希异步可靠性、生产 CORS 配置校验、速率限制 NAT 误锁、审计查询 admin endpoint）仍然适用。
- Minor 项 m4/m7/m8/m9/m10 未在本次修复，理由见上表。

## 8. 关键提交

- **Commit**: `f856f886b3f122fa8b1d8d66512e035cd7e1df8f`
- **Message**: `fix(audit): address Phase 3 review Major issues - scope match, API key revoke, orphan cleanup pagination, CORS tests`
