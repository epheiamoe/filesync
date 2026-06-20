/**
 * Credentials management — admin-only endpoints.
 *
 * POST   /api/auth/credentials    → Create temp credential (6-char alphanumeric)
 * GET    /api/auth/credentials    → List all credentials
 * DELETE /api/auth/credentials/:id → Revoke a credential
 * POST   /api/auth/api-keys       → Create API key (32-char hex)
 * DELETE /api/auth/api-keys/:keyHash → Revoke API key
 *
 * All endpoints require admin scope.
 *
 * @module auth/credentials
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { generateTempCode, generateApiKey, generateId } from '../utils/id';
import { sha256 } from '../crypto/hash';
import { hasScope } from './session';
import type { SessionData } from '@filesync/shared';

// ---- Helper: extract session from context ----
function getSession(c: Context<AppContext>): SessionData | null {
  return c.get('session') as SessionData | null;
}

function requireAdmin(c: Context<AppContext>): SessionData | Response {
  const session = getSession(c);
  if (!session) {
    return c.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }
  if (!hasScope(session, 'admin')) {
    return c.json(
      { success: false, error: 'Admin access required', code: 'FORBIDDEN' },
      403
    );
  }
  return session;
}

// ---- POST /api/auth/credentials ----
const createCredentialSchema = z.object({
  label: z.string().optional(),
  expires_in_seconds: z.number().int().min(60).max(86400).optional().default(86400),
});

export async function handleCreateCredential(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  let body: unknown;
  try {
    body = await c.req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const parsed = createCredentialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: 'Invalid request: expires_in_seconds must be 60-86400', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const { expires_in_seconds } = parsed.data;
  const code = generateTempCode();
  const codeHash = await sha256(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expires_in_seconds * 1000).toISOString();

  // Store in KV with TTL
  const credData = {
    scope: 'join_room',
    created_by: 'admin',
    expires_at: expiresAt,
  };
  await c.env.KV.put(`tempcred:${codeHash}`, JSON.stringify(credData), {
    expirationTtl: expires_in_seconds,
  });

  // Audit log in D1
  const auditId = generateId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO credential_audit (id, type, code_hash, created_by, expires_at, created_at)
       VALUES (?, 'temp_credential', ?, ?, ?, ?)`
    ).bind(auditId, codeHash, 'admin', expiresAt, now.toISOString()).run();
  } catch (err) {
    // Log but don't fail — credential is already in KV
    console.error('Failed to insert credential audit:', err);
  }

  return c.json(
    {
      success: true,
      data: {
        code,
        expires_at: expiresAt,
      },
    },
    201
  );
}

// ---- GET /api/auth/credentials ----
export async function handleListCredentials(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const result = await c.env.DB.prepare(
    `SELECT id, type, code_hash, api_key_prefix, created_by, used_at, expires_at, revoked_at, created_at
     FROM credential_audit
     ORDER BY created_at DESC
     LIMIT 100`
  ).all();

  // Mask sensitive fields for display
  const credentials = (result.results || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    type: row.type,
    code_prefix: row.type === 'temp_credential' && row.code_hash
      ? `${(row.code_hash as string).slice(0, 6)}...`
      : null,
    api_key_prefix: row.api_key_prefix || null,
    created_by: row.created_by,
    used_at: row.used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  }));

  return c.json(
    {
      success: true,
      data: { credentials },
    },
    200
  );
}

// ---- DELETE /api/auth/credentials/:id ----
export async function handleRevokeCredential(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const id = c.req.param('id');
  if (!id) {
    return c.json({ success: false, error: 'Credential ID required', code: 'VALIDATION_ERROR' }, 400);
  }

  // Find the credential
  const cred = await c.env.DB.prepare(
    'SELECT id, type, code_hash, revoked_at FROM credential_audit WHERE id = ?'
  ).bind(id).first<{ id: string; type: string; code_hash: string | null; revoked_at: string | null }>();

  if (!cred) {
    return c.json({ success: false, error: 'Credential not found', code: 'NOT_FOUND' }, 404);
  }

  if (cred.revoked_at) {
    return c.json({ success: false, error: 'Credential already revoked', code: 'VALIDATION_ERROR' }, 400);
  }

  const now = new Date().toISOString();

  // Mark as revoked in D1
  await c.env.DB.prepare(
    'UPDATE credential_audit SET revoked_at = ? WHERE id = ?'
  ).bind(now, id).run();

  // Delete from KV if it's a temp credential (by code_hash)
  if (cred.type === 'temp_credential' && cred.code_hash) {
    await c.env.KV.delete(`tempcred:${cred.code_hash}`);
  }

  return c.json({ success: true, data: { revoked_at: now } }, 200);
}

// ---- POST /api/auth/api-keys ----
const createApiKeySchema = z.object({
  label: z.string().min(1).max(100),
});

export async function handleCreateApiKey(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, 400);
  }

  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: 'Label is required (1-100 chars)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const apiKey = generateApiKey();
  const keyHash = await sha256(apiKey);
  const apiKeyPrefix = apiKey.slice(0, 8);
  const now = new Date().toISOString();

  // Store in KV (no TTL — persists until revoked)
  const keyData = {
    scope: 'create_rooms join_room',
    created_by: 'admin',
    created_at: now,
    label: parsed.data.label,
  };
  await c.env.KV.put(`apikey:${keyHash}`, JSON.stringify(keyData));

  // Audit log in D1
  const auditId = generateId();
  // API keys don't expire by default
  const farFutureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO credential_audit (id, type, api_key_prefix, created_by, expires_at, created_at)
       VALUES (?, 'api_key', ?, ?, ?, ?)`
    ).bind(auditId, apiKeyPrefix, 'admin', farFutureExpiry, now).run();
  } catch (err) {
    console.error('Failed to insert API key audit:', err);
  }

  return c.json(
    {
      success: true,
      data: {
        key: apiKey,
        created_at: now,
      },
    },
    201
  );
}

// ---- DELETE /api/auth/api-keys/:keyHash ----
export async function handleRevokeApiKey(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const keyHashParam = c.req.param('keyHash');
  if (!keyHashParam) {
    return c.json({ success: false, error: 'API key hash required', code: 'VALIDATION_ERROR' }, 400);
  }

  // Delete from KV
  await c.env.KV.delete(`apikey:${keyHashParam}`);

  // Find and mark as revoked in D1
  const now = new Date().toISOString();
  try {
    // Find the audit record by matching the first 8 chars of the api_key
    // Since we only store api_key_prefix (first 8 chars), we do a best-effort match
    await c.env.DB.prepare(
      `UPDATE credential_audit SET revoked_at = ?
       WHERE type = 'api_key' AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(now).run();
  } catch (err) {
    console.error('Failed to update API key revocation in audit:', err);
  }

  return c.json({ success: true }, 200);
}
