/**
 * Credentials management — admin-only endpoints.
 *
 * POST   /api/auth/credentials    → Create temp credential (8-char Crockford base32)
 * GET    /api/auth/credentials    → List all credentials
 * DELETE /api/auth/credentials/:id → Revoke a credential
 * POST   /api/auth/api-keys       → Create API key (32-char hex)
 * DELETE /api/auth/api-keys/:keyHash → Revoke API key
 *
 * All endpoints require admin scope.
 *
 * Security changes:
 *   - Scope strings centralized in `./scopes`
 *   - Audit logging for credential creation and revocation
 *
 * @module auth/credentials
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { generateTempCode, generateApiKey, generateId } from '../utils/id';
import { sha256 } from '../crypto/hash';
import { hasScope } from './session';
import { SCOPES, API_KEY_SCOPE, TEMP_CREDENTIAL_SCOPE } from './scopes';
import { getClientIP } from './rate-limit';
import { logAudit } from '../audit/logger';
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
  if (!hasScope(session, SCOPES.ADMIN)) {
    return c.json(
      { success: false, error: 'Admin access required', code: 'FORBIDDEN' },
      403
    );
  }
  return session;
}

function auditActorId(session: SessionData): string {
  return session.admin_id ?? 'admin';
}

// ---- GET /api/auth/api-keys ----
export async function handleListApiKeys(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const result = await c.env.DB.prepare(
    `SELECT id, type, label, api_key_prefix, code_hash, created_by, used_at, expires_at, revoked_at, created_at
     FROM credential_audit
     WHERE type = 'api_key'
     ORDER BY created_at DESC
     LIMIT 100`
  ).all();

  const apiKeys = (result.results || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    label: (row.label as string) ?? '',
    api_key_prefix: (row.api_key_prefix as string) ?? '',
    key_hash: (row.code_hash as string) ?? '',
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    revoked_at: row.revoked_at ? (row.revoked_at as string) : null,
  }));

  return c.json(
    {
      success: true,
      data: { api_keys: apiKeys },
    },
    200
  );
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
    scope: TEMP_CREDENTIAL_SCOPE,
    created_by: 'admin',
    expires_at: expiresAt,
  };
  await c.env.KV.put(`tempcred:${codeHash}`, JSON.stringify(credData), {
    expirationTtl: expires_in_seconds,
  });

  // Audit log in D1
  const auditId = generateId();
  let auditRowId: string | null = null;
  try {
    await c.env.DB.prepare(
      `INSERT INTO credential_audit (id, type, code_hash, created_by, expires_at, created_at)
       VALUES (?, 'temp_credential', ?, ?, ?, ?)`
    ).bind(auditId, codeHash, 'admin', expiresAt, now.toISOString()).run();
    auditRowId = auditId;
  } catch (err) {
    // [Debt: structured logging] Log but don't fail — credential is already in KV.
    console.error('Failed to insert credential audit:', err);
  }

  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  await logAudit(c.env, {
    action: 'credential_created',
    actor_type: 'admin',
    actor_id: auditActorId(sessionOrError),
    target_type: 'temp_credential',
    target_id: codeHash,
    ip,
    user_agent: userAgent,
    details: { audit_id: auditRowId, label: parsed.data.label, expires_at: expiresAt },
  });

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
/**
 * List all credentials (temp and API keys).
 * Supports ?unused_only=true to filter to unused, non-expired temp credentials only.
 */
export async function handleListCredentials(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const unusedOnly = c.req.query('unused_only') === 'true';

  let query = `SELECT id, type, code_hash, api_key_prefix, created_by, used_at, expires_at, revoked_at, created_at
     FROM credential_audit
     WHERE type = 'temp_credential'`;

  if (unusedOnly) {
    query += ` AND used_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now')`;
  }

  query += ` ORDER BY created_at DESC LIMIT 100`;

  const result = await c.env.DB.prepare(query).all();

  // Mask sensitive fields for display
  const credentials = (result.results || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    type: row.type,
    code_prefix: row.type === 'temp_credential' && row.code_hash
      ? `${(row.code_hash as string).slice(0, 8)}...`
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

  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  await logAudit(c.env, {
    action: 'credential_revoked',
    actor_type: 'admin',
    actor_id: auditActorId(sessionOrError),
    target_type: cred.type,
    target_id: cred.code_hash ?? id,
    ip,
    user_agent: userAgent,
    details: { audit_id: id, revoked_at: now },
  });

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

  // Audit log in D1
  const auditId = generateId();
  let auditRowId: string | null = null;

  // Store in KV (no TTL — persists until revoked)
  const keyData = {
    scope: API_KEY_SCOPE,
    created_by: 'admin',
    created_at: now,
    label: parsed.data.label,
    audit_id: auditId,
  };
  await c.env.KV.put(`apikey:${keyHash}`, JSON.stringify(keyData));

  // API keys don't expire by default
  const farFutureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO credential_audit (id, type, label, api_key_prefix, code_hash, created_by, expires_at, created_at)
       VALUES (?, 'api_key', ?, ?, ?, ?, ?, ?)`
    ).bind(auditId, parsed.data.label, apiKeyPrefix, keyHash, 'admin', farFutureExpiry, now).run();
    auditRowId = auditId;
  } catch (err) {
    // [Debt: structured logging]
    console.error('Failed to insert API key audit:', err);
  }

  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  await logAudit(c.env, {
    action: 'credential_created',
    actor_type: 'admin',
    actor_id: auditActorId(sessionOrError),
    target_type: 'api_key',
    target_id: keyHash,
    ip,
    user_agent: userAgent,
    details: { audit_id: auditRowId, label: parsed.data.label, prefix: apiKeyPrefix },
  });

  return c.json(
    {
      success: true,
      data: {
        key: apiKey,
        label: parsed.data.label,
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

  const now = new Date().toISOString();
  let affectedRows = 0;

  // Delete from KV
  const raw = await c.env.KV.get(`apikey:${keyHashParam}`);
  await c.env.KV.delete(`apikey:${keyHashParam}`);

  // Find and mark as revoked in D1
  try {
    let keyData: { audit_id?: string } | null = null;
    if (raw) {
      try {
        keyData = JSON.parse(raw) as { audit_id?: string };
      } catch {
        // malformed KV data, fall through to fallback matching
      }
    }

    if (keyData?.audit_id) {
      const result = await c.env.DB.prepare(
        `UPDATE credential_audit SET revoked_at = ?
         WHERE id = ? AND type = 'api_key'`
      ).bind(now, keyData.audit_id).run();
      affectedRows = (result as any).meta?.changes ?? 0;
    } else {
      // Fallback for legacy KV entries created before audit_id was stored:
      // match by code_hash, which for api_key records stores the key SHA-256 hash.
      const result = await c.env.DB.prepare(
        `UPDATE credential_audit SET revoked_at = ?
         WHERE type = 'api_key' AND code_hash = ? AND revoked_at IS NULL`
      ).bind(now, keyHashParam).run();
      affectedRows = (result as any).meta?.changes ?? 0;
    }
  } catch (err) {
    // [Debt: structured logging]
    console.error('Failed to update API key revocation in audit:', err);
  }

  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  await logAudit(c.env, {
    action: 'credential_revoked',
    actor_type: 'admin',
    actor_id: auditActorId(sessionOrError),
    target_type: 'api_key',
    target_id: keyHashParam,
    ip,
    user_agent: userAgent,
    details: { revoked_at: now, audit_rows_affected: affectedRows },
  });

  return c.json({ success: true }, 200);
}
