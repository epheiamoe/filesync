/**
 * filesync WebSocket Client — Room real-time connection.
 *
 * Handles WebSocket connection lifecycle for a specific room:
 * - Requests a WS ticket from the API
 * - Connects to the DO via WebSocket
 * - Parses inbound events and dispatches to handlers
 * - Auto-reconnect with exponential backoff
 *
 * @module ws
 */

import { api } from './api';
import type { WsMessage, OnlineMember } from '@shared/types';

export type WsEventHandler = (event: WsMessage) => void;
export type MemberUpdateHandler = (members: OnlineMember[]) => void;
export type ConnectionHandler = (connected: boolean) => void;

const WS_BASE = import.meta.env.DEV
  ? 'ws://localhost:8787'
  : 'wss://filesync-api.epheia.workers.dev';

export class RoomSocket {
  private ws: WebSocket | null = null;
  private roomCode: string;
  private token: string;
  private sessionId: string;
  private deviceLabel: string;
  private messageHandlers: WsEventHandler[] = [];
  private memberHandlers: MemberUpdateHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private connected = false;

  constructor(roomCode: string, token: string, sessionId?: string, deviceLabel?: string) {
    this.roomCode = roomCode;
    this.token = token;
    this.sessionId = sessionId || token;
    this.deviceLabel = deviceLabel || 'Unknown';
  }

  /**
   * Connect to the room WebSocket.
   * Step 1: Get WS ticket from API
   * Step 2: Connect via WebSocket with the ticket
   */
  async connect(): Promise<void> {
    this.intentionalClose = false;

    try {
      // Get a short-lived ticket for WebSocket connection
      const { ticket } = await api.getWsTicket(this.roomCode);

      // Build WebSocket URL
      const wsUrl = this.buildWsUrl(ticket);

      // Connect
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.connected = true;
        // Send subscribe to trigger member_join broadcast in RoomDO.
        // The DO expects { event: 'subscribe', roomCode, sessionId, deviceLabel }.
        this.send({
          event: 'subscribe',
          roomCode: this.roomCode,
          sessionId: this.sessionId,
          deviceLabel: this.deviceLabel,
        });
        this.connectionHandlers.forEach((h) => h(true));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.handleServerMessage(data);
        } catch {
          // Non-JSON frame (pong, etc.) — ignore
        }
      };

