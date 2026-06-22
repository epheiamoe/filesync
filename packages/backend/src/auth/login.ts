/**
 * Login handler — supports 3 authentication methods:
 *   1. Admin:       username + password (verified against D1 admin_accounts)
 *   2. API Key:     api_key (looked up in KV, checked for expiry/revocation)
 *   3. Temp Credential: temp_code (looked up in KV, consumed on first use)
 *
 * POST /api/auth/login
 *
 * Security additions:
 *   - Rate limiting via KV (IP + username dimensions)
 *   - PBKDF2 password hashes with automatic legacy-hash rehashing
 *   - Scope constants centralized in `./scopes`
 *   - Audit logging for login success/failure/rate-limit triggers
 *
 * @module auth/login
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { verifyPassword, hashPassword, needsRehash, sha256 } from '../crypto/hash';
import { createSession } from './session';
import { ADMIN_SCOPE, API_KEY_SCOPE, TEMP_CREDENTIAL_SCOPE } from './scopes';
import { checkRateLimit, recordFailedAttempt, clearRateLimit, getClientIP } from './rate-limit';
import { logAudit } from '../audit/logger';

// Validation schemas
const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const apiKeyLoginSchema = z.object({
  api_key: z.string().min(32).max(64),
});

const tempCodeLoginSchema = z.object({
  // 8 chars is the new default; 6-12 accepts legacy 6-char codes during transition.
  temp_code: z.string().min(6).max(12),
});

/**
 * Build a standardized rate-limit response.
 */
