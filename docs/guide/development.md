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
npx wrangler d1 execute filesync-db-v2 --file packages/backend/db/schema.sql --remote

# Apply seed data (creates admin account)
npx wrangler d1 execute filesync-db-v2 --file packages/backend/db/seed.sql --remote

# Run arbitrary SQL
npx wrangler d1 execute filesync-db-v2 --command "SELECT * FROM rooms" --remote

# Local D1 (for dev)
npx wrangler d1 execute filesync-db-v2 --file packages/backend/db/schema.sql --local

# Audit log table (added during security remediation)
npx wrangler d1 execute filesync-db-v2 --file packages/backend/db/migrations/0003_add_audit_log.sql --remote
npx wrangler d1 execute filesync-db-v2 --file packages/backend/db/migrations/0003_add_audit_log.sql --local
```

## Build

```bash
# Build frontend for production
pnpm build:frontend
# or: cd packages/frontend && npm run build
```

## Deploy

### Production Deployment

Before deploying to production, confirm that `CORS_ALLOWED_ORIGINS` and rate-limit variables are set in `packages/backend/wrangler.jsonc` (or via CI environment variables / wrangler secrets). The production deployment uses the following resources:

- Worker: `filesync-api`
- D1 Database: `filesync-db-v2`
- KV Namespace: `FILESYNC_KV_V2`
- R2 Bucket: `filesync-v2`
- Pages Project: `epheia-files`

> Note: Original resources (`filesync-db`, `EPHEIA_FILES_KV`, `filesync`) were rotated after their IDs appeared in git history. Old resources are left for manual cleanup.
- R2 Bucket: `filesync`
- Pages Project: `epheia-files`

Deploy steps:

```bash
# 1. Deploy backend Worker
cd packages/backend
npx wrangler deploy

# 2. Apply D1 migrations
cd packages/backend
# Apply all pending migrations
npx wrangler d1 migrations apply filesync-db --remote
# Or apply a specific migration file
npx wrangler d1 execute filesync-db --file packages/backend/db/migrations/0003_add_audit_log.sql --remote

# 3. Verify required vars are present
# CORS_ALLOWED_ORIGINS must match the exact Pages origin, e.g. https://epheia-files.pages.dev
# RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_FAILURES, RATE_LIMIT_BLOCK_SECONDS should be set
```

After deploying, verify CORS and rate-limit behavior:

```bash
# Valid origin should echo the exact origin
curl -i -H "Origin: https://epheia-files.pages.dev" \
  https://filesync-api.epheia.workers.dev/api/health

# Invalid origin should not receive Access-Control-Allow-Origin
curl -i -H "Origin: https://evil.example.com" \
  https://filesync-api.epheia.workers.dev/api/health
```

### Deploy Frontend to Pages

```bash
cd packages/frontend
npm run build
npx wrangler pages deploy dist --project-name epheia-files
```

## End-to-End Testing

Playwright end-to-end tests live in `packages/frontend/e2e/` and target the production Pages deployment.

### Setup

```bash
cd packages/frontend

# Install test dependencies
pnpm add -D @playwright/test dotenv

# Install Chromium browser
npx playwright install chromium

# Create test credentials from the template
cp .env.test.template .env.test
# Edit .env.test with real admin credentials (do not commit this file)
```

### Run Tests

```bash
cd packages/frontend
npx playwright test --reporter=list
```

Test files:

| File | Coverage |
|------|----------|
| `e2e/homepage.spec.ts` | Home page renders and login form is visible |
| `e2e/login.spec.ts` | Admin login succeeds and navigates to `/rooms` |
| `e2e/room.spec.ts` | Admin creates a room and the room list shows a new 4-digit room code |

Screenshots and reports are written to `.agent-swarm/2026-06-22_deploy-e2e/screenshots/` and `playwright-report/` respectively; both paths are gitignored.

### Important Testing Notes

- Credentials must be injected via `.env.test`. Never commit real credentials to git.
- Repeated failed login attempts trigger KV rate-limit blocks. Before running login tests, ensure the current IP and `admin` user are not locked; if they are, delete the relevant KV keys:
  ```bash
  npx wrangler kv:key delete --binding EPHEIA_FILES_KV ratelimit:user:admin:block --remote
  npx wrangler kv:key delete --binding EPHEIA_FILES_KV ratelimit:user:admin:fail --remote
  npx wrangler kv:key delete --binding EPHEIA_FILES_KV ratelimit:ip:<YOUR_IP>:block --remote
  npx wrangler kv:key delete --binding EPHEIA_FILES_KV ratelimit:ip:<YOUR_IP>:fail --remote
  ```
- The admin password used by Playwright should be recorded in `AGENTS.local.md` or another secure location; losing it will prevent future automated login tests.

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

### Security Configuration

The backend reads the following optional vars from `env` / `wrangler.jsonc`:

| Variable | Default | Recommended Production Value |
|----------|---------|------------------------------|
| `CORS_ALLOWED_ORIGINS` | reflects any origin | `https://epheia-files.pages.dev` (exact origin, no `*`) |
| `RATE_LIMIT_WINDOW_SECONDS` | 300 | 300 |
| `RATE_LIMIT_MAX_FAILURES` | 5 | 5 |
| `RATE_LIMIT_BLOCK_SECONDS` | 900 | 900 |

Example `wrangler.jsonc` snippet:

```jsonc
"vars": {
  "CORS_ALLOWED_ORIGINS": "https://epheia-files.pages.dev",
  "RATE_LIMIT_WINDOW_SECONDS": "300",
  "RATE_LIMIT_MAX_FAILURES": "5",
  "RATE_LIMIT_BLOCK_SECONDS": "900"
}
```

For production, set `CORS_ALLOWED_ORIGINS` via wrangler secret or CI environment variable rather than committing the list.

**Note:** `RATE_LIMIT_*` values are passed as strings in `wrangler.jsonc` because wrangler serializes `vars` as strings. The backend parses them at runtime.

## Auth Flow

1. `POST /api/auth/login` → returns session token + sets `epheia_session` HttpOnly cookie
2. All subsequent requests carry cookie (browser) or `Authorization: Bearer` header (API)
3. Middleware validates token against KV on each request
4. Admin can create temp credentials (8-char Crockford base32 codes) and API keys

## Production Deployment Checklist

Before deploying to production after the security remediation:

- [ ] Apply D1 migration `packages/backend/db/migrations/0003_add_audit_log.sql`
- [ ] Set `CORS_ALLOWED_ORIGINS` to the exact production frontend origin(s); verify it does not contain `*`
- [ ] Review `RATE_LIMIT_*` values; raise `RATE_LIMIT_MAX_FAILURES` if your users sit behind large NATs
- [ ] Confirm admin password is recorded in a secure location (e.g. `AGENTS.local.md`)
- [ ] Verify `pnpm test` and `pnpm lint` pass locally
- [ ] Run Playwright e2e tests against production Pages: `cd packages/frontend && npx playwright test`
- [ ] After go-live, monitor login success rate and Workers CPU time for PBKDF2 iterations
