/**
 * Room listing handlers.
 *
 * GET /api/rooms        → List rooms joined by current session
 * GET /api/rooms/:code  → Get room info including member count
 *
 * Supports client_fingerprint query parameter for cross-session
 * room membership tracking (Fix #3).
 *
 * @module rooms/list
 */

import type { Context } from 'hono';
import type { AppContext } from '../types';

/**
 * GET /api/rooms
 * List rooms the current session has joined.
 * If admin session, also include rooms they created.
 * Supports `client_fingerprint` query param for persistent client identification.
 */
export async function handleListRooms(
  c: Context<AppContext>
): Promise<Response> {
  const sessionToken = c.get('sessionToken') || '';
  const session = c.get('session');

  // Read optional client_fingerprint from query string
  const clientFingerprint = c.req.query('client_fingerprint') || '';

  let rooms: Array<Record<string, unknown>>;

  if (session?.account_type === 'admin' && session?.admin_id) {
    // Admin: list rooms they created
    const result = await c.env.DB.prepare(
      `SELECT r.id, r.room_code, r.created_at,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
       FROM rooms r
       WHERE r.admin_id = ? AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    ).bind(session.admin_id).all();
    rooms = result.results || [];
  } else if (clientFingerprint) {
    // Try dual lookup: first by client_fingerprint, then by session_id (union)
    // This ensures rooms are found regardless of whether the fingerprint column exists yet
    try {
      const result = await c.env.DB.prepare(
        `SELECT r.id, r.room_code, r.created_at,
                (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
         FROM rooms r
         INNER JOIN room_members rm ON rm.room_id = r.id
         WHERE rm.client_fingerprint = ? AND r.deleted_at IS NULL
         ORDER BY r.created_at DESC`
      ).bind(clientFingerprint).all();

      if (result.results && result.results.length > 0) {
        rooms = result.results;
      } else {
        // Fallback to session_id lookup (backward compat)
        const fallback = await c.env.DB.prepare(
          `SELECT r.id, r.room_code, r.created_at,
                  (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
           FROM rooms r
           INNER JOIN room_members rm ON rm.room_id = r.id
           WHERE rm.session_id = ? AND r.deleted_at IS NULL
           ORDER BY r.created_at DESC`
        ).bind(sessionToken).all();
        rooms = fallback.results || [];
      }
    } catch {
      // If client_fingerprint column doesn't exist, fall back to session_id
      const fallback = await c.env.DB.prepare(
        `SELECT r.id, r.room_code, r.created_at,
                (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
         FROM rooms r
         INNER JOIN room_members rm ON rm.room_id = r.id
         WHERE rm.session_id = ? AND r.deleted_at IS NULL
         ORDER BY r.created_at DESC`
      ).bind(sessionToken).all();
      rooms = fallback.results || [];
    }
  } else {
    // Regular session: list joined rooms by session_id (legacy behavior)
    const result = await c.env.DB.prepare(
      `SELECT r.id, r.room_code, r.created_at,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
       FROM rooms r
       INNER JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.session_id = ? AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    ).bind(sessionToken).all();
    rooms = result.results || [];
  }

  return c.json(
    {
      success: true,
      data: {
        rooms: rooms.map((r) => ({
          id: r.id,
          room_code: r.room_code,
          member_count: r.member_count,
          created_at: r.created_at,
        })),
      },
    },
    200
  );
}

/**
 * GET /api/rooms/:code
 * Get room info including member count.
 * Used for pre-join room preview.
 */
export async function handleGetRoom(
  c: Context<AppContext>
): Promise<Response> {
  const roomCode = c.req.param('code');

  if (!roomCode || !/^[0-9]{4}$/.test(roomCode)) {
    return c.json(
      { success: false, error: 'Invalid room code format (4 digits required)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const room = await c.env.DB.prepare(
    `SELECT r.id, r.room_code, r.created_at, r.deleted_at,
            (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
     FROM rooms r
     WHERE r.room_code = ?`
  ).bind(roomCode).first<{
    id: string;
    room_code: string;
    created_at: string;
    deleted_at: string | null;
    member_count: number;
  }>();

  if (!room || room.deleted_at) {
    return c.json(
      { success: false, error: 'Room not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Check if current session is a member
  const sessionToken = c.get('sessionToken') || '';
  const isMember = await c.env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room.id, sessionToken).first();

  return c.json(
    {
      success: true,
      data: {
        id: room.id,
        room_code: room.room_code,
        member_count: room.member_count,
        created_at: room.created_at,
        is_member: !!isMember,
      },
    },
    200
  );
}
