/**
 * Admin room management — room destruction endpoint.
 *
 * DELETE /api/admin/rooms/:code  — Soft delete room + cascade delete all data
 *
 * Cascade delete includes:
 *   - All R2 files for the room
 *   - All messages in D1
 *   - All room members in D1
 *   - Usage stats in D1
 *   - Room itself (soft delete: sets deleted_at)
 *   - Notify connected clients via RoomDO broadcast (system message)
 *
 * This is a destructive operation that cannot be undone through the API.
 * Admin scope required.
 *
 * @module admin/rooms
 */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { DestroyRoomResponse, DestroyAllRoomsResponse } from '@epheia-files/shared';

/**
 * Destroy a room: cascade delete all associated data.
 *
 * DELETE /api/admin/rooms/:code
 */
export async function handleDestroyRoom(c: Context<AppContext>): Promise<Response> {
  const roomCode = c.req.param('code');

  if (!roomCode || !/^[0-9]{4}$/.test(roomCode)) {
    return c.json(
      { success: false, error: 'Invalid room code format (4 digits required)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Require admin scope
  const session = c.get('session');
  if (!session || session.account_type !== 'admin') {
    return c.json(
      { success: false, error: 'Admin access required', code: 'FORBIDDEN' },
      403
    );
  }

  const now = new Date().toISOString();

  // Look up the room
  const room = await c.env.DB.prepare(
    'SELECT id, room_code, deleted_at FROM rooms WHERE room_code = ?'
  ).bind(roomCode).first<{
    id: string;
    room_code: string;
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
      { success: false, error: 'Room has already been destroyed', code: 'NOT_FOUND' },
      404
    );
  }

  let deletedFiles = 0;
  let deletedMessages = 0;

  // 1. Delete all R2 files for this room
  try {
    const files = await c.env.DB.prepare(
      'SELECT id, r2_key FROM file_metadata WHERE room_id = ? AND recalled_at IS NULL'
    ).bind(room.id).all<{ id: string; r2_key: string }>();

    for (const file of files.results || []) {
      try {
        await c.env.FILES.delete(file.r2_key);
      } catch {
        // R2 delete may fail if object already gone — continue
      }
      // Mark as recalled
      await c.env.DB.prepare(
        'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
      ).bind(now, file.id).run();
      deletedFiles++;
    }
  } catch (err) {
    console.error('Error deleting room files from R2:', err);
    // [Debt: structured logging]
    // Continue with cascade — R2 cleanup is best-effort
  }

  // 2. Delete all messages
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM messages WHERE room_id = ?'
    ).bind(room.id).run();
    deletedMessages = result.meta.changes || 0;
  } catch (err) {
    console.error('Error deleting room messages:', err);
    // [Debt: structured logging]
  }

  // 3. Delete room members
  try {
    await c.env.DB.prepare(
      'DELETE FROM room_members WHERE room_id = ?'
    ).bind(room.id).run();
  } catch (err) {
    console.error('Error deleting room members:', err);
    // [Debt: structured logging]
  }

  // 4. Delete usage stats
  try {
    await c.env.DB.prepare(
      'DELETE FROM usage_stats WHERE room_id = ?'
    ).bind(room.id).run();
  } catch (err) {
    console.error('Error deleting usage stats:', err);
    // [Debt: structured logging]
  }

  // 5. Soft delete the room itself
  await c.env.DB.prepare(
    'UPDATE rooms SET deleted_at = ? WHERE id = ?'
  ).bind(now, room.id).run();

  // 6. Notify connected clients via RoomDO
  try {
    const doId = c.env.RoomDO.idFromName(room.room_code);
    const roomStub = c.env.RoomDO.get(doId);

    const destroyEvent = {
      type: 'system' as const,
      payload: {
        action: 'room_destroyed',
        room_code: room.room_code,
        message: 'This room has been destroyed by an administrator.',
      },
      sender_session_id: 'system',
      device_label: 'System',
      timestamp: now,
    };

    await roomStub.fetch(new URL('http://do/internal/broadcast'), {
      method: 'POST',
      body: JSON.stringify(destroyEvent),
    });

    // [Debt: DO lifecycle] After broadcasting, the DO instance should be terminated.
    // Cloudflare automatically hibernates idle DOs ~30s after last disconnect.
    // For immediate cleanup, consider calling a terminate() method or deleting DO state.
    // Currently not supported in the public API without manual intervention.
  } catch (err) {
    console.error('Failed to broadcast room destruction via DO:', err);
    // [Debt: structured logging]
  }

  const response: DestroyRoomResponse = {
    success: true,
    deleted_files: deletedFiles,
    deleted_messages: deletedMessages,
  };

  return c.json({ success: true, data: response }, 200);
}

