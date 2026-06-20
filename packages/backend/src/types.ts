/**
 * Backend-specific types for Hono context and Cloudflare bindings.
 * Shared across all route handlers to ensure consistent typing.
 */

import type { SessionData } from '@epheia-files/shared';

/** Cloudflare Workers bindings available in the environment */
export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  FILES: R2Bucket;
  RoomDO: DurableObjectNamespace;
}

/** Custom variables set by middleware and available in route handlers */
export interface Variables {
  session: SessionData | null;
  sessionToken: string;
}

/** Full Hono context type for epheia-files API */
export type AppContext = {
  Bindings: Bindings;
  Variables: Variables;
};
