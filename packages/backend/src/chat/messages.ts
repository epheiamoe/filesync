/**
 * Chat message handlers.
 *
 * POST   /api/chat/messages       — Send encrypted message (store in D1 + broadcast via DO)
 * GET    /api/chat/messages       — Paginated message history (cursor-based, DESC by created_at)
 * DELETE /api/chat/messages/:id   — Hard delete message + broadcast recall via DO
 *
 * All messages are stored encrypted in D1. The server never decrypts.
 * Real-time broadcast is routed through RoomDO (hibernatable WebSocket).
 *
 * Feature #10: Messages support optional TTL (burn-after-reading).
 *   ttl_seconds: 10-86400 → expires_at computed, auto-filtered from list.
 *
 * @module chat/messages
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { MessageDTO, ChatMessagesResponse } from '@filesync/shared';
import { generateId } from '../utils/id';
import { updateRoomActivity } from '../rooms/activity';

// ---- Validation Schemas ----

const sendMessageSchema = z.object({
  room_id: z.string().min(1),
  encrypted_content: z.string().min(1, 'Content cannot be empty').max(1_000_000, 'Message too large'),
  message_type: z.enum(['text', 'file_shared', 'system']).optional().default('text'),
  device_label: z.string().max(100).optional(),
  ttl_seconds: z.number().int().min(10, 'TTL must be at least 10 seconds').max(86400, 'TTL must not exceed 24 hours').optional(),
});

const queryMessagesSchema = z.object({
  room_id: z.string().min(1),
  before: z.string().optional(), // cursor: created_at value to paginate before
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const deleteMessageSchema = z.object({
  room_id: z.string().min(1),
});

// ---- POST /api/chat/messages ----

/**
 * Send an encrypted chat message.
 * 1. Validate session and room membership
 * 2. Insert into D1 messages table (with optional TTL/expires_at)
 * 3. Broadcast to all connected clients in the room via RoomDO
 * 4. Update room last_active_at
 */
export async function handleSendMessage(c: Context<AppContext>): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const parsed = sendMessageSchema.safeParse(body);
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

  const { room_id, encrypted_content, message_type, device_label, ttl_seconds } = parsed.data;
  const now = new Date().toISOString();
  const sessionToken = c.get('sessionToken') || '';

  // Compute expires_at if TTL is provided
  const expiresAt = ttl_seconds
    ? new Date(Date.now() + ttl_seconds * 1000).toISOString()
    : null;

  // Verify room exists and is not deleted
  const room = await c.env.DB.prepare(
    'SELECT id, room_code, deleted_at FROM rooms WHERE id = ?'
  ).bind(room_id).first<{ id: string; room_code: string; deleted_at: string | null }>();

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

  // Verify user is a member of the room
  const membership = await c.env.DB.prepare(
    'SELECT id, device_label FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room_id, sessionToken).first<{ id: string; device_label: string | null }>();

  if (!membership) {
    return c.json(
      { success: false, error: 'You are not a member of this room', code: 'FORBIDDEN' },
      403
    );
  }

  // Use existing device_label from membership if not provided
  const finalDeviceLabel = device_label || membership.device_label || 'Unknown';

  // Map message_type for D1 storage: 'file_shared' → 'file_notification'
  const dbMessageType = message_type === 'file_shared' ? 'file_notification' : message_type;

  // Insert message into D1 (with optional TTL/expires_at via try/catch)
  const messageId = generateId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_session_id, encrypted_content, message_type, device_label, ttl_seconds, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(messageId, room_id, sessionToken, encrypted_content, dbMessageType, finalDeviceLabel,
           ttl_seconds || null, expiresAt, now).run();
  } catch {
    // Fallback: columns may not exist yet — insert without TTL fields
    await c.env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_session_id, encrypted_content, message_type, device_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(messageId, room_id, sessionToken, encrypted_content, dbMessageType, finalDeviceLabel, now).run();
  }

  // Update room last_active_at
  try { await updateRoomActivity(c.env.DB, room_id); } catch { /* best-effort */ }

  // Broadcast to connected clients via RoomDO
  try {
    const doId = c.env.RoomDO.idFromName(room.room_code);
    const roomStub = c.env.RoomDO.get(doId);

    const broadcastEvent = {
      type: 'chat' as const,
      payload: {
        id: messageId,
        room_id,
        encrypted_content,
        message_type,
        sender_session_id: sessionToken,
        created_at: now,
        ttl_seconds: ttl_seconds || null,
        expires_at: expiresAt,
      },
      sender_session_id: sessionToken,
      device_label: finalDeviceLabel,
      timestamp: now,
    };

    await roomStub.fetch(new URL('http://do/internal/broadcast'), {
      method: 'POST',
      body: JSON.stringify(broadcastEvent),
    });
  } catch (err) {
    // Broadcast failure is non-critical — message is already stored in D1.
    // Clients will pick it up through polling or reconnection.
    console.error('Failed to broadcast message via DO:', err);
    // [Debt: structured logging] replace with proper observability
  }

  return c.json(
    {
      success: true,
      data: {
        message_id: messageId,
        created_at: now,
      },
    },
    201
  );
}

