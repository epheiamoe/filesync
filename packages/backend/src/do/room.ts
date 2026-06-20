/**
 * RoomDO — Hibernatable Durable Object for WebSocket-based real-time messaging.
 *
 * **Architecture: ONE RoomDO instance per room** (via `idFromName(roomCode)`).
 * All WebSocket connections in a single DO instance belong to the same room.
 *
 * **Hibernatable Design:**
 * - Uses Cloudflare's hibernatable WebSocket API to minimize billing
 * - DO wakes only on incoming messages (webSocketMessage), disconnects (webSocketClose),
 *   errors (webSocketError), or HTTP fetch calls (RPC from Worker)
 * - No persistent state stored in DO — all state is in-memory connections
 * - No SQLite, file I/O, or message storage in DO
 *
 * **Tag system:**
 * - Each WebSocket is tagged with: [roomCode, sessionId, deviceLabel]
 * - Tags enable efficient member tracking and targeted messaging
 * - Device label dedup: when listing members, duplicate labels get "#2", "#3" suffixes
 *
 * **HTTP API (called by Worker via `roomStub.fetch()`):**
 * - POST /internal/broadcast  → relay event to all connected clients
 * - GET  /internal/members     → return list of online members with dedup labels
 *
 * @module do/room
 */

import { DurableObject } from "cloudflare:workers";
import type { BroadcastEvent, OnlineMember } from '@epheia-files/shared';

/** Tag prefix conventions */
const TAG_ROOM = 'room:';
const TAG_SESSION = 'session:';
const TAG_DEVICE = 'device:';

/**
 * RoomDO — per-room WebSocket relay.
 *
 * All connected clients in this DO share the same room.
 * Messages are received from the Worker via HTTP and broadcast to all connected WebSocket clients.
 * Client-to-server WebSocket messages are limited to ping/pong (heartbeat).
 */
export class RoomDO extends DurableObject {
  // ---- HTTP API (RPC from Worker) ----

  /**
   * Handles both WebSocket upgrades and internal HTTP RPC calls.
   *
   * **WebSocket upgrade path:**
   *   Worker receives client WS request → creates DO stub → calls roomStub.fetch(request)
   *   → DO detects Upgrade header → accepts WebSocket with tags → returns 101
   *
   * **Internal RPC path:**
   *   Worker wants to broadcast or query members → creates DO stub → calls roomStub.fetch(internalRequest)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ---- WebSocket Upgrade ----
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // ---- Internal RPC: Broadcast ----
    if (url.pathname === '/internal/broadcast' && request.method === 'POST') {
      try {
        const event = await request.json() as BroadcastEvent;
        await this.broadcastToAll(event);
        return new Response(JSON.stringify({ success: true, count: this.countConnections() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid broadcast payload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ---- Internal RPC: Get Online Members ----
    if (url.pathname === '/internal/members' && request.method === 'GET') {
      const members = this.getOnlineMembers();
      return new Response(JSON.stringify({ members, count: this.countConnections() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ---- Unknown route ----
    return new Response('Not found', { status: 404 });
  }

  // ---- WebSocket Hibernation Handlers ----

  /**
   * Handle incoming WebSocket message from a client.
   * Only processes ping/pong for heartbeat — all chat messages go through Worker HTTP API.
   * This keeps the DO lightweight and hibernatable.
   */
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const data = JSON.parse(message) as { event?: string; roomCode?: string; sessionId?: string; deviceLabel?: string };

      // Heartbeat: ping → pong
      if (data.event === 'ping') {
        ws.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
        return;
      }

