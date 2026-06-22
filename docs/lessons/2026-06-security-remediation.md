# filesync 安全改进经验教训（2026-06）

## 背景

本次改进针对 2026-06-22 安全模型审计中识别的高、中优先级后端安全债务，覆盖密码哈希、CORS、登录速率限制、会话 token、scope 硬编码、孤立 R2 清理、临时凭证熵与最小化审计日志。

## 1. 从 SHA-256 迁移到 PBKDF2

### 教训

纯 SHA-256(salt + password) 没有工作因子，现代 GPU 可在极短时间内暴力破解。Cloudflare Workers 的 Web Crypto API 原生支持 PBKDF2-SHA256，因此无需引入 bcrypt/Argon2 的 WASM 包，避免了 Workers 环境下的启动抖动与内存限制。

### 决策

- 采用 PBKDF2-SHA256，100,000 次迭代（Cloudflare Workers Web Crypto 当前支持的最大值）。
- 使用自描述字符串 `$pbkdf2-sha256$i=100000$<salt>$<hash>`，便于未来再次升级。
- 保留旧 SHA-256 验证路径，登录成功后自动重哈希并写回 D1，失败不影响当前登录。

### 后续注意

- Cloudflare Workers Web Crypto 当前将 PBKDF2 迭代数硬性上限设为 100,000（见 workerd issue #1346）。尝试使用 600,000 或 210,000 等更高值会在生产环境触发 `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported`，导致登录完全不可用。当前代码默认使用 100,000，这是平台支持的最大值。
- 上线后监控登录成功率与 `/api/auth/login` 的 CPU 耗时；若平台未来放宽限制，应通过 `DEFAULT_ITERATIONS` 单点提升迭代数，无需修改存储格式。
- 旧验证路径应在所有活跃账户完成重哈希后再移除。

## 2. CORS 通配符 + credentials 的风险

### 教训

开发阶段使用 `origin: (origin) => origin || '*'` 配合 `credentials: true` 虽然能跑，但逻辑上通配 origin 与凭据请求互斥。浏览器实际行为是反射 origin，这意味着生产环境若不显式配置，任何恶意站点都可带凭据调用后端。

### 决策

- 引入 `CORS_ALLOWED_ORIGINS` 环境变量，开发可设 `"*"`，生产必须设为逗号分隔的精确 origin 列表。
- 白名单模式下 origin 回调返回匹配 origin 的原始 casing，绝不返回 `*`，确保 `credentials: true` 合法。

### 后续注意

- 生产部署脚本应强制校验 `CORS_ALLOWED_ORIGINS` 非空且不含 `*`。
- 首次切生产建议先启用"反射 origin + 日志告警"模式收集真实 origin，再切严格白名单。

## 3. KV 实现速率限制的竞态与阈值选择

### 教训

Cloudflare KV 是最终一致性存储，不适合作为精确的分布式计数器。`get → increment → put` 三步之间存在竞态，攻击者可在窗口内发送大量并发请求导致计数低估。

### 决策

- 采用"固定窗口 + 失败计数器 + 临时锁定标志"的混合策略，容忍小幅度的竞态低估。
- 同时按 IP 与 username 两个维度计数：IP 维度防御单点暴力，username 维度防御 IP 轮换。
- 默认 5 次失败 / 5 分钟窗口，锁定 15 分钟。

### 后续注意

- 大型 NAT/企业出口下 IP 维度可能误锁合法用户，可考虑放宽 IP 阈值或提供 wrangler KV 删除命令文档化解锁。
- 上线后监控失败率，必要时调整窗口与阈值。

## 4. 孤立 R2 清理的双 cursor 分页策略

### 教训

最初设计一次性加载全部 D1 活跃 `r2_key` 到内存，在 Workers CPU/内存限制下不可行，且 R2 `list()` 也是分页 API。

### 决策

- 使用两个游标分别跟踪 D1 offset 与 R2 cursor，每次 Cron 最多处理 1,000 条 D1 key 和 1,000 个 R2 object。
- 删除前对未命中 Set 的 key 再做一次 `SELECT 1` 二次确认，避免误删上传中但元数据尚未写入的文件。
- 游标保存在 KV，单次处理不完则下次 Cron 续传。

### 后续注意

- 若 R2 对象量极大，需评估 Cron 频率是否足够，必要时提高处理批次上限（同时注意 CPU 时间）。
- 清理计数与游标状态应加入可观测性指标。

## 5. API Key 吊销审计记录精确匹配的教训

