# 2026-07 Admin API Key Management 部署经验

## 关键教训：D1 Schema 迁移必须先于后端部署

在 Admin API Key Management 功能中，后端 `POST /api/auth/api-keys` 与 `GET /api/auth/api-keys` 都开始读写 `credential_audit.label` 列。

如果先部署后端再执行 D1 迁移，会导致：

- `INSERT INTO credential_audit (... label ...)` 因列不存在而报错，创建 API key 失败。
- `SELECT ... label ...` 同样会因列不存在而报错，列表查询失败。

### 正确顺序

1. 先执行 D1 迁移：

   ```bash
   npx wrangler d1 execute filesync-db-v2 --file=packages/backend/db/migrations/2026-07-13-add-credential-label.sql
   ```

   迁移内容：

   ```sql
   ALTER TABLE credential_audit ADD COLUMN label TEXT;
   ```

2. 验证 `label` 列已存在（可通过 `npx wrangler d1 execute filesync-db-v2 --command="PRAGMA table_info(credential_audit);"`）。
3. 再部署后端 Worker：

   ```bash
   pnpm --filter @filesync/backend run deploy
   ```

4. 最后部署前端 Pages。

### 为什么是 `label TEXT` 而不是 NOT NULL

- `label` 保持可为空，以兼容历史 API key 记录。
- 接口层（Zod schema）强制要求创建时提供 1–100 字符的 label，但数据库层不强制，避免迁移时破坏旧数据。

### 参考

- `packages/backend/db/schema.sql` 第 116–130 行：`credential_audit` 表定义与迁移注释。
- `packages/backend/db/migrations/2026-07-13-add-credential-label.sql`：新增迁移文件。
- `packages/backend/src/auth/credentials.ts`：`handleCreateApiKey` / `handleListApiKeys` 实现。
