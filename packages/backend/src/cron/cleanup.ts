/**
 * Scheduled cleanup handler — runs every hour via Wrangler Cron Triggers.
 *
 * Cleanup items:
 *   a. Expired files (R2 delete + D1 mark recalled_at)
 *   b. Inactive rooms (24h+ since last_active_at → soft delete + cascade)
 *   c. Expired burn-after-reading messages (D1 hard delete)
 *   d. Expired temp credentials (D1 audit revoke; KV entries auto-expire via TTL)
 *   e. Orphan R2 objects (lightweight check — list unreferenced R2 objects)
 *
 * The room inactivity TTL is configurable via KV key `config:roomTtlHours` (default 24h).
 *
 * All operations are best-effort: individual failures are caught and logged,
 * and the handler continues to the next item.
 *
 * @module cron/cleanup
 */

import type { AppEnv } from '../types';

export interface CleanupResult {
  expiredFiles: number;
  destroyedRooms: number;
  expiredMessages: number;
  cleanedCredentials: number;
  orphanedObjects: number;
}

/**
 * Main scheduled handler entry point.
 * Called by the Worker's `scheduled()` export.
 *
 * @param env - Worker environment with DB, FILES, KV bindings
 * @returns CleanupResult with counts of cleaned items
 */
export async function handleScheduled(env: AppEnv): Promise<CleanupResult> {
  const now = new Date().toISOString();

  // Read configurable room TTL from KV (default: 24 hours)
  let roomTtlHours = 24;
  try {
    const ttlConfig = await env.KV.get('config:roomTtlHours');
    if (ttlConfig) {
      const parsed = parseInt(ttlConfig, 10);
      if (parsed >= 1 && parsed <= 720) { // 1 hour to 30 days
        roomTtlHours = parsed;
      }
    }
  } catch {
    // Default to 24h if KV read fails
  }

  const cutoff = new Date(Date.now() - roomTtlHours * 60 * 60 * 1000).toISOString();

  let expiredFiles = 0;
  let destroyedRooms = 0;
  let expiredMessages = 0;
  let cleanedCredentials = 0;
  let orphanedObjects = 0;

  // ---- a. Clean expired files ----
  try {
    const expiredFileRows = await env.DB.prepare(
      `SELECT fm.id, fm.r2_key, fm.file_size, fm.room_id, r.room_code
       FROM file_metadata fm
       JOIN rooms r ON r.id = fm.room_id
       WHERE fm.expires_at < ? AND fm.recalled_at IS NULL`
    ).bind(now).all<{ id: string; r2_key: string; file_size: number; room_id: string; room_code: string }>();

    for (const row of expiredFileRows.results || []) {
      try {
        // Delete from R2
        try { await env.FILES.delete(row.r2_key); } catch { /* object may already be gone */ }

        // Mark recalled in D1
        await env.DB.prepare(
          'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
        ).bind(now, row.id).run();

        // Decrement usage stats
        try {
          await env.DB.prepare(
            `UPDATE usage_stats
             SET total_bytes = MAX(0, total_bytes - ?),
                 file_count = MAX(0, file_count - 1),
                 updated_at = ?
             WHERE room_id = ?`
          ).bind(row.file_size, now, row.room_id).run();
        } catch { /* usage_stats may not have row for this room */ }

        expiredFiles++;

        // Broadcast file_expired via RoomDO so online clients can remove the file card.
        try {
          const doId = env.RoomDO.idFromName(row.room_code);
          const roomStub = env.RoomDO.get(doId);
          const expiredEvent = {
            type: 'file_expired' as const,
            payload: { id: row.id, room_id: row.room_id },
            sender_session_id: 'system',
            device_label: 'System',
            timestamp: now,
          };
          await roomStub.fetch(new URL('http://do/internal/broadcast'), {
            method: 'POST',
            body: JSON.stringify(expiredEvent),
          });
        } catch {
          // Broadcast is best-effort — deletion already succeeded.
        }
      } catch (err) {
        console.error('Failed to clean expired file:', row.id, err);
      }
    }
  } catch (err) {
    console.error('Failed to query expired files:', err);
  }

  // ---- b. Destroy inactive rooms ----
  try {
    let inactiveRooms;
    try {
      // Try with last_active_at column (post-migration)
      inactiveRooms = await env.DB.prepare(
        `SELECT id, room_code
         FROM rooms
         WHERE deleted_at IS NULL
           AND last_active_at IS NOT NULL
           AND last_active_at < ?`
      ).bind(cutoff).all<{ id: string; room_code: string }>();
    } catch {
      // last_active_at column doesn't exist yet — skip room cleanup
      inactiveRooms = { results: [] };
    }

    for (const room of inactiveRooms.results || []) {
      try {
        // Cascade: delete all R2 files for this room
        const roomFiles = await env.DB.prepare(
          'SELECT id, r2_key, file_size FROM file_metadata WHERE room_id = ? AND recalled_at IS NULL'
        ).bind(room.id).all<{ id: string; r2_key: string; file_size: number }>();

        for (const f of roomFiles.results || []) {
          try { await env.FILES.delete(f.r2_key); } catch { /* best effort */ }
          await env.DB.prepare(
            'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
          ).bind(now, f.id).run();
        }

        // Delete all messages
        await env.DB.prepare(
          'DELETE FROM messages WHERE room_id = ?'
        ).bind(room.id).run();

        // Delete room members
        await env.DB.prepare(
          'DELETE FROM room_members WHERE room_id = ?'
        ).bind(room.id).run();

        // Soft-delete the room
        await env.DB.prepare(
          'UPDATE rooms SET deleted_at = ? WHERE id = ?'
        ).bind(now, room.id).run();

        // Delete usage stats
        await env.DB.prepare(
          'DELETE FROM usage_stats WHERE room_id = ?'
        ).bind(room.id).run();

        destroyedRooms++;
      } catch (err) {
        console.error('Failed to destroy inactive room:', room.id, err);
      }
    }
  } catch (err) {
    console.error('Failed to query inactive rooms:', err);
  }

  // ---- c. Delete expired burn-after-reading messages ----
  try {
    // SELECT first to know which messages to broadcast, then DELETE.
    let expiredMsgRows: { id: string; room_id: string; room_code: string }[] = [];
    try {
      expiredMsgRows = (await env.DB.prepare(
        `SELECT m.id, m.room_id, r.room_code
         FROM messages m
         JOIN rooms r ON r.id = m.room_id
         WHERE m.expires_at IS NOT NULL AND m.expires_at < ?`
      ).bind(now).all<{ id: string; room_id: string; room_code: string }>()).results || [];
    } catch {
      // expires_at column may not exist yet
    }

    // Delete expired messages
    let expireResult;
    try {
      expireResult = await env.DB.prepare(
        `DELETE FROM messages
         WHERE expires_at IS NOT NULL AND expires_at < ?`
      ).bind(now).run();
    } catch {
      // expires_at column doesn't exist yet
      expireResult = { meta: { changes: 0 } };
    }
    expiredMessages = (expireResult as any).meta?.changes || 0;

    // Broadcast message_expired to each room via RoomDO
    for (const row of expiredMsgRows) {
      try {
        const doId = env.RoomDO.idFromName(row.room_code);
        const roomStub = env.RoomDO.get(doId);
        const expiredEvent = {
          type: 'message_expired' as const,
          payload: { id: row.id, room_id: row.room_id },
          sender_session_id: 'system',
          device_label: 'System',
          timestamp: now,
        };
        await roomStub.fetch(new URL('http://do/internal/broadcast'), {
          method: 'POST',
          body: JSON.stringify(expiredEvent),
        });
      } catch {
        // Broadcast is best-effort — deletion already succeeded.
      }
    }
  } catch (err) {
    console.error('Failed to delete expired messages:', err);
  }

  // ---- d. Clean expired temp credentials ----
  // Mark expired, unused temp credentials as revoked in D1 audit table.
  // KV entries for tempcred auto-expire via TTL, so no manual KV cleanup needed.
  try {
    const credResult = await env.DB.prepare(
      `UPDATE credential_audit
       SET revoked_at = ?
       WHERE type = 'temp_credential'
         AND expires_at < ?
         AND revoked_at IS NULL
         AND used_at IS NULL`
    ).bind(now, now).run();

    cleanedCredentials = (credResult as any).meta?.changes || 0;
  } catch (err) {
    console.error('Failed to clean expired credentials:', err);
  }

  // ---- e. Orphan R2 cleanup (lightweight) ----
  // Full orphan detection requires R2 object listing, which is complex and rate-limited.
  // For MVP, we skip this. R2 lifecycle rules can be used as a complementary approach.
  // [Debt: MVP] Implement full orphan R2 cleanup via R2 lifecycle rules or a dedicated job.
  orphanedObjects = 0;

  return {
    expiredFiles,
    destroyedRooms,
    expiredMessages,
    cleanedCredentials,
    orphanedObjects,
  };
}
