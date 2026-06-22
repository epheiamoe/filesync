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

- 上线后监控 Workers CPU 耗时；若 600k 迭代触发 CPU 限制，可逐步降低，但不低于 210,000。
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

### 后续注意

- 所有凭证生命周期操作都应携带持久化 ID，避免依赖派生值作为唯一匹配条件。
- 后续若统一审计脱敏策略，需同步更新 `actor_id` 的存储方式。
