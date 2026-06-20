# epheia-files

端到端加密文件同步 + 临时聊天工具，基于 Cloudflare Workers。

## 部署

### 前提条件

1. [Cloudflare 账号](https://dash.cloudflare.com)，开启 Workers Paid 计划
2. 在 Dashboard 启用 **R2**（需手动开启）
3. 安装 [wrangler](https://developers.cloudflare.com/workers/wrangler/)

### 快速开始

```bash
# 1. 安装依赖
pnpm install
cd packages/frontend && npm install && cd ../..

# 2. 创建 Cloudflare 资源
cd packages/backend
npx wrangler d1 create epheia-files-db
npx wrangler kv namespace create EPHEIA_FILES_KV
# 在 Dashboard 创建 R2 bucket: epheia-files

# 3. 配置 wrangler.jsonc
cp wrangler.jsonc.template wrangler.jsonc
# 编辑 wrangler.jsonc，填入 D1 database_id 和 KV namespace id

# 4. 部署 D1 schema + seed
npx wrangler d1 execute epheia-files-db --file db/schema.sql --remote
npx wrangler d1 execute epheia-files-db --file db/seed.sql --remote

# 5. 部署后端
npx wrangler deploy

# 6. 部署前端
cd ../frontend
npm run build
npx wrangler pages deploy dist --project-name epheia-files
```

首次登录：用户名 `admin`，密码见 seed.sql 或部署日志。

### 修改管理员密码

登录后进入「管理面板」→「修改密码」，或直接调用 API：

```bash
curl -X PUT https://epheia-files-api.<your-subdomain>.workers.dev/api/admin/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"current_password":"old","new_password":"newpassword123"}'
```

## 技术栈

- **后端**: Cloudflare Workers + Hono + Durable Objects + D1 + R2 + KV
- **前端**: React + Vite + Tailwind CSS + Framer Motion + PWA
- **加密**: Web Crypto API (AES-256-GCM)，端到端加密，服务端不存储密钥

## API 文档

详见 [docs/api.md](docs/api.md)。

## 许可

MIT
