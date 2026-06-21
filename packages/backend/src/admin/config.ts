/**
 * Admin configuration management endpoints.
 *
 * GET  /api/admin/config/:key  — Read a config value from KV
 * PUT  /api/admin/config/:key  — Write a config value to KV
 *
 * Config keys are stored in KV with prefix "config:".
 * Currently supported keys:
 *   - roomTtlHours: Room auto-destroy TTL in hours (1-720, default 24)
 *
 * All endpoints require admin scope.
 *
 * @module admin/config
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { hasScope } from '../auth/session';
import type { SessionData } from '@filesync/shared';

// ---- Helper: require admin scope ----

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

// ---- Validation ----

const configValueSchema = z.object({
  value: z.string().min(0).max(1000),
});

// ---- GET /api/admin/config/:key ----

export async function handleGetConfig(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const key = c.req.param('key');
  if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) {
    return c.json(
      { success: false, error: 'Invalid config key', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const kvKey = `config:${key}`;
  const value = await c.env.KV.get(kvKey);

  return c.json({
    success: true,
    data: {
      key,
      value: value || null,
    },
  }, 200);
}

// ---- PUT /api/admin/config/:key ----

export async function handlePutConfig(
  c: Context<AppContext>
): Promise<Response> {
  const sessionOrError = requireAdmin(c);
  if (sessionOrError instanceof Response) return sessionOrError;

  const key = c.req.param('key');
  if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) {
    return c.json(
      { success: false, error: 'Invalid config key', code: 'VALIDATION_ERROR' },
      400
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const parsed = configValueSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: parsed.error.errors.map((e) => e.message).join('; '),
        code: 'VALIDATION_ERROR',
      },
      400
    );
  }

  const { value } = parsed.data;
  const kvKey = `config:${key}`;

  await c.env.KV.put(kvKey, value);

  return c.json({
    success: true,
    data: {
      key,
      value,
    },
  }, 200);
}
