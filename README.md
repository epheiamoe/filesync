# filesync

端到端加密文件同步 + 临时聊天工具，基于 Cloudflare Workers。

## 部署

### 前提条件
1. [Cloudflare 账号](https://dash.cloudflare.com)，开启 Workers Paid 计划
2. 在 Dashboard 启用 **R2**
3. 安装 [wrangler](https://developers.cloudflare.com/workers/wrangler/) 和 pnpm

### 快速开始

```bash
# 1. 安装依赖
pnpm install
cd packages/frontend && npm install && cd ../..

# 2. 创建 Cloudflare 资源
cd packages/backend
npx wrangler d1 create filesync-db
npx wrangler kv namespace create FILESYNC_KV
# 在 Dashboard 创建 R2 bucket: filesync

# 3. 配置 wrangler.jsonc
cp wrangler.jsonc.template wrangler.jsonc
# 编辑 wrangler.jsonc，填入 D1 database_id 和 KV namespace id

# 4. 部署 D1 schema + seed
npx wrangler d1 execute filesync-db --file db/schema.sql --remote
npx wrangler d1 execute filesync-db --file db/seed.sql --remote

# 5. 部署后端
npx wrangler deploy

# 6. 部署前端
cd ../frontend
npm run build
npx wrangler pages deploy dist --project-name filesync
```

首次登录：用户名 `admin`，密码见 db/seed.sql。

### 修改管理员密码

```bash
curl -X PUT <YOUR_WORKER_URL>/api/admin/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"current_password":"old","new_password":"newpassword123"}'
```

## 技术栈
- 后端: Cloudflare Workers + Hono + Durable Objects + D1 + R2 + KV
- 前端: React + Vite + Tailwind CSS + Framer Motion + PWA
- 加密: Web Crypto API (AES-256-GCM)，端到端加密

## 在线地址
- **API:** `https://filesync-api.epheia.workers.dev`
- **前端:** `https://epheia-files.pages.dev`

## 文档
- [API 文档](docs/api.md)
- [架构文档](docs/architecture/current-state.md)
- [开发指南](docs/guide/development.md)

## 配置方式
- 复制 `packages/backend/wrangler.jsonc.template` → `packages/backend/wrangler.jsonc` 并填入你的资源 ID
- 无硬编码 URL，前端自动根据环境选择 localhost 或生产 API 地址
- 实际部署 URL 记录在 `AGENTS.local.md`（已加入 .gitignore）

## 许可
MIT