### 教训

最初的 API key 吊销逻辑按 `code_hash` 更新 `credential_audit` 表。当同一 admin 创建多个 API key 时，`code_hash` 虽然唯一，但按 hash 匹配不如按审计表主键精确，且旧数据可能缺少必要的关联信息。

### 决策

- 创建 API key 时生成 `audit_id` 并随 key 数据存入 KV。
- 吊销时先从 KV 读取 key 数据，若存在 `audit_id` 则按 `UPDATE ... WHERE id = ? AND type = 'api_key'` 精确吊销。
- 对无 `audit_id` 的旧 KV 数据，回退到 `code_hash` 匹配。

## 6. 生产部署教训

### 6.1 CORS 白名单必须显式配置

生产环境首次部署后，`CORS_ALLOWED_ORIGINS` 缺失导致后端反射任意 `Origin`，配合 `credentials: true` 相当于允许任何网站带凭据调用 API。修复方式是在 `wrangler.jsonc` 的 `vars` 中显式写入精确 origin，例如 `https://epheia-files.pages.dev`，并重新部署。

**关键操作：**

- 部署前检查 `wrangler.jsonc` 中 `CORS_ALLOWED_ORIGINS` 非空且不含 `*`。
- 部署后用 curl 分别测试合法 origin 和非法 origin，确认合法 origin 返回 `Access-Control-Allow-Origin: <exact-origin>`，非法 origin 不返回该头。

### 6.2 管理员密码必须记录在安全位置

部署后如果不知道当前 `admin` 密码，就无法通过登录测试验证后端是否可用。两次修复中均需要重新生成密码并更新 D1 `admin_accounts.password_hash`。

**关键操作：**

- 将当前生产 `admin` 密码记录在 `AGENTS.local.md` 或同等级别的安全笔记中（不要提交到 git）。
- 每次重置密码后同步更新 `.env.test` 和 `AGENTS.local.md`。
- 最终密码应通过前端“管理员面板 → 修改密码”或 `PUT /api/admin/password` 设置。

### 6.3 Playwright 凭据通过 `.env.test` 注入

端到端测试需要真实 `admin` 密码，但密码不能写入测试代码或 git。解决方案是使用 `packages/frontend/.env.test`，由 Playwright 配置通过 `dotenv` 加载，并将该文件加入 `.gitignore`。

**关键操作：**

- 提供 `.env.test.template` 作为可提交模板（不含真实密码）。
- 每个开发者/CI 实例单独创建 `.env.test`。
- 不要把 `.env.test` 加入任何共享存储或聊天记录。

### 6.4 速率限制测试会触发 KV 锁定

登录失败 5 次会触发用户名维度 + IP 维度共 15 分钟封禁。测试过程中若连续使用错误密码验证，会导致后续合法登录返回 `429 Too Many Requests`。

**关键操作：**

- Playwright 测试前确认没有遗留的 rate-limit KV 键；若有，执行 `wrangler kv:key delete --binding KV --remote` 清理 `ratelimit:user:admin:block`、`ratelimit:user:admin:fail` 以及当前 IP 维度键。
- 测试脚本失败后检查 `Retry-After` 头，避免在封禁期间重试。
- 为测试环境单独准备测试账号或临时提高阈值，避免锁死生产 `admin`。

### 6.5 资源 ID 泄露后的轮换

`packages/backend/wrangler.jsonc` 曾被 git 跟踪，导致 D1 database_id、KV namespace id、R2 bucket name 暴露在公开仓库历史中。虽然这些 ID 本身不是密钥，但为降低被组合利用的风险，我们为生产环境创建了全新的 v2 资源：

- D1: `filesync-db-v2`
- KV: `FILESYNC_KV_V2`
- R2: `filesync-v2`

**关键操作：**

- 更新 `wrangler.jsonc` 中的 bindings，重新部署 Worker。
- 更新 `AGENTS.local.md` 中的资源映射。
- 旧资源保留供手动确认后删除；删除前确保没有未迁移的数据或依赖。
- 未来始终将 `wrangler.jsonc` 保持在 `.gitignore` 中，仅提交 `wrangler.jsonc.template`。

---

## 总结

本次安全改进不仅涉及代码层面，更暴露了生产部署流程中的配置与凭证管理问题。长期维护时应将 `wrangler.jsonc` 的安全变量检查、D1 迁移应用、`.env.test` 注入和 KV 解锁命令文档化，纳入每次部署的标准操作程序。