// ---- DELETE /api/admin/rooms ----

/**
 * Destroy ALL non-deleted rooms.
 *
 * DELETE /api/admin/rooms
 *
 * Iterates all non-deleted rooms and cascade-deletes each one's:
 *   - R2 files
 *   - Messages
 *   - Room members
 *   - Usage stats
 *   - Room itself (soft delete: sets deleted_at)
 *
 * Returns aggregate counts across all destroyed rooms.
 * Admin scope required.
 */
export async function handleDestroyAllRooms(c: Context<AppContext>): Promise<Response> {
  // Require admin scope
  const session = c.get('session');
  if (!session || session.account_type !== 'admin') {
    return c.json(
      { success: false, error: 'Admin access required', code: 'FORBIDDEN' },
      403
    );
  }

  const now = new Date().toISOString();
  let totalDeletedRooms = 0;
  let totalDeletedFiles = 0;
  let totalDeletedMessages = 0;

  // Find all non-deleted rooms
  const rooms = await c.env.DB.prepare(
    'SELECT id, room_code FROM rooms WHERE deleted_at IS NULL'
  ).all<{ id: string; room_code: string }>();

  const roomList = rooms.results || [];

  for (const room of roomList) {
    let deletedFiles = 0;
    let deletedMessages = 0;

    // 1. Delete all R2 files for this room
    try {
      const files = await c.env.DB.prepare(
        'SELECT id, r2_key FROM file_metadata WHERE room_id = ? AND recalled_at IS NULL'
      ).bind(room.id).all<{ id: string; r2_key: string }>();

      for (const file of files.results || []) {
        try {
          await c.env.FILES.delete(file.r2_key);
        } catch {
          // R2 delete may fail if object already gone — continue
        }
        // Mark as recalled
        await c.env.DB.prepare(
          'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
        ).bind(now, file.id).run();
        deletedFiles++;
      }
    } catch (err) {
      console.error('Error deleting room files from R2 (bulk):', err);
      // [Debt: structured logging]
    }

    // 2. Delete all messages
    try {
      const result = await c.env.DB.prepare(
        'DELETE FROM messages WHERE room_id = ?'
      ).bind(room.id).run();
      deletedMessages = result.meta.changes || 0;
    } catch (err) {
      console.error('Error deleting room messages (bulk):', err);
      // [Debt: structured logging]
    }

    // 3. Delete room members
    try {
      await c.env.DB.prepare(
        'DELETE FROM room_members WHERE room_id = ?'
      ).bind(room.id).run();
    } catch (err) {
      console.error('Error deleting room members (bulk):', err);
      // [Debt: structured logging]
    }

    // 4. Delete usage stats
    try {
      await c.env.DB.prepare(
        'DELETE FROM usage_stats WHERE room_id = ?'
      ).bind(room.id).run();
    } catch (err) {
      console.error('Error deleting usage stats (bulk):', err);
      // [Debt: structured logging]
    }

    // 5. Soft delete the room itself
    await c.env.DB.prepare(
      'UPDATE rooms SET deleted_at = ? WHERE id = ?'
    ).bind(now, room.id).run();

    // 6. Notify connected clients via RoomDO
    try {
      const doId = c.env.RoomDO.idFromName(room.room_code);
      const roomStub = c.env.RoomDO.get(doId);

      const destroyEvent = {
        type: 'system' as const,
        payload: {
          action: 'room_destroyed',
          room_code: room.room_code,
          message: 'This room has been destroyed by an administrator.',
        },
        sender_session_id: 'system',
        device_label: 'System',
        timestamp: now,
      };

      await roomStub.fetch(new URL('http://do/internal/broadcast'), {
        method: 'POST',
        body: JSON.stringify(destroyEvent),
      });
    } catch (err) {
      console.error('Failed to broadcast room destruction via DO (bulk):', err);
      // [Debt: structured logging]
    }

    totalDeletedRooms++;
    totalDeletedFiles += deletedFiles;
    totalDeletedMessages += deletedMessages;
  }

  const response: DestroyAllRoomsResponse = {
    deleted_rooms: totalDeletedRooms,
    deleted_files: totalDeletedFiles,
    deleted_messages: totalDeletedMessages,
  };

  return c.json({ success: true, data: response }, 200);
}