      this.ws.onclose = (event) => {
        this.connected = false;
        this.connectionHandlers.forEach((h) => h(false));

        if (!this.intentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // WebSocket errors trigger onclose, so we just log here
        console.warn('[RoomSocket] WebSocket error');
      };
    } catch (err) {
      console.error('[RoomSocket] Connection failed:', err);
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Close the WebSocket connection intentionally.
   */
  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client closing');
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Register a handler for incoming messages.
   */
  onMessage(handler: WsEventHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Register a handler for online member updates.
   */
  onMemberUpdate(handler: MemberUpdateHandler): () => void {
    this.memberHandlers.push(handler);
    return () => {
      this.memberHandlers = this.memberHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Register a handler for connection state changes.
   */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.push(handler);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Send arbitrary JSON data over the WebSocket.
   * Used for subscribe events and future client→DO messaging.
   */
  send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Send a ping to keep the connection alive.
   */
  sendPing(): void {
    this.send({ event: 'ping' });
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ---- Private ----

  private buildWsUrl(ticket: string): string {
    const params = new URLSearchParams({ room: this.roomCode, ticket });
    // In production, use wss:// and the actual domain
    return `${WS_BASE}/api/ws/connect?${params}`;
  }

  private handleServerMessage(raw: Record<string, unknown>): void {
    // Broadcast format: { type, payload, sender_session_id, device_label, timestamp }
    // These top-level fields are OUTSIDE payload — extract from raw, not from payload.
    const event = (raw.type as string) || (raw.event as string); // support both for backward compat
    const rawPayload = (raw.payload as Record<string, unknown>) || (raw.data as Record<string, unknown>) || {};

    // Extract top-level broadcast fields (NOT from payload)
    const senderSessionId = (raw.sender_session_id as string) || '';
    const deviceLabel = (raw.device_label as string) || '';
    const timestamp = (raw.timestamp as string) || new Date().toISOString();

    switch (event) {
      case 'message':
      case 'chat': {
        // Normalize payload: map backend field names → DTO-compatible field names.
        // Supports BOTH old names (message_id) and new names (id) for backward compat.
        const normalizedPayload: Record<string, unknown> = {
          id: rawPayload.id || rawPayload.message_id,
          room_id: rawPayload.room_id || '',
          sender_session_id: rawPayload.sender_session_id || senderSessionId,
          encrypted_content: rawPayload.encrypted_content,
          message_type: rawPayload.message_type || 'text',
          device_label: rawPayload.device_label || deviceLabel,
          created_at: rawPayload.created_at || timestamp,
          ttl_seconds: rawPayload.ttl_seconds,
          expires_at: rawPayload.expires_at,
        };
        const wsMsg: WsMessage = {
          type: 'chat',
          payload: normalizedPayload,
          sender_session_id: senderSessionId,
          device_label: deviceLabel,
          timestamp,
        };
        this.messageHandlers.forEach((h) => h(wsMsg));
        break;
      }
      case 'file_shared': {
        // Normalize payload: map backend field names → DTO-compatible field names.
        // Supports BOTH old names (file_id) and new names (id) for backward compat.
        const normalizedPayload: Record<string, unknown> = {
          id: rawPayload.id || rawPayload.file_id,
          room_id: rawPayload.room_id || '',
          uploader_session_id: rawPayload.uploader_session_id || senderSessionId,
          encrypted_filename: rawPayload.encrypted_filename,
          encrypted_meta: rawPayload.encrypted_meta || '',
          file_size: rawPayload.file_size,
          mime_type: rawPayload.mime_type,
          visibility: rawPayload.visibility,
          expires_at: rawPayload.expires_at,
          created_at: rawPayload.created_at || timestamp,
          file_hash: rawPayload.file_hash,
        };
        const wsMsg: WsMessage = {
          type: 'file_shared',
          payload: normalizedPayload,
          sender_session_id: senderSessionId,
          device_label: deviceLabel,
          timestamp,
        };
        this.messageHandlers.forEach((h) => h(wsMsg));
        break;
      }
      case 'recall': {
        // Normalize recall payload — preserve all original fields.
        // Backend sends { message_id, file_id } or { id } depending on context.
        // We pass through everything so the handler (RoomPage) can dispatch
        // to both removeMessage and removeFile as needed.
        const normalizedPayload: Record<string, unknown> = {
          message_id: rawPayload.message_id || rawPayload.id,
          file_id: rawPayload.file_id || '',
          ...rawPayload,
        };
        const wsMsg: WsMessage = {
          type: 'recall',
          payload: normalizedPayload,
          sender_session_id: senderSessionId,
          device_label: deviceLabel,
          timestamp,
        };
        this.messageHandlers.forEach((h) => h(wsMsg));
        break;
      }
      case 'presence': {
        const members = (rawPayload?.members as OnlineMember[]) || [];
        this.memberHandlers.forEach((h) => h(members));
        break;
      }
      case 'member_join':
      case 'member_leave': {
        // Route to messageHandlers so RoomPage can incrementally update
        // the online members list. The RoomDO broadcasts these on
        // subscribe (join) and disconnect (leave).
        const wsMsg: WsMessage = {
          type: event as 'member_join' | 'member_leave',
          payload: {
            session_id: rawPayload?.session_id || '',
            device_label: rawPayload?.device_label || 'Unknown',
          },
          sender_session_id: senderSessionId,
          device_label: deviceLabel,
          timestamp,
        };
        this.messageHandlers.forEach((h) => h(wsMsg));
        break;
      }
      case 'pong':
        // Heartbeat response — no action needed
        break;
      default:
        // Unknown event type — log for debugging; don't silently swallow
        // critical DO broadcasts (e.g., member_join, member_leave, system).
        console.warn('[RoomSocket] Unknown event type:', event, raw);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
