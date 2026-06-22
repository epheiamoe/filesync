/**
 * Admin password change endpoint.
 *
 * PUT /api/admin/password  — Change admin password (requires current password)
 *
 * Security changes:
 *   - New passwords are stored with PBKDF2-SHA256 (600k iterations).
 *   - Successful changes are written to the audit log.
 *
 * @module admin/password
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { hashPassword, verifyPassword } from '../crypto/hash';
import { SCOPES } from '../auth/scopes';
import { hasScope } from '../auth/session';
import { getClientIP } from '../auth/rate-limit';
import { logAudit } from '../audit/logger';

const passwordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function handleChangePassword(c: Context<AppContext>): Promise<Response> {
  const session = c.get('session');
  if (!session || !hasScope(session, SCOPES.ADMIN)) {
    return c.json({ success: false, error: 'Admin access required', code: 'FORBIDDEN' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, 400);
  }

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      success: false,
      error: parsed.error.issues.map(i => i.message).join('; '),
      code: 'VALIDATION_ERROR',
    }, 400);
  }

  const { current_password, new_password } = parsed.data;

  // Get current admin from D1
  const admin = await c.env.DB.prepare(
    'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?'
  ).bind('admin').first<{ id: string; username: string; password_hash: string }>();
  if (!admin) {
    return c.json({ success: false, error: 'Admin account not found', code: 'INTERNAL_ERROR' }, 500);
  }

  // Verify current password (supports legacy hashes)
  const valid = await verifyPassword(current_password, admin.password_hash);
  if (!valid) {
    return c.json({ success: false, error: 'Current password is incorrect', code: 'UNAUTHORIZED' }, 401);
  }

  // Hash new password with PBKDF2-SHA256
  const newHash = await hashPassword(new_password);

  // Update in D1
  await c.env.DB.prepare(
    'UPDATE admin_accounts SET password_hash = ? WHERE id = ?'
  ).bind(newHash, admin.id).run();

  const ip = getClientIP(c);
  const userAgent = c.req.header('User-Agent') ?? undefined;
  await logAudit(c.env, {
    action: 'password_changed',
    actor_type: 'admin',
    actor_id: session.admin_id ?? admin.username,
    target_type: 'admin_account',
    target_id: admin.id,
    ip,
    user_agent: userAgent,
    details: { username: admin.username },
  });

  return c.json({ success: true, data: { success: true } });
}
