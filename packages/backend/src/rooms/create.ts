/**
 * Room creation handler.
 *
 * POST /api/rooms
 * Accepts { key_hash, room_code? }
 *
 * - If room_code provided: check D1 for uniqueness, if taken return 409 with suggestions
 * - If no room_code: generate random 4-digit code, retry if conflict (max 10 attempts)
 * - Insert into rooms table, create usage_stats row
 * - Returns { id, room_code }
 *
 * The CLIENT generates the full share_string from room_code + key prefix.
 * The server does NOT generate the share_string — it only stores the key_hash.
 *
 * @module rooms/create
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import { generateId, generateRoomCode } from '../utils/id';

// hex string, 64 chars for SHA-256
const createRoomSchema = z.object({
  key_hash: z.string().min(64).max(128).regex(/^[a-f0-9]+$/i, 'Must be a hex string'),
  room_code: z.string().length(4).regex(/^[0-9]{4}$/, 'Must be 4-digit code').optional(),
});

export async function handleCreateRoom(
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

  const parsed = createRoomSchema.safeParse(body);
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

  const { key_hash, room_code } = parsed.data;
  const now = new Date().toISOString();

  // Get session for admin_id
  const session = c.get('session');
  const adminId = session?.admin_id || null;

  // If room_code provided, check uniqueness
  if (room_code) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM rooms WHERE room_code = ? AND deleted_at IS NULL'
    ).bind(room_code).first();

    if (existing) {
      // Generate suggestions (current code +1, +2)
      const codeNum = parseInt(room_code, 10);
      const suggestions = [
        ((codeNum + 1) % 10000).toString().padStart(4, '0'),
        ((codeNum + 2) % 10000).toString().padStart(4, '0'),
      ];

      return c.json(
        {
          success: false,
          error: `Room code ${room_code} is already taken`,
          code: 'ROOM_CODE_TAKEN',
          suggestions,
        },
        400
      );
    }
  }

  // If no room_code provided, generate and retry on conflict
  let finalCode = room_code || '';
  if (!room_code) {
    const MAX_ATTEMPTS = 10;
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      finalCode = generateRoomCode();
      attempts++;

      const existing = await c.env.DB.prepare(
        'SELECT id FROM rooms WHERE room_code = ? AND deleted_at IS NULL'
      ).bind(finalCode).first();

      if (!existing) break;

      if (attempts >= MAX_ATTEMPTS) {
        return c.json(
          {
            success: false,
            error: 'Unable to generate a unique room code. Please try again or specify a code.',
            code: 'ROOM_CODE_CONFLICT',
          },
          409
        );
      }
    }
  }

  // Insert room
  const roomId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO rooms (id, room_code, key_hash, admin_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(roomId, finalCode, key_hash, adminId, now).run();

  // Create usage_stats row
  const statsId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO usage_stats (id, room_id, total_bytes, file_count, updated_at)
     VALUES (?, ?, 0, 0, ?)`
  ).bind(statsId, roomId, now).run();

  return c.json(
    {
      success: true,
      data: {
        id: roomId,
        room_code: finalCode,
        created_at: now,
      },
    },
    201
  );
}
