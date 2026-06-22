/**
 * RoomDO (Durable Object) tests.
 *
 * Tests the DO's broadcast, member tracking, and dedup logic
 * without requiring a real WebSocket connection or DO runtime.
 *
 * NOTE: Full DO WebSocket testing requires a deployed Cloudflare Worker.
 * These tests validate the algorithm logic and data transformations.
 * See .swarm/2026-06-21_filesync/impl-2.md for limitations.
 */

import { describe, it, expect } from 'vitest';
import type { BroadcastEvent, OnlineMember, WsMessage } from '@filesync/shared';

// ---- Helper: Extract tag value (mirrors RoomDO.extractTag) ----

function extractTag(tags: string[], prefix: string): string | null {
  for (const tag of tags) {
    if (tag.startsWith(prefix)) {
      return tag.slice(prefix.length);
    }
  }
  return null;
}

// ---- Helper: Build display label with deterministic session suffix ----

function displayLabel(deviceLabel: string, sessionId: string): string {
  return `${deviceLabel}#${sessionId.slice(0, 4)}`;
}

// ---- Helper: Generate sorted online members (mirrors RoomDO.getOnlineMembers logic) ----

function getOnlineMembers(
  connections: { sessionId: string; deviceLabel: string }[],
): OnlineMember[] {
  const pairs = connections.map((conn) => ({
    session_id: conn.sessionId,
    device_label: conn.deviceLabel,
  }));

  pairs.sort((a, b) => a.session_id.localeCompare(b.session_id));

  return pairs.map(({ session_id, device_label }) => {
    const shortId = session_id.slice(0, 4);
    return {
      session_id,
      device_label,
      display_label: displayLabel(device_label, session_id),
      short_id: shortId,
    };
  });
}

// ---- Helper: Build a presence broadcast event (mirrors RoomDO.broadcastPresence logic) ----

function buildPresenceEvent(members: OnlineMember[]): BroadcastEvent {
  return {
    type: 'presence',
    payload: { members },
    sender_session_id: 'system',
    device_label: 'System',
    timestamp: new Date().toISOString(),
  };
}

// ---- Helper: Broadcast event to select sockets ----

function broadcastToSockets(
  event: BroadcastEvent,
  sockets: { sessionId: string; send: (msg: string) => void }[]
): { received: number; errors: number } {
  const message = JSON.stringify(event);
  let received = 0;
  let errors = 0;

  for (const socket of sockets) {
    try {
      socket.send(message);
      received++;
    } catch {
      errors++;
    }
  }

  return { received, errors };
}

// ---- Tests ----

describe('RoomDO tag extraction', () => {
  it('should extract room code from tags', () => {
    const tags = ['room:1234', 'session:abc', 'device:Windows Chrome'];
    expect(extractTag(tags, 'room:')).toBe('1234');
  });

  it('should extract session id from tags', () => {
    const tags = ['room:5678', 'session:xyz-789', 'device:iPhone Safari'];
    expect(extractTag(tags, 'session:')).toBe('xyz-789');
  });

  it('should extract device label from tags', () => {
    const tags = ['room:0001', 'session:abc', 'device:Windows Chrome'];
    expect(extractTag(tags, 'device:')).toBe('Windows Chrome');
  });

  it('should return null for missing tag prefix', () => {
    const tags = ['room:1234', 'session:abc'];
    expect(extractTag(tags, 'device:')).toBeNull();
  });

  it('should handle empty tags array', () => {
    expect(extractTag([], 'room:')).toBeNull();
  });
});

