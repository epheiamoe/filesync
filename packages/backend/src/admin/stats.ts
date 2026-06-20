/**
 * Admin statistics endpoint.
 *
 * GET /api/admin/stats  — Global stats aggregation
 * GET /api/admin/rooms  — List all non-deleted rooms with usage stats
 *
 * Requires admin scope (enforced by middleware or handler-level check).
 *
 * @module admin/stats
 */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { AdminStats, AdminRoomRow } from '@epheia-files/shared';

// ---- Helper: Require Admin Scope ----

/**
 * Check if the current session has admin scope.
 * Returns an error Response if not, or null if authorized.
 */
function requireAdmin(c: Context<AppContext>): Response | null {
  const session = c.get('session');
  if (!session || session.account_type !== 'admin') {
    return c.json(
      { success: false, error: 'Admin access required', code: 'FORBIDDEN' },
      403
    );
  }
  return null;
}

// ---- GET /api/admin/stats ----

/**
 * Return global statistics for the admin dashboard.
 *
 * Aggregates:
 *   - R2 total bytes across all active rooms
 *   - R2 file count
 *   - Number of active (non-deleted) rooms
 *   - (active_sessions count is approximate — counts sessions in KV)
 */
export async function handleAdminStats(c: Context<AppContext>): Promise<Response> {
  const forbidden = requireAdmin(c);
  if (forbidden) return forbidden;

  try {
    // Aggregate usage stats for non-deleted rooms
    const usageResult = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(us.total_bytes), 0) as r2_total_bytes,
              COALESCE(SUM(us.file_count), 0) as r2_file_count
       FROM usage_stats us
       JOIN rooms r ON r.id = us.room_id
       WHERE r.deleted_at IS NULL`
    ).first<{ r2_total_bytes: number; r2_file_count: number }>();

    // Count active rooms
    const roomResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM rooms WHERE deleted_at IS NULL`
    ).first<{ count: number }>();

    // Approximate active sessions — count session keys in KV
    // This is inherently approximate since KV listing has limitations.
    // In production, consider a counter D1 table updated on login/logout.
    let activeSessions = 0;
    try {
      const sessionList = await c.env.KV.list({ prefix: 'session:', limit: 1000 });
      activeSessions = sessionList.keys.length;
    } catch {
      // KV listing may fail or be limited; accept approximate value
      activeSessions = -1; // sentinel for "unavailable"
    }

    const stats: AdminStats = {
      r2_total_bytes: usageResult?.r2_total_bytes || 0,
      r2_file_count: usageResult?.r2_file_count || 0,
      room_count: roomResult?.count || 0,
      active_sessions: activeSessions,
    };

    return c.json({ success: true, data: stats }, 200);
  } catch (err) {
    console.error('Admin stats query failed:', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Failed to retrieve stats', code: 'INTERNAL_ERROR' },
      500
    );
  }
}

// ---- GET /api/admin/rooms ----

/**
 * List all non-deleted rooms with usage statistics.
 * Admin-only endpoint for room management dashboard.
 */
export async function handleAdminRooms(c: Context<AppContext>): Promise<Response> {
  const forbidden = requireAdmin(c);
  if (forbidden) return forbidden;

  try {
    const rooms = await c.env.DB.prepare(
      `SELECT r.id, r.room_code, r.created_at,
              COALESCE(us.total_bytes, 0) as total_bytes,
              COALESCE(us.file_count, 0) as file_count,
              COALESCE((SELECT COUNT(*) FROM room_members WHERE room_id = r.id), 0) as member_count
       FROM rooms r
       LEFT JOIN usage_stats us ON us.room_id = r.id
       WHERE r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    ).all<{
      id: string;
      room_code: string;
      created_at: string;
      total_bytes: number;
      file_count: number;
      member_count: number;
    }>();

    const roomRows: AdminRoomRow[] = (rooms.results || []).map((r) => ({
      id: r.id,
      room_code: r.room_code,
      created_at: r.created_at,
      member_count: r.member_count,
      file_count: r.file_count,
      total_bytes: r.total_bytes,
    }));

    return c.json(
      {
        success: true,
        data: { rooms: roomRows },
      },
      200
    );
  } catch (err) {
    console.error('Admin rooms query failed:', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Failed to retrieve rooms', code: 'INTERNAL_ERROR' },
      500
    );
  }
}
