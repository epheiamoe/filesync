/**
 * epheia-files WebSocket Client — Room real-time connection.
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
  : 'wss://epheia-files-api.epheia.workers.dev';

export class RoomSocket {
  private ws: WebSocket | null = null;
  private roomCode: string;
  private token: string;
  private messageHandlers: WsEventHandler[] = [];
  private memberHandlers: MemberUpdateHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private connected = false;

  constructor(roomCode: string, token: string) {
    this.roomCode = roomCode;
    this.token = token;
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
   * Send a ping to keep the connection alive.
   */
  sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event: 'ping' }));
    }
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
    // Server sends { type, payload, sender_session_id, device_label, timestamp }
    // NOT { event, data } — fixing protocol mismatch (Bug 1C)
    const event = (raw.type as string) || (raw.event as string); // support both for backward compat
    const payload = (raw.payload as Record<string, unknown>) || (raw.data as Record<string, unknown>) || {};

    switch (event) {
      case 'message':
      case 'recall':
      case 'file_shared':
      case 'file_recalled': {
        const wsMsg: WsMessage = {
          type: event === 'file_recalled' ? 'file_shared' : (event as WsMessage['type']),
          payload: payload ?? {},
          sender_session_id: (payload?.sender_session_id as string) || '',
          device_label: (payload?.device_label as string) || '',
          timestamp: (payload?.created_at as string) || new Date().toISOString(),
        };
        this.messageHandlers.forEach((h) => h(wsMsg));
        break;
      }
      case 'presence': {
        const members = (payload?.members as OnlineMember[]) || [];
        this.memberHandlers.forEach((h) => h(members));
        break;
      }
      case 'pong':
        // Heartbeat response — no action needed
        break;
      default:
        // Unknown event type — ignore
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
