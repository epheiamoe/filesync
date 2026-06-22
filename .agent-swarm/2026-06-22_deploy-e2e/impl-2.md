---
step: 2
agent: implementer
task: 修复 docs/lessons/2026-06-security-remediation.md 中 PBKDF2 迭代数过时表述
upstream:
  - E:\Epheia\dev\apps\serverless\express\.agent-swarm\2026-06-22_deploy-e2e\review.md
  - E:\Epheia\dev\apps\serverless\express\docs\lessons\2026-06-security-remediation.md
  - E:\Epheia\dev\apps\serverless\express\packages\backend\src\crypto\pbkdf2.ts
produced_at: 2026-06-23T04:26:14+08:00
status: completed
---

# 文档修复报告：PBKDF2 迭代数表述

## 1. 修复摘要

根据 reviewer 在 `review.md` 中指出的问题，修复了 `docs/lessons/2026-06-security-remediation.md` 第 21 行附近关于 PBKDF2 迭代数的过时监控建议。

| 项目 | 内容 |
|---|---|
| 修改文件 | `docs/lessons/2026-06-security-remediation.md` |
| 原表述 | "上线后监控 Workers CPU 耗时；若 600k 迭代触发 CPU 限制，可逐步降低，但不低于 210,000。" |
| 新表述 | 明确 Cloudflare Workers Web Crypto 的 100,000 次迭代硬性上限，说明更高值会触发 `NotSupportedError`，并给出平台放宽限制后的升级路径。 |

源码与测试文件未被修改。

## 2. 关键表述

更新后的第 21 行附近内容：

```markdown
### 后续注意

- Cloudflare Workers Web Crypto 当前将 PBKDF2 迭代数硬性上限设为 100,000（见 workerd issue #1346）。尝试使用 600,000 或 210,000 等更高值会在生产环境触发 `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported`，导致登录完全不可用。当前代码默认使用 100,000，这是平台支持的最大值。
- 上线后监控登录成功率与 `/api/auth/login` 的 CPU 耗时；若平台未来放宽限制，应通过 `DEFAULT_ITERATIONS` 单点提升迭代数，无需修改存储格式。
- 旧验证路径应在所有活跃账户完成重哈希后再移除。
```

## 3. 验证

- 已使用 grep 搜索文档中的 `600k`、`600,000`、`210,000` 旧建议表述。唯一命中即为更新后的段落，用于警示这些值不可使用，不再是推荐值。
- 文档中已无 "不低于 210,000" 或 "若 600k 迭代触发 CPU 限制，可逐步降低" 这类与当前实现矛盾的表述。
- 运行 `pnpm lint` 通过：

```text
Scope: 2 of 3 workspace projects
packages/backend lint$ tsc --noEmit
packages/backend lint: Done
```

## 4. 已知说明

- 本次仅修复文档一致性，未涉及源码逻辑变更。
- 100,000 次迭代仍是 Cloudflare Workers Web Crypto 的当前上限；后续应跟踪 `workerd` issue #1346，平台放宽限制后单点提升 `DEFAULT_ITERATIONS`。

(End of file)
