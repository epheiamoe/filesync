/**
 * R2 multipart file upload handlers.
 *
 * POST /api/files/upload/init     — Start multipart upload (check usage, cleanup expired, create R2 multipart)
 * POST /api/files/upload/part     — Upload a single chunk (multipart/form-data)
 * POST /api/files/upload/complete — Finalize upload (complete multipart, store metadata, update usage, broadcast)
 * POST /api/files/upload/abort    — Cancel an in-progress multipart upload
 *
 * Room R2 limit: 5GB per room. On overflow, oldest files are deleted.
 * Files expire automatically based on expires_at; lazy cleanup on init.
 *
 * NOTE: R2 bucket "filesync" must be manually enabled in Cloudflare Dashboard.
 *       Until then, R2 API calls will fail at runtime.
 *
 * @module files/upload
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { UploadInitResponse } from '@filesync/shared';
import { generateId } from '../utils/id';

// ---- Constants ----

/** Maximum R2 storage per room (5 GB in bytes) */
const ROOM_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Minimum chunk size: 5 MB */
const MIN_CHUNK_SIZE = 5 * 1024 * 1024;

/** Large file chunk size: 10 MB (for files > 100 MB) */
const LARGE_CHUNK_SIZE = 10 * 1024 * 1024;

/** Maximum TTL for a file (1 hour in seconds) */
const MAX_TTL_SECONDS = 3600;

/** Default TTL for a file (10 minutes in seconds) */
const DEFAULT_TTL_SECONDS = 600;

// ---- Validation Schemas ----

const uploadInitSchema = z.object({
  filename: z.string().min(1).max(500),
  total_size: z.number().int().min(1).max(ROOM_MAX_BYTES, 'File exceeds room limit'),
  chunk_size: z.number().int().min(MIN_CHUNK_SIZE),
  room_id: z.string().min(1),
  visibility: z.enum(['private', 'public']).optional().default('private'),
  expires_at: z.string().optional(), // ISO 8601, client-provided expiry
});

const uploadCompleteSchema = z.object({
  upload_id: z.string().min(1),
  r2_key: z.string().min(1),
  parts: z.array(z.object({
    etag: z.string().min(1),
    part_number: z.number().int().min(1),
  })).min(1),
  encrypted_filename: z.string().min(1),
  encrypted_meta: z.string().optional(),
  file_size: z.number().int().min(1),
  mime_type: z.string().min(1).max(255),
  visibility: z.enum(['private', 'public']).optional().default('private'),
  expires_at: z.string().min(1), // ISO 8601
  room_id: z.string().min(1),
});

const abortUploadSchema = z.object({
  upload_id: z.string().min(1),
  r2_key: z.string().min(1),
});

// ---- Utility Functions ----

/**
 * Compute how many chunks are needed for a file upload.
 */
function chunksNeeded(totalSize: number, chunkSize: number): number {
  return Math.ceil(totalSize / chunkSize);
}

/**
 * Calculate the expiry timestamp for a file.
 * If the client provides expires_at, use it (with validation).
 * Otherwise, default to now + DEFAULT_TTL_SECONDS.
 */
function calculateExpiry(requestedExpiry?: string): string {
  if (requestedExpiry) {
    const expDate = new Date(requestedExpiry);
    if (isNaN(expDate.getTime())) {
      // Invalid date — fall back to default
      return new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
    }
    const maxExpiry = new Date(Date.now() + MAX_TTL_SECONDS * 1000);
    if (expDate > maxExpiry) {
      // Exceeds max TTL — cap at max
      return maxExpiry.toISOString();
    }
    return requestedExpiry;
  }
  return new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
}

// ---- POST /api/files/upload/init ----

/**
 * Initialize a multipart R2 upload.
 * 1. Validate room exists and user is a member
 * 2. Check usage_stats — if adding this file would exceed 5GB, delete oldest files first
 * 3. Lazy cleanup of expired files
 * 4. Create R2 multipart upload
 * 5. Return { upload_id, r2_key, chunks_needed }
 */
