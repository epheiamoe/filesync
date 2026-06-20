/**
 * Admin password change endpoint.
 *
 * PUT /api/admin/password  — Change admin password (requires current password)
 *
 * @module admin/password
 */

import { z } from 'zod';
import type { AppContext } from '../types';
import { hashPassword, verifyPassword } from '../crypto/hash';

const passwordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function handleChangePassword(c: AppContext): Promise<Response> {
  const session = c.get('session');
  if (!session || !session.scope?.includes('admin')) {
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
    'SELECT id, password_hash FROM admin_accounts WHERE username = ?'
  ).bind('admin').first<{ id: string; password_hash: string }>();
  if (!admin) {
    return c.json({ success: false, error: 'Admin account not found', code: 'INTERNAL_ERROR' }, 500);
  }

  // Verify current password
  const valid = await verifyPassword(current_password, admin.password_hash);
  if (!valid) {
    return c.json({ success: false, error: 'Current password is incorrect', code: 'UNAUTHORIZED' }, 401);
  }

  // Generate new salt and hash
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const newHash = await hashPassword(new_password, salt);

  // Update in D1
  await c.env.DB.prepare(
    'UPDATE admin_accounts SET password_hash = ? WHERE id = ?'
  ).bind(newHash, admin.id).run();

  return c.json({ success: true, data: { success: true } });
}
