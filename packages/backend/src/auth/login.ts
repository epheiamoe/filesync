/**
 * Login handler — supports 3 authentication methods:
 *   1. Admin:       username + password (verified against D1 admin_accounts)
 *   2. API Key:     api_key (looked up in KV, checked for expiry/revocation)
 *   3. Temp Credential: temp_code (looked up in KV, consumed on first use)
 *
 * POST /api/auth/login
 *
 * @module auth/login
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { verifyPassword } from '../crypto/hash';
import { createSession } from './session';
import { sha256 } from '../crypto/hash';

// Validation schemas
const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const apiKeyLoginSchema = z.object({
  api_key: z.string().min(32).max(64),
});

const tempCodeLoginSchema = z.object({
  temp_code: z.string().min(4).max(10),
});

/**
 * Main login handler.
 * Detects login method from request body fields.
 */
export async function handleLogin(c: Context<AppContext>): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  if (!body || typeof body !== 'object') {
    return c.json(
      { success: false, error: 'Request body required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const b = body as Record<string, unknown>;

  // Detect login method from request fields
  if (b.username !== undefined) {
    return handleAdminLogin(c, b);
  }
  if (b.api_key !== undefined) {
    return handleApiKeyLogin(c, b);
  }
  if (b.temp_code !== undefined) {
    return handleTempCodeLogin(c, b);
  }

  return c.json(
    {
      success: false,
      error: 'No valid credentials provided. Use username+password, api_key, or temp_code.',
      code: 'VALIDATION_ERROR',
    },
    400
  );
}

/**
 * Admin login: verify username + password against D1.
 */
async function handleAdminLogin(
  c: Context<AppContext>,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: 'Username and password required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const { username, password } = parsed.data;

  // Query admin account from D1
  const stmt = c.env.DB.prepare(
    'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?'
  ).bind(username);

  const result = await stmt.first<{
    id: string;
    username: string;
    password_hash: string;
  }>();

  if (!result) {
    return c.json(
      { success: false, error: 'Invalid username or password', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Verify password
  const valid = await verifyPassword(password, result.password_hash);
  if (!valid) {
    return c.json(
      { success: false, error: 'Invalid username or password', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Create session with admin scope
  const scope = 'admin create_rooms join_room';
  const token = await createSession(c.env, 'admin', scope, result.id);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Set HttpOnly cookie for session persistence across refreshes
  c.header('Set-Cookie', `epheia_session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=604800`);

  return c.json(
    {
      success: true,
      data: {
        token,
        scope,
        account_type: 'admin',
        expires_at: expiresAt,
      },
    },
    200
  );
}

/**
 * API Key login: lookup key in KV, verify not expired/revoked.
 */
async function handleApiKeyLogin(
  c: Context<AppContext>,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = apiKeyLoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: 'Valid API key required (32-64 hex chars)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const { api_key } = parsed.data;
  const keyHash = await sha256(api_key);

  // Look up in KV: key = "apikey:{key_hash}"
  const raw = await c.env.KV.get(`apikey:${keyHash}`);
  if (!raw) {
    return c.json(
      { success: false, error: 'Invalid API key', code: 'UNAUTHORIZED' },
      401
    );
  }

  let keyData: { scope: string; created_by: string; created_at: string; expires_at?: string; revoked_at?: string };
  try {
    keyData = JSON.parse(raw);
  } catch {
    return c.json(
      { success: false, error: 'Invalid API key data', code: 'INTERNAL_ERROR' },
      500
    );
  }

  // Check if revoked
  if (keyData.revoked_at) {
    return c.json(
      { success: false, error: 'API key has been revoked', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Check if expired
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    return c.json(
      { success: false, error: 'API key has expired', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Create session
  const scope = keyData.scope || 'create_rooms join_room';
  const token = await createSession(c.env, 'api_key', scope);

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  c.header('Set-Cookie', `epheia_session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=2592000`);

  return c.json(
    {
      success: true,
      data: {
        token,
        scope,
        account_type: 'api_key',
        expires_at: expiresAt,
      },
    },
    200
  );
}

/**
 * Temp credential login: lookup code in KV, consume on use (one-time).
 */
async function handleTempCodeLogin(
  c: Context<AppContext>,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = tempCodeLoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: 'Valid temp code required (4-10 chars)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const { temp_code } = parsed.data;
  const codeHash = await sha256(temp_code.toUpperCase());

  // Look up in KV: key = "tempcred:{code_hash}"
  const raw = await c.env.KV.get(`tempcred:${codeHash}`);
  if (!raw) {
    return c.json(
      { success: false, error: 'Invalid or expired temporary credential', code: 'UNAUTHORIZED' },
      401
    );
  }

  let credData: { scope: string; created_by: string; expires_at: string };
  try {
    credData = JSON.parse(raw);
  } catch {
    return c.json(
      { success: false, error: 'Invalid credential data', code: 'INTERNAL_ERROR' },
      500
    );
  }

  // Check expiry
  if (new Date(credData.expires_at) < new Date()) {
    // Delete expired credential
    await c.env.KV.delete(`tempcred:${codeHash}`);
    return c.json(
      { success: false, error: 'Credential has expired', code: 'UNAUTHORIZED' },
      401
    );
  }

  // One-time use: delete from KV immediately
  await c.env.KV.delete(`tempcred:${codeHash}`);

  // Mark as used in credential_audit
  try {
    await c.env.DB.prepare(
      `UPDATE credential_audit SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`
    ).bind(new Date().toISOString(), codeHash).run();
  } catch {
    // Non-critical: audit update failure shouldn't block login
  }

  const scope = credData.scope || 'join_room';
  const token = await createSession(c.env, 'temp_credential', scope);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  c.header('Set-Cookie', `epheia_session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400`);

  return c.json(
    {
      success: true,
      data: {
        token,
        scope,
        account_type: 'temp_credential',
        expires_at: expiresAt,
      },
    },
    200
  );
}