export async function handleUploadInit(c: Context<AppContext>): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const parsed = uploadInitSchema.safeParse(body);
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

  const { filename, total_size, chunk_size, room_id, visibility, expires_at } = parsed.data;
  const sessionToken = c.get('sessionToken') || '';

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

  // Verify membership
  const membership = await c.env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room_id, sessionToken).first();

  if (!membership) {
    return c.json(
      { success: false, error: 'You are not a member of this room', code: 'FORBIDDEN' },
      403
    );
  }

  // Lazy cleanup: delete expired files before checking usage
  await cleanupExpiredFiles(c.env, room_id);

  // Check current usage
  const stats = await c.env.DB.prepare(
    'SELECT total_bytes, file_count FROM usage_stats WHERE room_id = ?'
  ).bind(room_id).first<{ total_bytes: number; file_count: number }>();

  let currentBytes = stats?.total_bytes || 0;

  // If adding this file would exceed 5GB, delete oldest files until there's room
  if (currentBytes + total_size > ROOM_MAX_BYTES) {
    const neededSpace = (currentBytes + total_size) - ROOM_MAX_BYTES;

    // Find files to delete (oldest first, by created_at ASC)
    const filesToDelete = await c.env.DB.prepare(
      `SELECT id, r2_key, file_size FROM file_metadata
       WHERE room_id = ? AND recalled_at IS NULL
       ORDER BY created_at ASC`
    ).bind(room_id).all<{ id: string; r2_key: string; file_size: number }>();

    let freedSpace = 0;
    for (const file of filesToDelete.results || []) {
      if (freedSpace >= neededSpace) break;

      // Delete from R2
      try {
        await c.env.FILES.delete(file.r2_key);
      } catch {
        // R2 delete failure — skip this file (it may already be gone)
      }

      // Mark as recalled in D1
      await c.env.DB.prepare(
        'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), file.id).run();

      freedSpace += file.file_size;
    }

    // Update usage after deletions
    const newTotal = Math.max(0, currentBytes - freedSpace);
    await c.env.DB.prepare(
      `UPDATE usage_stats
       SET total_bytes = ?, file_count = MAX(0, file_count - ?), updated_at = ?
       WHERE room_id = ?`
    ).bind(
      newTotal,
      Math.min(filesToDelete.results?.length || 0, 1000), // approximate count
      new Date().toISOString(),
      room_id
    ).run();

    currentBytes = newTotal;

    // If still over limit after cleanup, reject
    if (currentBytes + total_size > ROOM_MAX_BYTES) {
      return c.json(
        {
          success: false,
          error: 'Room storage limit (5GB) exceeded. Some files could not be cleaned.',
          code: 'ROOM_OVER_LIMIT',
          current_bytes: currentBytes,
          max_bytes: ROOM_MAX_BYTES,
        },
        413
      );
    }
  }

  // Generate R2 key: rooms/{room_code}/{uuid}_{filename}
  const fileId = generateId();
  const r2_key = `rooms/${room.room_code}/${fileId}_${encodeURIComponent(filename)}`;

  // Create R2 multipart upload
  let uploadId: string;
  try {
    const multipart = await c.env.FILES.createMultipartUpload(r2_key, {
      httpMetadata: {
        contentType: 'application/octet-stream',
      },
      customMetadata: {
        'uploaded-by': sessionToken,
        'room-id': room_id,
        'encrypted': visibility === 'public' ? 'false' : 'true',
      },
    });
    uploadId = multipart.uploadId;
  } catch (err) {
    console.error('R2 createMultipartUpload failed:', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Storage temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }

  // Store upload session in KV for part tracking (24h TTL for cleanup)
  try {
    await c.env.KV.put(
      `upload:${uploadId}`,
      JSON.stringify({
        r2_key,
        room_id,
        total_size,
        chunk_size,
        parts: [],
        created_at: new Date().toISOString(),
      }),
      { expirationTtl: 86400 } // 24h
    );
  } catch {
    // Non-critical — KV tracking failure doesn't block upload
  }

  const response: UploadInitResponse = {
    upload_id: uploadId,
    r2_key,
    chunks_needed: chunksNeeded(total_size, chunk_size),
  };

  return c.json({ success: true, data: response }, 200);
}

// ---- POST /api/files/upload/part ----

/**
 * Upload a single chunk (part) of a multipart R2 upload.
 * Accepts multipart/form-data with: upload_id, part_number, chunk (binary file)
 */
export async function handleUploadPart(c: Context<AppContext>): Promise<Response> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { success: false, error: 'Invalid form data', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const uploadId = formData.get('upload_id') as string | null;
  const partNumberStr = formData.get('part_number') as string | null;
  const chunk = formData.get('chunk') as File | null;

  if (!uploadId || !partNumberStr || !chunk) {
    return c.json(
      { success: false, error: 'upload_id, part_number, and chunk are required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber) || partNumber < 1 || partNumber > 10000) {
    return c.json(
      { success: false, error: 'part_number must be 1-10000', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Retrieve upload session from KV to get r2_key
  let r2_key: string;
  try {
    const uploadSession = await c.env.KV.get(`upload:${uploadId}`);
    if (!uploadSession) {
      return c.json(
        { success: false, error: 'Upload session not found or expired', code: 'NOT_FOUND' },
        404
      );
    }
    const session = JSON.parse(uploadSession) as { r2_key: string };
    r2_key = session.r2_key;
  } catch {
    return c.json(
      { success: false, error: 'Invalid upload session', code: 'NOT_FOUND' },
      404
    );
  }

  // Upload part to R2
  try {
    const multipartUpload = c.env.FILES.resumeMultipartUpload(r2_key, uploadId);
    const chunkData = await chunk.arrayBuffer();
    const uploadedPart = await multipartUpload.uploadPart(partNumber, new Uint8Array(chunkData));

    // Store etag in KV for tracking
    try {
      const rawSession = await c.env.KV.get(`upload:${uploadId}`);
      if (rawSession) {
        const session = JSON.parse(rawSession) as { parts: Array<{ etag: string; part_number: number }> };
        session.parts.push({ etag: uploadedPart.etag, part_number: partNumber });
        await c.env.KV.put(`upload:${uploadId}`, JSON.stringify(session), { expirationTtl: 86400 });
      }
    } catch {
      // Non-critical — parts can be tracked via the complete request
    }

    return c.json(
      {
        success: true,
        data: {
          etag: uploadedPart.etag,
          part_number: partNumber,
        },
      },
      200
    );
  } catch (err) {
    console.error('R2 uploadPart failed:', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Storage temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }
}

// ---- POST /api/files/upload/complete ----

/**
 * Complete a multipart R2 upload.
 * 1. Complete R2 multipart upload with all parts
 * 2. Insert file metadata into D1
 * 3. Update usage_stats (increment total_bytes and file_count)
 * 4. Broadcast file_shared event via RoomDO
 * 5. Clean up KV upload session
 */
export async function handleUploadComplete(c: Context<AppContext>): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const parsed = uploadCompleteSchema.safeParse(body);
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

  const { upload_id, r2_key, parts, encrypted_filename, encrypted_meta, file_size, mime_type, visibility, expires_at, room_id } = parsed.data;
  const now = new Date().toISOString();
  const sessionToken = c.get('sessionToken') || '';

  // Verify room
  const room = await c.env.DB.prepare(
    'SELECT id, room_code, deleted_at FROM rooms WHERE id = ?'
  ).bind(room_id).first<{ id: string; room_code: string; deleted_at: string | null }>();

  if (!room || room.deleted_at) {
    return c.json(
      { success: false, error: 'Room not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Complete multipart upload in R2
  try {
    const multipartUpload = c.env.FILES.resumeMultipartUpload(r2_key, upload_id);
    await multipartUpload.complete(
      parts.map((p) => ({ etag: p.etag, partNumber: p.part_number }))
    );
  } catch (err) {
    console.error('R2 completeMultipartUpload failed:', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Storage temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }

  // Get membership info for device_label
  const membership = await c.env.DB.prepare(
    'SELECT device_label FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(room_id, sessionToken).first<{ device_label: string | null }>();
  const deviceLabel = membership?.device_label || 'Unknown';

  // Insert file metadata into D1
  const fileId = generateId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO file_metadata
       (id, room_id, uploader_session_id, r2_key, encrypted_filename, encrypted_meta,
        file_size, mime_type, visibility, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      fileId, room_id, sessionToken, r2_key, encrypted_filename,
      encrypted_meta || null, file_size, mime_type, visibility,
      expires_at, now
    ).run();

    // Update usage_stats atomically (only if room would stay under limit)
    const updateResult = await c.env.DB.prepare(
      `UPDATE usage_stats
       SET total_bytes = total_bytes + ?, file_count = file_count + 1, updated_at = ?
       WHERE room_id = ? AND total_bytes + ? <= ?`
    ).bind(file_size, now, room_id, file_size, ROOM_MAX_BYTES).run();

    if (updateResult.meta.changes !== 1) {
      // Room would exceed limit — rollback: delete R2 object and DB record
      await c.env.DB.prepare('DELETE FROM file_metadata WHERE id = ?').bind(fileId).run();
      try {
        await c.env.FILES.delete(r2_key);
      } catch {
        // Best effort
      }
      return c.json(
        {
          success: false,
          error: 'Room storage limit (5GB) exceeded. Cannot complete upload.',
          code: 'ROOM_OVER_LIMIT',
        },
        413
      );
    }
  } catch (dbErr) {
    console.error('D1 insert failed during upload complete:', dbErr);
    // [Debt: structured logging]
    // Clean up R2 object
    try {
      await c.env.FILES.delete(r2_key);
    } catch {
      // Best effort
    }
    return c.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      500
    );
  }

  // Broadcast file_shared via RoomDO
  try {
    const doId = c.env.RoomDO.idFromName(room.room_code);
    const roomStub = c.env.RoomDO.get(doId);

    const fileSharedEvent = {
      type: 'file_shared' as const,
      payload: {
        file_id: fileId,
        encrypted_filename,
        file_size,
        mime_type,
        visibility,
        expires_at,
      },
      sender_session_id: sessionToken,
      device_label: deviceLabel,
      timestamp: now,
    };

    await roomStub.fetch(new URL('http://do/internal/broadcast'), {
      method: 'POST',
      body: JSON.stringify(fileSharedEvent),
    });
  } catch (err) {
    console.error('Failed to broadcast file_shared via DO:', err);
    // [Debt: structured logging]
  }

  // Clean up KV upload session
  try {
    await c.env.KV.delete(`upload:${upload_id}`);
  } catch {
    // Non-critical
  }

  return c.json(
    {
      success: true,
      data: {
        file_id: fileId,
      },
    },
    200
  );
}

// ---- POST /api/files/upload/abort ----

/**
 * Abort an in-progress multipart R2 upload.
 * Called by client on upload cancellation or error.
 */
export async function handleUploadAbort(c: Context<AppContext>): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const parsed = abortUploadSchema.safeParse(body);
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

  const { upload_id, r2_key } = parsed.data;

  // Abort R2 multipart upload
  try {
    const multipartUpload = c.env.FILES.resumeMultipartUpload(r2_key, upload_id);
    await multipartUpload.abort();
  } catch (err) {
    console.error('R2 abortMultipartUpload failed:', err);
    // [Debt: structured logging]
    // Non-fatal — continue to clean up KV
  }

  // Clean up KV upload session
  try {
    await c.env.KV.delete(`upload:${upload_id}`);
  } catch {
    // Non-critical
  }

  return c.json(
    { success: true, data: { success: true } },
    200
  );
}

// ---- Lazy File Cleanup ----

/**
 * Clean up expired files for a given room.
 * Files where expires_at < now() AND recalled_at IS NULL are:
 *   - Deleted from R2
 *   - Marked as recalled in D1 (recalled_at set)
 *   - Usage stats decremented
 *
 * Called lazily on upload init and room access.
 * This is a best-effort operation — failures are logged but not returned as errors.
 *
 * @param env - Worker environment with DB and FILES bindings
 * @param roomId - Room ID to clean up
 */
export async function cleanupExpiredFiles(
  env: { DB: D1Database; FILES: R2Bucket },
  roomId: string
): Promise<void> {
  try {
    // Find all expired, non-recalled files for this room
    const expiredFiles = await env.DB.prepare(
      `SELECT id, r2_key, file_size FROM file_metadata
       WHERE room_id = ? AND expires_at < datetime('now') AND recalled_at IS NULL`
    ).bind(roomId).all<{ id: string; r2_key: string; file_size: number }>();

    if (!expiredFiles.results || expiredFiles.results.length === 0) return;

    let cleanedBytes = 0;
    let cleanedCount = 0;

    for (const file of expiredFiles.results) {
      // Delete from R2
      try {
        await env.FILES.delete(file.r2_key);
      } catch {
        // R2 delete may fail if object already gone — continue
      }

      // Mark as recalled in D1
      await env.DB.prepare(
        'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), file.id).run();

      cleanedBytes += file.file_size;
      cleanedCount++;
    }

    // Update usage stats
    if (cleanedCount > 0) {
      await env.DB.prepare(
        `UPDATE usage_stats
         SET total_bytes = MAX(0, total_bytes - ?),
             file_count = MAX(0, file_count - ?),
             updated_at = ?
         WHERE room_id = ?`
      ).bind(cleanedBytes, cleanedCount, new Date().toISOString(), roomId).run();
    }
  } catch (err) {
    // Cleanup is best-effort; log and continue
    console.error('Lazy file cleanup failed:', err);
    // [Debt: structured logging]
  }
}
