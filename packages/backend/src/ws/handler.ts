/**
 * WebSocket handler — connection upgrade endpoint.
 *
 * Two-step flow for secure WebSocket connections:
 *   1. GET /api/ws?room=XXXX&token=YYY
 *      → Worker validates auth, creates 60s one-time ticket in KV
 *      → Returns { ticket }
 *
 *   2. GET /api/ws/connect?ticket=XXX
 *      → Worker validates ticket from KV, retrieves room/session info
 *      → Creates RoomDO stub and forwards request for WebSocket upgrade
 *      → RoomDO accepts the WebSocket with hibernatable tags
 *
 * The two-step design prevents session tokens from appearing in WebSocket
 * URL logs (which can't be cleared from browser DevTools), while still
 * maintaining secure authentication.
 *
 * @module ws/handler
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { WsTicketResponse } from '@epheia-files/shared';
import { generateId } from '../utils/id';

// Ticket TTL: 60 seconds
const TICKET_TTL_SECONDS = 60;

// ---- GET /api/ws ----

/**
 * Step 1: Request a WebSocket connection ticket.
 * Validates auth + room membership, creates a short-lived ticket in KV.
 */
export async function handleWsTicket(c: Context<AppContext>): Promise<Response> {
  const roomCode = c.req.query('room');
  const token = c.req.query('token');

  if (!roomCode || !token) {
    return c.json(
      { success: false, error: 'room and token query params required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Validate room code format
  if (!/^[0-9]{4}$/.test(roomCode)) {
    return c.json(
      { success: false, error: 'Invalid room code format (4 digits required)', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Auth is already validated by the auth middleware (token from query)
  // The token in the query param is the session token from the auth header.
  // The middleware already validated it and set c.get('session').
  const session = c.get('session');
  const sessionToken = c.get('sessionToken');

  if (!session || !sessionToken) {
    return c.json(
      { success: false, error: 'Invalid or expired session', code: 'UNAUTHORIZED' },
      401
    );
  }

  // Verify room exists and user is a member
  const room = await c.env.DB.prepare(
    'SELECT id, room_code, deleted_at FROM rooms WHERE room_code = ?'
  ).bind(roomCode).first<{ id: string; room_code: string; deleted_at: string | null }>();

  if (!room || room.deleted_at) {
    return c.json(
      { success: false, error: 'Room not found', code: 'NOT_FOUND' },
      404
    );
  }

  const membership = await c.env.DB.prepare(
    'SELECT id, device_label FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room.id, sessionToken).first<{ id: string; device_label: string | null }>();

  if (!membership) {
    return c.json(
      { success: false, error: 'You are not a member of this room', code: 'FORBIDDEN' },
      403
    );
  }

  // Generate one-time ticket
  const ticket = generateId().replace(/-/g, '') + generateId().replace(/-/g, ''); // 64 hex chars

  // Store ticket in KV with room and session info
  await c.env.KV.put(
    `wsticket:${ticket}`,
    JSON.stringify({
      room_code: room.room_code,
      room_id: room.id,
      session_id: sessionToken,
      device_label: membership.device_label || 'Unknown',
      created_at: new Date().toISOString(),
    }),
    { expirationTtl: TICKET_TTL_SECONDS }
  );

  const response: WsTicketResponse = { ticket };

  return c.json({ success: true, data: response }, 200);
}

// ---- GET /api/ws/connect ----

/**
 * Step 2: Connect via WebSocket using the ticket.
 * Validates the ticket, retrieves room/session info from KV, and upgrades to RoomDO.
 */
export async function handleWsConnect(c: Context<AppContext>): Promise<Response> {
  const ticket = c.req.query('ticket');

  if (!ticket) {
    return c.json(
      { success: false, error: 'ticket query param required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Validate ticket from KV
  const raw = await c.env.KV.get(`wsticket:${ticket}`);
  if (!raw) {
    return c.json(
      { success: false, error: 'Invalid or expired ticket', code: 'UNAUTHORIZED' },
      401
    );
  }

  let ticketData: {
    room_code: string;
    room_id: string;
    session_id: string;
    device_label: string;
    created_at: string;
  };
  try {
    ticketData = JSON.parse(raw);
  } catch {
    return c.json(
      { success: false, error: 'Invalid ticket data', code: 'INTERNAL_ERROR' },
      500
    );
  }

  // One-time use: delete ticket immediately
  await c.env.KV.delete(`wsticket:${ticket}`);

  // Create the DO stub for this room
  const doId = c.env.RoomDO.idFromName(ticketData.room_code);
  const roomStub = c.env.RoomDO.get(doId);

  // Build a new request URL with room/session/device params so DO can extract them
  // The DO's handleWebSocketUpgrade needs these to set tags on the WebSocket
  const doUrl = new URL(c.req.url);
  doUrl.searchParams.set('room', ticketData.room_code);
  doUrl.searchParams.set('session', ticketData.session_id);
  doUrl.searchParams.set('device', ticketData.device_label);

  // Forward the upgrade request to the DO
  // This preserves the WebSocket upgrade headers so DO can accept the connection
  const upgradeRequest = new Request(doUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
  });

  return roomStub.fetch(upgradeRequest);
}
