/**
 * Backend-specific types for Hono context and Cloudflare bindings.
 * Shared across all route handlers to ensure consistent typing.
 */

import type { SessionData } from '@filesync/shared';

/** Cloudflare Workers bindings available in the environment */
export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  FILES: R2Bucket;
  RoomDO: DurableObjectNamespace;

  // Configuration vars (set via wrangler.jsonc or secrets)
  CORS_ALLOWED_ORIGINS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_MAX_FAILURES?: string;
  RATE_LIMIT_BLOCK_SECONDS?: string;
}

/** Custom variables set by middleware and available in route handlers */
export interface Variables {
  session: SessionData | null;
  sessionToken: string;
}

/** Full Hono context type for filesync API */
export type AppContext = {
  Bindings: Bindings;
  Variables: Variables;
};

/**
 * Full environment type used by cron scheduled handlers and DO alarm handlers.
 * Same as Bindings but usable outside of Hono request context.
 */
export type AppEnv = Bindings;
