/**
 * Room activity tracking helper.
 *
 * Updates rooms.last_active_at whenever a user performs an action
 * in the room (send message, upload file, join, etc.).
 * This enables the cron cleanup job to detect and auto-destroy
 * inactive rooms.
 *
 * @module rooms/activity
 */

/**
 * Update the last_active_at timestamp for a room.
 * No-op if the room is already deleted.
 *
 * @param db - D1 database binding
 * @param roomId - Room UUID
 */
export async function updateRoomActivity(
  db: D1Database,
  roomId: string
): Promise<void> {
  try {
    await db.prepare(
      `UPDATE rooms SET last_active_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).bind(new Date().toISOString(), roomId).run();
  } catch {
    // Best-effort — activity tracking failure shouldn't block user operations.
    // The room may still be tracked via future updates.
  }
}