      // Initial subscription: client announces readiness
      // Tags are already set at accept time from URL params (passed by Worker).
      // We broadcast member_join to all connected clients.
      if (data.event === 'subscribe' && data.roomCode && data.sessionId) {
        // Broadcast member_join to all connected clients
        const joinEvent: BroadcastEvent = {
          type: 'member_join',
          payload: {
            session_id: data.sessionId,
            device_label: data.deviceLabel || 'Unknown',
          },
          sender_session_id: data.sessionId,
          device_label: data.deviceLabel || 'Unknown',
          timestamp: new Date().toISOString(),
        };
        await this.broadcastToAll(joinEvent);
        return;
      }
    } catch {
      // Ignore malformed or non-JSON messages — DO doesn't process them
    }
  }

  /**
   * Handle WebSocket disconnection.
   * Broadcasts member_leave event to remaining clients.
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const sessionId = this.extractTag(tags, TAG_SESSION) || 'unknown';
    const deviceLabel = this.extractTag(tags, TAG_DEVICE) || 'Unknown';

    // Broadcast member_leave
    const leaveEvent: BroadcastEvent = {
      type: 'member_leave',
      payload: {
        session_id: sessionId,
        device_label: deviceLabel,
      },
      sender_session_id: sessionId,
      device_label: deviceLabel,
      timestamp: new Date().toISOString(),
    };

    // Don't broadcast if this was the last connection in the room
    // (after this close, the room will be empty and DO will hibernate)
    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws);
    if (remaining.length > 0) {
      await this.broadcastTo(leaveEvent, remaining);
    }

    // No explicit cleanup needed — DO handles connection removal automatically
  }

  /**
   * Handle WebSocket error.
   * Closes the errored connection gracefully.
   */
  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error('RoomDO WebSocket error:', error.message);
    // [Debt: structured logging] Replace with proper observability

    try {
      ws.close(1011, 'Internal server error');
    } catch {
      // Connection might already be closed
    }
  }

  // ---- Broadcast Logic ----

  /**
   * Send an event to all connected WebSocket clients in this room.
   * Called from the HTTP broadcast endpoint.
   *
   * Handles stalled/dead connections gracefully by wrapping send() in try-catch.
   */
  private async broadcastToAll(event: BroadcastEvent): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    const message = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Dead connection — DO will clean up via webSocketClose/webSocketError
      }
    }
  }

  /**
   * Send an event to a specific set of WebSocket clients.
   */
  private async broadcastTo(event: BroadcastEvent, sockets: WebSocket[]): Promise<void> {
    const message = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Dead connection
      }
    }
  }

  // ---- Member Tracking ----

  /**
   * Get list of online members with deduplicated device labels.
   *
   * Dedup logic:
   *   - First occurrence of "Windows Chrome" → display as "Windows Chrome"
   *   - Second occurrence → "Windows Chrome #2"
   *   - Third → "Windows Chrome #3"
   *
   * This is purely for display — the actual connections remain separate.
   */
  private getOnlineMembers(): OnlineMember[] {
    const sockets = this.ctx.getWebSockets();
    const labelCounts: Map<string, number> = new Map();
    const members: OnlineMember[] = [];

    for (const ws of sockets) {
      const tags = this.ctx.getTags(ws);
      const sessionId = this.extractTag(tags, TAG_SESSION) || 'unknown';
      const deviceLabel = this.extractTag(tags, TAG_DEVICE) || 'Unknown';

      // Track label occurrences for dedup
      const count = (labelCounts.get(deviceLabel) || 0) + 1;
      labelCounts.set(deviceLabel, count);

      const displayLabel = count === 1
        ? deviceLabel
        : `${deviceLabel} #${count}`;

      members.push({ session_id: sessionId, device_label: deviceLabel, display_label: displayLabel });
    }

    return members;
  }

  // ---- Utility ----

  /**
   * Handle WebSocket upgrade: accept the connection with room/session/device tags.
   * Tags are extracted from URL search params (set by the Worker that validated auth).
   */
  private handleWebSocketUpgrade(request: Request): Response {
    const url = new URL(request.url);
    const roomCode = url.searchParams.get('room') || 'unknown';
    const sessionId = url.searchParams.get('session') || 'unknown';
    const deviceLabel = url.searchParams.get('device') || 'Unknown';

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept server-side WebSocket with tags for hibernatable routing
    const tags = [
      `${TAG_ROOM}${roomCode}`,
      `${TAG_SESSION}${sessionId}`,
      `${TAG_DEVICE}${deviceLabel}`,
    ];
    this.ctx.acceptWebSocket(server, tags);

    // Return 101 Switching Protocols with the client WebSocket
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Extract a tag value from a tag array by prefix.
   *
   * @example extractTag(["room:1234", "session:abc"], "room:") → "1234"
   */
  private extractTag(tags: string[], prefix: string): string | null {
    for (const tag of tags) {
      if (tag.startsWith(prefix)) {
        return tag.slice(prefix.length);
      }
    }
    return null;
  }

  /**
   * Count currently connected WebSocket clients.
   */
  private countConnections(): number {
    return this.ctx.getWebSockets().length;
  }
}