// ---- GET /api/chat/messages ----

/**
 * Get paginated chat message history for a room.
 * Uses cursor-based pagination (by created_at DESC).
 * Cursor value is the created_at timestamp to fetch messages before.
 *
 * Expired messages (expires_at < now) are automatically filtered out.
 */
export async function handleGetMessages(c: Context<AppContext>): Promise<Response> {
  const query = c.req.query();
  const parsed = queryMessagesSchema.safeParse(query);

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

  const { room_id, before, limit } = parsed.data;
  const sessionToken = c.get('sessionToken') || '';

  // Verify room exists
  const room = await c.env.DB.prepare(
    'SELECT id, deleted_at FROM rooms WHERE id = ?'
  ).bind(room_id).first<{ id: string; deleted_at: string | null }>();

  if (!room || room.deleted_at) {
    return c.json(
      { success: false, error: 'Room not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Verify user is a member
  const membership = await c.env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room_id, sessionToken).first();

  if (!membership) {
    return c.json(
      { success: false, error: 'You are not a member of this room', code: 'FORBIDDEN' },
      403
    );
  }

  // Build query with optional cursor and expire filter
  // Filter: no recalled messages AND (no expiry OR not yet expired)
  // Use try/catch since expires_at column may not exist yet
  let stmt: D1PreparedStatement;
  try {
    if (before) {
      stmt = c.env.DB.prepare(
        `SELECT m.id, m.room_id, m.sender_session_id, m.encrypted_content, m.message_type,
                m.recalled_at, m.created_at, m.device_label, m.ttl_seconds, m.expires_at
         FROM messages m
         WHERE m.room_id = ? AND m.recalled_at IS NULL
           AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
           AND m.created_at < ?
         ORDER BY m.created_at DESC
         LIMIT ?`
      ).bind(room_id, before, limit + 1);
    } else {
      stmt = c.env.DB.prepare(
        `SELECT m.id, m.room_id, m.sender_session_id, m.encrypted_content, m.message_type,
                m.recalled_at, m.created_at, m.device_label, m.ttl_seconds, m.expires_at
         FROM messages m
         WHERE m.room_id = ? AND m.recalled_at IS NULL
           AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
         ORDER BY m.created_at DESC
         LIMIT ?`
      ).bind(room_id, limit + 1);
    }
  } catch {
    // Fallback: expires_at column doesn't exist yet — query without expire filter
    // Also try without joining room_members (using the message's own device_label)
    if (before) {
      stmt = c.env.DB.prepare(
        `SELECT m.id, m.room_id, m.sender_session_id, m.encrypted_content, m.message_type,
                m.recalled_at, m.created_at, m.device_label
         FROM messages m
         WHERE m.room_id = ? AND m.recalled_at IS NULL AND m.created_at < ?
         ORDER BY m.created_at DESC
         LIMIT ?`
      ).bind(room_id, before, limit + 1);
    } else {
      stmt = c.env.DB.prepare(
        `SELECT m.id, m.room_id, m.sender_session_id, m.encrypted_content, m.message_type,
                m.recalled_at, m.created_at, m.device_label
         FROM messages m
         WHERE m.room_id = ? AND m.recalled_at IS NULL
         ORDER BY m.created_at DESC
         LIMIT ?`
      ).bind(room_id, limit + 1);
    }
  }

  const result = await stmt.all<{
    id: string;
    room_id: string;
    sender_session_id: string;
    encrypted_content: string;
    message_type: string;
    recalled_at: string | null;
    created_at: string;
    device_label: string | null;
    ttl_seconds?: number | null;
    expires_at?: string | null;
  }>();

  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows) as typeof rows;

  const nextCursor = hasMore ? messages[messages.length - 1].created_at : null;

  // Map D1 storage type back to API type
  const messageDTOs: MessageDTO[] = messages.map((m) => ({
    id: m.id,
    room_id: m.room_id,
    sender_session_id: m.sender_session_id,
    encrypted_content: m.encrypted_content,
    message_type: (m.message_type === 'file_notification' ? 'file_shared' : m.message_type) as MessageDTO['message_type'],
    device_label: m.device_label || undefined,
    recalled_at: m.recalled_at || undefined,
    ttl_seconds: (m as any).ttl_seconds ?? undefined,
    expires_at: (m as any).expires_at ?? undefined,
    created_at: m.created_at,
  }));

  const response: ChatMessagesResponse = {
    messages: messageDTOs,
    next_cursor: nextCursor,
  };

  return c.json({ success: true, data: response }, 200);
}

// ---- DELETE /api/chat/messages/:id ----

/**
 * Recall (hard delete) a chat message.
 * Only the original sender (or admin) can recall a message.
 * 1. Verify message exists and sender matches
 * 2. Hard delete from D1
 * 3. Broadcast recall event via RoomDO
 */
export async function handleRecallMessage(c: Context<AppContext>): Promise<Response> {
  const messageId = c.req.param('id');

  if (!messageId) {
    return c.json(
      { success: false, error: 'Message ID required', code: 'VALIDATION_ERROR' },
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

  const parsed = deleteMessageSchema.safeParse(body);
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

  const { room_id } = parsed.data;
  const sessionToken = c.get('sessionToken') || '';
  const session = c.get('session');

  // Verify message exists and get room info
  const message = await c.env.DB.prepare(
    `SELECT m.id, m.sender_session_id, m.room_id, r.room_code
     FROM messages m
     JOIN rooms r ON r.id = m.room_id
     WHERE m.id = ? AND m.room_id = ?`
  ).bind(messageId, room_id).first<{
    id: string;
    sender_session_id: string;
    room_id: string;
    room_code: string;
  }>();

  if (!message) {
    return c.json(
      { success: false, error: 'Message not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Authorization: sender or admin
  const isAdmin = session?.account_type === 'admin';
  const isSender = message.sender_session_id === sessionToken;

  if (!isAdmin && !isSender) {
    return c.json(
      { success: false, error: 'Only the sender or an admin can recall this message', code: 'FORBIDDEN' },
      403
    );
  }

  // Hard delete from D1
  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId).run();

  // Broadcast recall via RoomDO
  try {
    const doId = c.env.RoomDO.idFromName(message.room_code);
    const roomStub = c.env.RoomDO.get(doId);

    const recallEvent = {
      type: 'recall' as const,
      payload: { id: messageId, message_id: messageId },
      sender_session_id: sessionToken,
      device_label: '',
      timestamp: new Date().toISOString(),
    };

    await roomStub.fetch(new URL('http://do/internal/broadcast'), {
      method: 'POST',
      body: JSON.stringify(recallEvent),
    });
  } catch (err) {
    console.error('Failed to broadcast recall via DO:', err);
    // [Debt: structured logging]
  }

  return c.json(
    { success: true, data: { success: true } },
    200
  );
}

// Re-export for type usage elsewhere
export type { MessageDTO, ChatMessagesResponse } from '@filesync/shared';