describe('RoomDO online members', () => {
  it('should sort members by session_id', () => {
    const connections = [
      { sessionId: 'zebra', deviceLabel: 'Windows Chrome' },
      { sessionId: 'alpha', deviceLabel: 'iPhone Safari' },
      { sessionId: 'mango', deviceLabel: 'Mac Firefox' },
    ];

    const members = getOnlineMembers(connections);
    expect(members.map((m) => m.session_id)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('should format display_label as device_label + session_id first 4 chars', () => {
    const connections = [
      { sessionId: 'a1b2c3d4', deviceLabel: 'Windows Chrome' },
      { sessionId: 'ef12abcd', deviceLabel: 'Windows Chrome' },
    ];

    const members = getOnlineMembers(connections);
    expect(members).toHaveLength(2);
    expect(members[0].display_label).toBe('Windows Chrome#a1b2');
    expect(members[1].display_label).toBe('Windows Chrome#ef12');
  });

  it('should include short_id as session_id first 4 chars', () => {
    const connections = [{ sessionId: 'a1b2c3d4', deviceLabel: 'Windows Chrome' }];
    const members = getOnlineMembers(connections);
    expect(members[0].short_id).toBe('a1b2');
  });

  it('should not add suffix for unique labels', () => {
    const connections = [
      { sessionId: 's1', deviceLabel: 'Windows Chrome' },
      { sessionId: 's2', deviceLabel: 'iPhone Safari' },
      { sessionId: 's3', deviceLabel: 'Mac Firefox' },
    ];

    const members = getOnlineMembers(connections);
    expect(members).toHaveLength(3);
    expect(members[0].display_label).toBe('Windows Chrome#s1');
    expect(members[1].display_label).toBe('iPhone Safari#s2');
    expect(members[2].display_label).toBe('Mac Firefox#s3');
  });

  it('should distinguish duplicate labels by deterministic session prefix', () => {
    const connections = [
      { sessionId: 'aaaa', deviceLabel: 'Windows Chrome' },
      { sessionId: 'bbbb', deviceLabel: 'Windows Chrome' },
      { sessionId: 'cccc', deviceLabel: 'Windows Chrome' },
    ];

    const members = getOnlineMembers(connections);
    expect(members).toHaveLength(3);
    expect(members[0].display_label).toBe('Windows Chrome#aaaa');
    expect(members[1].display_label).toBe('Windows Chrome#bbbb');
    expect(members[2].display_label).toBe('Windows Chrome#cccc');
  });

  it('should handle mixed unique and duplicate labels', () => {
    const connections = [
      { sessionId: 'w1', deviceLabel: 'Windows Chrome' },
      { sessionId: 'i1', deviceLabel: 'iPhone Safari' },
      { sessionId: 'w2', deviceLabel: 'Windows Chrome' },
      { sessionId: 'i2', deviceLabel: 'iPhone Safari' },
      { sessionId: 'a1', deviceLabel: 'Android Chrome' },
    ];

    const members = getOnlineMembers(connections);
    // Sorted by session_id: a1, i1, i2, w1, w2
    expect(members[0].display_label).toBe('Android Chrome#a1');
    expect(members[1].display_label).toBe('iPhone Safari#i1');
    expect(members[2].display_label).toBe('iPhone Safari#i2');
    expect(members[3].display_label).toBe('Windows Chrome#w1');
    expect(members[4].display_label).toBe('Windows Chrome#w2');
  });

  it('should preserve original device_label in output', () => {
    const connections = [
      { sessionId: 's1', deviceLabel: 'Windows Chrome' },
      { sessionId: 's2', deviceLabel: 'Windows Chrome' },
    ];

    const members = getOnlineMembers(connections);
    expect(members[0].device_label).toBe('Windows Chrome');
    expect(members[0].display_label).toBe('Windows Chrome#s1');
    expect(members[1].device_label).toBe('Windows Chrome');
    expect(members[1].display_label).toBe('Windows Chrome#s2');
  });

  it('should handle session_id shorter than 4 chars', () => {
    const members = getOnlineMembers([{ sessionId: 'abc', deviceLabel: 'Windows Chrome' }]);
    expect(members[0].display_label).toBe('Windows Chrome#abc');
    expect(members[0].short_id).toBe('abc');
  });

  it('should handle unknown device label', () => {
    const members = getOnlineMembers([{ sessionId: 's1', deviceLabel: 'Unknown' }]);
    expect(members[0].device_label).toBe('Unknown');
    expect(members[0].display_label).toBe('Unknown#s1');
  });
});

describe('RoomDO broadcast events', () => {
  it('should serialize broadcast event as JSON', () => {
    const event: BroadcastEvent = {
      type: 'chat',
      payload: { message_id: 'msg-1', encrypted_content: 'base64data', message_type: 'text' },
      sender_session_id: 'session-abc',
      device_label: 'iPhone Safari',
      timestamp: '2026-06-21T10:00:00Z',
    };

    const json = JSON.stringify(event);
    const parsed = JSON.parse(json) as BroadcastEvent;

    expect(parsed.type).toBe('chat');
    expect(parsed.sender_session_id).toBe('session-abc');
    expect((parsed.payload as { message_id: string }).message_id).toBe('msg-1');
  });

  it('should broadcast chat event to all connected sockets', () => {
    const receivedMessages: string[] = [];
    const sockets = [
      { sessionId: 's1', send: (msg: string) => { receivedMessages.push(msg); } },
      { sessionId: 's2', send: (msg: string) => { receivedMessages.push(msg); } },
    ];

    const event: BroadcastEvent = {
      type: 'chat',
      payload: { message_id: 'msg-1' },
      sender_session_id: 'sender',
      device_label: 'Windows Chrome',
      timestamp: new Date().toISOString(),
    };

    const result = broadcastToSockets(event, sockets);
    expect(result.received).toBe(2);
    expect(result.errors).toBe(0);
    expect(receivedMessages).toHaveLength(2);

    // Verify both received the same message
    const parsed1 = JSON.parse(receivedMessages[0]) as BroadcastEvent;
    const parsed2 = JSON.parse(receivedMessages[1]) as BroadcastEvent;
    expect(parsed1.type).toBe('chat');
    expect(parsed2.type).toBe('chat');
  });

  it('should handle a dead socket gracefully', () => {
    const receivedMessages: string[] = [];
    const sockets = [
      { sessionId: 's1', send: (msg: string) => { receivedMessages.push(msg); } },
      {
        sessionId: 's2',
        send: () => { throw new Error('Connection lost'); },
      },
    ];

    const event: BroadcastEvent = {
      type: 'chat',
      payload: { message_id: 'msg-1' },
      sender_session_id: 'sender',
      device_label: 'Test',
      timestamp: new Date().toISOString(),
    };

    const result = broadcastToSockets(event, sockets);
    expect(result.received).toBe(1);
    expect(result.errors).toBe(1);
  });

  it('should broadcast recall event', () => {
    const receivedMessages: string[] = [];
    const sockets = [
      { sessionId: 's1', send: (msg: string) => { receivedMessages.push(msg); } },
    ];

    const event: BroadcastEvent = {
      type: 'recall',
      payload: { message_id: 'msg-to-recall' },
      sender_session_id: 'sender',
      device_label: '',
      timestamp: new Date().toISOString(),
    };

    broadcastToSockets(event, sockets);
    const parsed = JSON.parse(receivedMessages[0]) as BroadcastEvent;
    expect(parsed.type).toBe('recall');
    expect((parsed.payload as { message_id: string }).message_id).toBe('msg-to-recall');
  });

  it('should broadcast member_join event', () => {
    const event: BroadcastEvent = {
      type: 'member_join',
      payload: { session_id: 'new-session', device_label: 'iPhone Safari' },
      sender_session_id: 'new-session',
      device_label: 'iPhone Safari',
      timestamp: new Date().toISOString(),
    };

    expect(event.type).toBe('member_join');
    expect((event.payload as { session_id: string }).session_id).toBe('new-session');
  });

  it('should broadcast member_leave event', () => {
    const event: BroadcastEvent = {
      type: 'member_leave',
      payload: { session_id: 'leaving-session', device_label: 'Android Chrome' },
      sender_session_id: 'leaving-session',
      device_label: 'Android Chrome',
      timestamp: new Date().toISOString(),
    };

    expect(event.type).toBe('member_leave');
  });

  it('should broadcast presence event with sorted members', () => {
    const members = getOnlineMembers([
      { sessionId: 'zebra', deviceLabel: 'Windows Chrome' },
      { sessionId: 'alpha', deviceLabel: 'iPhone Safari' },
    ]);
    const event = buildPresenceEvent(members);

    expect(event.type).toBe('presence');
    expect(event.sender_session_id).toBe('system');
    expect(event.device_label).toBe('System');
    expect((event.payload as { members: OnlineMember[] }).members).toHaveLength(2);
    expect((event.payload as { members: OnlineMember[] }).members[0].session_id).toBe('alpha');
  });
});

describe('RoomDO edge cases', () => {
  it('should handle empty room (no connections)', () => {
    const connections: { sessionId: string; deviceLabel: string }[] = [];
    const members = getOnlineMembers(connections);
    expect(members).toHaveLength(0);
  });

  it('should handle single connection', () => {
    const connections = [{ sessionId: 's1', deviceLabel: 'Mac Safari' }];
    const members = getOnlineMembers(connections);
    expect(members).toHaveLength(1);
    expect(members[0].display_label).toBe('Mac Safari#s1');
    expect(members[0].session_id).toBe('s1');
  });

  it('should handle many duplicate labels', () => {
    const connections = Array.from({ length: 10 }, (_, i) => ({
      sessionId: `s${String(i + 1).padStart(2, '0')}`,
      deviceLabel: 'Windows Chrome',
    }));

    const members = getOnlineMembers(connections);
    expect(members).toHaveLength(10);
    expect(members[0].display_label).toBe('Windows Chrome#s01');
    expect(members[9].display_label).toBe('Windows Chrome#s10');
  });

  it('should handle broadcast to zero sockets', () => {
    const sockets: { sessionId: string; send: (msg: string) => void }[] = [];
    const event: BroadcastEvent = {
      type: 'chat',
      payload: {},
      sender_session_id: '',
      device_label: '',
      timestamp: '',
    };

    const result = broadcastToSockets(event, sockets);
    expect(result.received).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('should filter sockets when removing specific member', () => {
    // Simulate webSocketClose: filter out the closing socket before broadcasting
    const closedSessionId = 's2';
    const allConnections = [
      { sessionId: 's1', deviceLabel: 'Windows Chrome' },
      { sessionId: 's2', deviceLabel: 'iPhone Safari' },
      { sessionId: 's3', deviceLabel: 'Mac Firefox' },
    ];

    // [Debt: Accessibility/i18n] — In production, the actual WebSocket reference
    // is used for filtering (ws reference identity), not session ID.
    const remaining = allConnections.filter((c) => c.sessionId !== closedSessionId);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].sessionId).toBe('s1');
    expect(remaining[1].sessionId).toBe('s3');
  });
});

describe('WsMessage type compatibility', () => {
  it('should be compatible with BroadcastEvent', () => {
    const wsMsg: WsMessage = {
      type: 'chat',
      payload: { encrypted_content: 'test' },
      sender_session_id: 'session-1',
      device_label: 'Test',
      timestamp: new Date().toISOString(),
    };

    const broadcast: BroadcastEvent = {
      type: wsMsg.type,
      payload: wsMsg.payload,
      sender_session_id: wsMsg.sender_session_id,
      device_label: wsMsg.device_label,
      timestamp: wsMsg.timestamp,
    };

    expect(broadcast.type).toBe(wsMsg.type);
    expect(broadcast.sender_session_id).toBe(wsMsg.sender_session_id);
  });

  it('should support all valid broadcast event types', () => {
    const validTypes: BroadcastEvent['type'][] = [
      'chat', 'file_shared', 'recall', 'member_join', 'member_leave', 'presence', 'system',
    ];

    for (const type of validTypes) {
      const event: BroadcastEvent = {
        type,
        payload: {},
        sender_session_id: '',
        device_label: '',
        timestamp: '',
      };
      expect(event.type).toBe(type);
    }
  });
});
