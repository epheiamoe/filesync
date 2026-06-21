# filesync Development Guide

## Prerequisites

- Node.js >= 18.0.0
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9.0.0 --activate`)
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account with Workers Paid plan
- R2, D1, KV enabled in Cloudflare Dashboard

## Setup

```bash
# Install dependencies (root + workspace packages)
pnpm install

# Install frontend deps (not in pnpm workspace)
cd packages/frontend && npm install && cd ../..

# Copy and configure wrangler config
cp packages/backend/wrangler.jsonc.template packages/backend/wrangler.jsonc
# Edit wrangler.jsonc with your D1 database_id, KV namespace id, and R2 bucket name
```

## Development

```bash
# Start backend dev server (local, port 8787)
pnpm dev
# or: pnpm --filter @filesync/backend dev

# Start frontend dev server (local, port 5173)
pnpm dev:frontend
# or: cd packages/frontend && npm run dev

# Both must run concurrently for full-stack dev
```

## Testing

```bash
# Run backend tests (Vitest with Cloudflare Workers pool)
pnpm test
# or: pnpm --filter @filesync/backend test

# Watch mode
pnpm --filter @filesync/backend test:watch

# Test files are in packages/backend/test/
```

## Type Checking

```bash
# Backend
cd packages/backend && npx tsc --noEmit

# Frontend
cd packages/frontend && npx tsc --noEmit

# (Frontend build runs tsc before vite build automatically)
```

## D1 Migrations

```bash
# Apply schema
npx wrangler d1 execute filesync-db --file packages/backend/db/schema.sql --remote

# Apply seed data (creates admin account)
npx wrangler d1 execute filesync-db --file packages/backend/db/seed.sql --remote

# Run arbitrary SQL
npx wrangler d1 execute filesync-db --command "SELECT * FROM rooms" --remote

# Local D1 (for dev)
npx wrangler d1 execute filesync-db --file packages/backend/db/schema.sql --local
```

## Build

```bash
# Build frontend for production
pnpm build:frontend
# or: cd packages/frontend && npm run build
```

## Deploy

```bash
# Deploy backend Worker
pnpm deploy
# or: cd packages/backend && npx wrangler deploy

# Deploy frontend to Cloudflare Pages
cd packages/frontend
npm run build
npx wrangler pages deploy dist --project-name filesync
```

## Project Structure

```
filesync/
├── packages/
│   ├── backend/          # Cloudflare Worker (Hono + DO + D1 + R2 + KV)
│   │   ├── src/
│   │   │   ├── auth/     # Login, session, credentials
│   │   │   ├── rooms/    # Create, join, list
│   │   │   ├── files/    # Upload (chunked), download, recall
│   │   │   ├── chat/     # Messages CRUD
│   │   │   ├── ws/       # WebSocket ticket + connect handlers
│   │   │   ├── do/       # RoomDO (hibernatable WebSocket relay)
│   │   │   ├── admin/    # Stats, rooms, password, config
│   │   │   ├── cron/     # Scheduled cleanup
│   │   │   └── utils/    # ID generation, helpers
│   │   ├── db/           # schema.sql, seed.sql
│   │   └── test/         # Vitest test files
│   ├── frontend/         # React SPA (Vite + Tailwind + Zustand)
│   │   └── src/
│   │       ├── components/
│   │       │   ├── chat/     # ChatPage, MessageList, MessageBubble, ChatInput
│   │       │   ├── transfer/ # FileList, FileItem, UploadZone, UploadProgress, TransferPage
│   │       │   ├── shared/   # QRShare
│   │       │   └── ui/       # Button, Card, Input, Toast, Spinner, etc.
│   │       ├── lib/          # api, ws, crypto, store, url, device
│   │       ├── pages/        # RoomPage, RoomListPage, LoginPage, AdminPage, PublicViewPage
│   │       └── i18n/         # Internationalization hook
│   └── shared/           # Shared TypeScript types (DTOs)
├── docs/
│   ├── api.md            # API reference
│   ├── architecture/     # Architecture documentation
│   └── guide/            # Development guides (this file)
└── DESIGN.md             # Visual design system (unrelated to filesync app)
```

## Environment Variables

The frontend auto-detects environment:
- `import.meta.env.DEV` → connects to `localhost:8787` (backend)
- Production → connects to `filesync-api.epheia.workers.dev`

Deployment URLs are tracked in `AGENTS.local.md` (gitignored).

## Auth Flow

1. `POST /api/auth/login` → returns session token + sets `epheia_session` HttpOnly cookie
2. All subsequent requests carry cookie (browser) or `Authorization: Bearer` header (API)
3. Middleware validates token against KV on each request
4. Admin can create temp credentials (6-char codes) and API keys
