/**
 * Room join handler.
 *
 * POST /api/rooms/join
 * Accepts { room_code, key_hash, device_label?, client_fingerprint? }
 *
 * - Look up room by code → verify not deleted
 * - Verify key_hash matches stored hash
 * - Add member to room_members (with optional client_fingerprint)
 * - Parse device_label from User-Agent if not provided
 * - Update room last_active_at
 *
 * @module rooms/join
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { generateId } from '../utils/id';
import { updateRoomActivity } from './activity';

const joinRoomSchema = z.object({
  room_code: z.string().length(4).regex(/^[0-9]{4}$/, 'Must be 4-digit code'),
  key_hash: z.string().min(64).max(128).regex(/^[a-f0-9]+$/i, 'Must be a hex string'),
  device_label: z.string().max(100).optional(),
  client_fingerprint: z.string().min(1).max(64).optional(), // Persistent client ID for cross-session tracking
});

/**
 * Parse a device label from a User-Agent string.
 * Produces labels like "Windows Chrome", "iPhone Safari", etc.
 */
function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown';

  let os = 'Unknown';
  let browser = 'Unknown';

  // OS detection
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac OS') || userAgent.includes('Macintosh')) os = 'Mac';
  else if (userAgent.includes('Linux') && !userAgent.includes('Android')) os = 'Linux';
  else if (userAgent.includes('iPhone')) os = 'iPhone';
  else if (userAgent.includes('iPad')) os = 'iPad';
  else if (userAgent.includes('Android')) os = 'Android';

  // Browser detection (order matters — Chrome includes Safari string)
  if (userAgent.includes('Edg/')) browser = 'Edge';
  else if (userAgent.includes('Chrome/')) browser = 'Chrome';
  else if (userAgent.includes('Firefox/')) browser = 'Firefox';
  else if (userAgent.includes('Safari/')) browser = 'Safari';

  return `${os} ${browser}`;
}

export async function handleJoinRoom(
  c: Context<AppContext>
): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const parsed = joinRoomSchema.safeParse(body);
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

  const { room_code, key_hash, device_label, client_fingerprint } = parsed.data;
  const now = new Date().toISOString();

  // Look up room by code
  const room = await c.env.DB.prepare(
    'SELECT id, room_code, key_hash, deleted_at FROM rooms WHERE room_code = ?'
  ).bind(room_code).first<{
    id: string;
    room_code: string;
    key_hash: string;
    deleted_at: string | null;
  }>();

  if (!room) {
    return c.json(
      { success: false, error: 'Room not found', code: 'NOT_FOUND' },
      404
    );
  }

  if (room.deleted_at) {
    return c.json(
      { success: false, error: 'Room has been destroyed', code: 'NOT_FOUND' },
      404
    );
  }

  // Verify key_hash
  if (room.key_hash !== key_hash) {
    return c.json(
      { success: false, error: 'Room key does not match', code: 'KEY_MISMATCH' },
      403
    );
  }

  // Get session for session_id
  const sessionToken = c.get('sessionToken') || 'anonymous';

  // Determine device label
  const userAgent = c.req.header('User-Agent') || null;
  const finalDeviceLabel = device_label || parseDeviceLabel(userAgent);

  // Check if this session is already a member (idempotent join)
  const existing = await c.env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room.id, sessionToken).first();

  if (existing) {
    // Update client_fingerprint if provided and not already set
    if (client_fingerprint) {
      try {
        await c.env.DB.prepare(
          `UPDATE room_members SET client_fingerprint = ? WHERE room_id = ? AND session_id = ? AND client_fingerprint IS NULL`
        ).bind(client_fingerprint, room.id, sessionToken).run();
      } catch {
        // Best effort — missing column is OK
      }
    }

    // Update room activity even for re-join
    try { await updateRoomActivity(c.env.DB, room.id); } catch { /* best-effort */ }

    return c.json(
      {
        success: true,
        data: {
          success: true,
          room_id: room.id,
        },
      },
      200
    );
  }

  // Add member
  const memberId = generateId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO room_members (id, room_id, session_id, device_label, client_fingerprint, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(memberId, room.id, sessionToken, finalDeviceLabel,
           client_fingerprint || null, now).run();
  } catch {
    // Fallback: if client_fingerprint column doesn't exist yet, insert without it
    await c.env.DB.prepare(
      `INSERT INTO room_members (id, room_id, session_id, device_label, joined_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(memberId, room.id, sessionToken, finalDeviceLabel, now).run();
  }

  // Update room last_active_at
  try { await updateRoomActivity(c.env.DB, room.id); } catch { /* best-effort */ }

  return c.json(
    {
      success: true,
      data: {
        success: true,
        room_id: room.id,
      },
    },
    200
  );
}