function rateLimitResponse(c: Context<AppContext>, retryAfter: number): Response {
  c.header('Retry-After', String(retryAfter));
  return c.json(
    {
      success: false,
      error: 'Too many failed attempts. Please try again later.',
      code: 'RATE_LIMITED',
      retry_after: retryAfter,
    },
    429
  );
}

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
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;

  // Rate-limit check before any expensive work
  const rateLimit = await checkRateLimit(c.env, ip, username);
  if (!rateLimit.allowed) {
    await logAudit(c.env, {
      action: 'login_rate_limited',
      actor_type: 'anonymous',
      actor_id: username,
      target_type: 'admin_account',
      target_id: username,
      ip,
      user_agent: userAgent,
      details: { method: 'admin', retry_after: rateLimit.retryAfter },
    });
    return rateLimitResponse(c, rateLimit.retryAfter);
  }

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
    await recordFailedAttempt(c.env, ip, username);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'anonymous',
      actor_id: username,
      target_type: 'admin_account',
      target_id: username,
      ip,
      user_agent: userAgent,
      details: { method: 'admin', reason: 'account_not_found' },
    });
    return c.json(
      { success: false, error: 'Invalid username or password', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Verify password (supports both PBKDF2 and legacy SHA-256 hashes)
  const valid = await verifyPassword(password, result.password_hash);
  if (!valid) {
    await recordFailedAttempt(c.env, ip, username);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'anonymous',
      actor_id: username,
      target_type: 'admin_account',
      target_id: result.id,
      ip,
      user_agent: userAgent,
      details: { method: 'admin', reason: 'invalid_password' },
    });
    return c.json(
      { success: false, error: 'Invalid username or password', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Successful login: clear rate-limit state and audit
  await clearRateLimit(c.env, ip, username);
  await logAudit(c.env, {
    action: 'login_success',
    actor_type: 'admin',
    actor_id: result.id,
    target_type: 'admin_account',
    target_id: result.id,
    ip,
    user_agent: userAgent,
    details: { method: 'admin' },
  });

  // Automatic hash upgrade for legacy passwords.
  // Runs asynchronously and must not block the login response.
  if (await needsRehash(result.password_hash)) {
    const rehashPromise = (async () => {
      const newHash = await hashPassword(password);
      await c.env.DB.prepare(
        'UPDATE admin_accounts SET password_hash = ? WHERE id = ?'
      ).bind(newHash, result.id).run();
    })().catch((err) => {
      // [Debt: structured logging] Rehash failure is non-blocking.
      console.error('[auth/login] failed to rehash legacy password:', err);
    });

    const executionCtx = (c as unknown as { executionCtx?: ExecutionContext }).executionCtx;
    if (executionCtx?.waitUntil) {
      executionCtx.waitUntil(rehashPromise);
    }
    // If waitUntil is unavailable (e.g. some test contexts), awaiting is safe
    // because the response is already prepared; we simply don't block on it.
  }

  // Create session with admin scope
  const scope = ADMIN_SCOPE;
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
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  const keyHash = await sha256(api_key);

  // Rate-limit by IP and key hash
  const rateLimit = await checkRateLimit(c.env, ip, keyHash);
  if (!rateLimit.allowed) {
    await logAudit(c.env, {
      action: 'login_rate_limited',
      actor_type: 'anonymous',
      target_type: 'api_key',
      target_id: keyHash,
      ip,
      user_agent: userAgent,
      details: { method: 'api_key', retry_after: rateLimit.retryAfter },
    });
    return rateLimitResponse(c, rateLimit.retryAfter);
  }

  // Look up in KV: key = "apikey:{key_hash}"
  const raw = await c.env.KV.get(`apikey:${keyHash}`);
  if (!raw) {
    await recordFailedAttempt(c.env, ip, keyHash);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'anonymous',
      target_type: 'api_key',
      target_id: keyHash,
      ip,
      user_agent: userAgent,
      details: { method: 'api_key', reason: 'key_not_found' },
    });
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
    await recordFailedAttempt(c.env, ip, keyHash);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'api_key',
      actor_id: keyHash,
      target_type: 'api_key',
      target_id: keyHash,
      ip,
      user_agent: userAgent,
      details: { method: 'api_key', reason: 'revoked' },
    });
    return c.json(
      { success: false, error: 'API key has been revoked', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Check if expired
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    await recordFailedAttempt(c.env, ip, keyHash);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'api_key',
      actor_id: keyHash,
      target_type: 'api_key',
      target_id: keyHash,
      ip,
      user_agent: userAgent,
      details: { method: 'api_key', reason: 'expired' },
    });
    return c.json(
      { success: false, error: 'API key has expired', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Successful login
  await clearRateLimit(c.env, ip, keyHash);
  await logAudit(c.env, {
    action: 'login_success',
    actor_type: 'api_key',
    actor_id: keyHash,
    target_type: 'api_key',
    target_id: keyHash,
    ip,
    user_agent: userAgent,
    details: { method: 'api_key' },
  });

  // Create session
  const scope = keyData.scope || API_KEY_SCOPE;
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
      { success: false, error: 'Valid temp code required (6-12 chars)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const { temp_code } = parsed.data;
  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  const codeHash = await sha256(temp_code.toUpperCase());

  // Rate-limit by IP and code hash
  const rateLimit = await checkRateLimit(c.env, ip, codeHash);
  if (!rateLimit.allowed) {
    await logAudit(c.env, {
      action: 'login_rate_limited',
      actor_type: 'anonymous',
      target_type: 'temp_credential',
      target_id: codeHash,
      ip,
      user_agent: userAgent,
      details: { method: 'temp_credential', retry_after: rateLimit.retryAfter },
    });
    return rateLimitResponse(c, rateLimit.retryAfter);
  }

  // Look up in KV: key = "tempcred:{code_hash}"
  const raw = await c.env.KV.get(`tempcred:${codeHash}`);
  if (!raw) {
    await recordFailedAttempt(c.env, ip, codeHash);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'anonymous',
      target_type: 'temp_credential',
      target_id: codeHash,
      ip,
      user_agent: userAgent,
      details: { method: 'temp_credential', reason: 'code_not_found' },
    });
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
    await recordFailedAttempt(c.env, ip, codeHash);
    await logAudit(c.env, {
      action: 'login_failed',
      actor_type: 'anonymous',
      target_type: 'temp_credential',
      target_id: codeHash,
      ip,
      user_agent: userAgent,
      details: { method: 'temp_credential', reason: 'expired' },
    });
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

  // Successful login
  await clearRateLimit(c.env, ip, codeHash);
  await logAudit(c.env, {
    action: 'login_success',
    actor_type: 'temp_credential',
    actor_id: codeHash,
    target_type: 'temp_credential',
    target_id: codeHash,
    ip,
    user_agent: userAgent,
    details: { method: 'temp_credential' },
  });

  const scope = credData.scope || TEMP_CREDENTIAL_SCOPE;
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
