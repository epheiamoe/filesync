/**
 * Session management for filesync.
 *
 * Session tokens are stored in KV with TTL-based expiry:
 *   Key:   session:{token}
 *   Value: JSON { account_type, scope, admin_id?, created_at }
 *
 * TTL varies by login method:
 *   - admin:            7 days
 *   - api_key:          30 days
 *   - temp_credential:  24 hours
 *
 * No JWT — simple KV lookup is faster and support instant invalidation.
 *
 * @module auth/session
 */

import type { SessionData } from '@filesync/shared';

/** TTL in seconds for each account type */
const SESSION_TTL: Record<string, number> = {
  admin: 7 * 24 * 60 * 60,       // 7 days
  api_key: 30 * 24 * 60 * 60,    // 30 days
  temp_credential: 24 * 60 * 60, // 24 hours
};

/**
 * Create a session in KV and return the token.
 * The token is generated as a UUID with hyphens removed (32 hex chars).
 *
 * @param env - Worker environment with KV binding
 * @param accountType - 'admin', 'api_key', or 'temp_credential'
 * @param scope - Space-separated scope string (e.g., "admin create_rooms join_room")
 * @param adminId - Optional admin ID (for admin sessions)
 * @returns The generated session token
 */
export async function createSession(
  env: { KV: KVNamespace },
  accountType: string,
  scope: string,
  adminId?: string
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '');

  const sessionData: SessionData & { created_at: string } = {
    account_type: accountType,
    scope,
    created_at: new Date().toISOString(),
  };

  if (adminId) {
    sessionData.admin_id = adminId;
  }

  const ttl = SESSION_TTL[accountType] || SESSION_TTL.temp_credential;

  await env.KV.put(`session:${token}`, JSON.stringify(sessionData), {
    expirationTtl: ttl,
  });

  return token;
}

/**
 * Validate a session token and return session data if valid.
 * Returns null if token is invalid or expired (KV returns null).
 *
 * @param env - Worker environment with KV binding
 * @param token - Session token to validate
 * @returns SessionData or null
 */
export async function validateSession(
  env: { KV: KVNamespace },
  token: string
): Promise<(SessionData & { created_at: string }) | null> {
  if (!token) return null;

  const raw = await env.KV.get(`session:${token}`);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as SessionData & { created_at: string };
    // Basic validation: ensure required fields exist
    if (!data.account_type || !data.scope) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Destroy a session (logout).
 *
 * @param env - Worker environment with KV binding
 * @param token - Session token to destroy
 */
export async function destroySession(
  env: { KV: KVNamespace },
  token: string
): Promise<void> {
  await env.KV.delete(`session:${token}`);
}

/**
 * Check if a session has a required scope.
 * Scopes are stored as space-separated strings.
 *
 * @param session - Session data from validateSession()
 * @param requiredScope - Required scope string (e.g., "admin")
 * @returns true if the session has the required scope
 */
export function hasScope(
  session: SessionData,
  requiredScope: string
): boolean {
  const scopes = session.scope.split(' ');
  return scopes.includes(requiredScope);
}
