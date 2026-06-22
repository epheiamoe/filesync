/**
 * File download proxy handlers.
 *
 * GET /api/files/:id/download  — Stream file from R2 with auth + expiry checks
 * GET /api/files/:id/raw       — Stream file with Content-Disposition: inline (browser rendering)
 * GET /api/files/:id/public    — Public file access without authentication
 * GET /api/files/:id/info      — Return file metadata without streaming
 * GET /api/files/room/:roomId  — List files in a room (paginated)
 * DELETE /api/files/:id        — Recall (delete) a file
 *
 * The Worker acts as a proxy for R2 file access, enforcing:
 *   - Authentication (private files require room membership)
 *   - Expiry checks (expired files return 410)
 *   - Recall checks (recalled files return 410)
 *
 * Private files are stored encrypted in R2. The server does NOT decrypt.
 * Public files are stored unencrypted. Response includes X-File-Encrypted header
 * only for encrypted files so clients know whether to decrypt.
 *
 * @module files/download
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AppContext } from '../types';
import type { FileMetaDTO, FileListResponse } from '@filesync/shared';
import { logAudit } from '../audit/logger';

// ---- Validation Schemas ----

const fileListQuerySchema = z.object({
  type: z.string().optional(),      // mime type filter prefix
  visibility: z.enum(['private', 'public']).optional(),
  cursor: z.string().optional(),    // created_at cursor for pagination
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ---- GET /api/files/:id/download ----

/**
 * Download a file from R2.
 * Auth checks:
 *   - Private files: requires valid session + room membership
 *   - Public files: no auth required (but file must not be expired/recalled)
 *
 * All files are streamed with:
 *   - Content-Type: application/octet-stream (files are encrypted blobs)
 *   - Content-Disposition: attachment (triggers browser download)
 *   - X-File-Encrypted: true (client hint for decryption)
 */
export async function handleFileDownload(c: Context<AppContext>): Promise<Response> {
  const fileId = c.req.param('id');

  if (!fileId) {
    return c.json(
      { success: false, error: 'File ID required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Look up file in D1
  const file = await c.env.DB.prepare(
    `SELECT f.id, f.room_id, f.r2_key, f.encrypted_filename, f.file_size, f.mime_type,
            f.visibility, f.expires_at, f.recalled_at, f.created_at,
            r.room_code
     FROM file_metadata f
     JOIN rooms r ON r.id = f.room_id
     WHERE f.id = ?`
  ).bind(fileId).first<{
    id: string;
    room_id: string;
    r2_key: string;
    encrypted_filename: string;
    file_size: number;
    mime_type: string;
    visibility: string;
    expires_at: string;
    recalled_at: string | null;
    created_at: string;
    room_code: string;
  }>();

  if (!file) {
    return c.json(
      { success: false, error: 'File not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Check if recalled
  if (file.recalled_at) {
    return c.json(
      { success: false, error: 'File has been recalled', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Check if expired
  if (new Date(file.expires_at) < new Date()) {
    // Lazy cleanup: delete from R2 and mark as recalled
    try {
      await c.env.FILES.delete(file.r2_key);
      await c.env.DB.prepare(
        'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), fileId).run();
    } catch {
      // Best-effort cleanup
    }
    return c.json(
      { success: false, error: 'File has expired', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Auth check for private files
  if (file.visibility === 'private') {
    const sessionToken = c.get('sessionToken') || '';
    const session = c.get('session');

    if (!session) {
      return c.json(
        { success: false, error: 'Authentication required for private files', code: 'UNAUTHORIZED' },
        401
      );
    }

    // Verify room membership
    const membership = await c.env.DB.prepare(
      'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
    ).bind(file.room_id, sessionToken).first();

    if (!membership) {
      return c.json(
        { success: false, error: 'You are not a member of this file\'s room', code: 'FORBIDDEN' },
        403
      );
    }
  }

  // Stream file from R2
  try {
    const r2Object = await c.env.FILES.get(file.r2_key);

    if (!r2Object) {
      return c.json(
        { success: false, error: 'File data not found in storage', code: 'NOT_FOUND' },
        404
      );
    }

    // Determine Content-Disposition: use attachment for non-browser-viewable types
    const browserViewableTypes = ['image/', 'video/', 'audio/', 'text/', 'application/pdf'];
    const isBrowserViewable = browserViewableTypes.some((t) => file.mime_type.startsWith(t));
    const isPublic = file.visibility === 'public';

    const headers = new Headers();
    // Write R2-stored HTTP metadata first (sets Content-Type, Content-Length, etc.)
    r2Object.writeHttpMetadata(headers);
    // Then override with the correct MIME type from our database.
    // R2 stores 'application/octet-stream' during multipart upload, which
    // would break browser rendering for image/text/PDF files if not overridden.
    headers.set('Content-Type', file.mime_type);
    headers.set('Content-Disposition', isBrowserViewable ? 'inline' : 'attachment');
    // Always set X-File-Encrypted: all files are client-encrypted before upload
    headers.set('X-File-Encrypted', 'true');
    headers.set('X-File-Id', fileId);
    headers.set('Cache-Control', isPublic ? 'public, max-age=60' : 'private, max-age=60');

    if (r2Object.size) {
      headers.set('Content-Length', r2Object.size.toString());
    }


    return new Response(r2Object.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('R2 get failed:', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Storage temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }
}

// ---- GET /api/files/:id/info ----

/**
 * Get file metadata without downloading the file.
 * Same auth checks as download.
 */
export async function handleFileInfo(c: Context<AppContext>): Promise<Response> {
  const fileId = c.req.param('id');

  if (!fileId) {
    return c.json(
      { success: false, error: 'File ID required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const file = await c.env.DB.prepare(
    `SELECT f.id, f.room_id, f.uploader_session_id, f.r2_key, f.encrypted_filename,
            f.encrypted_meta, f.file_size, f.mime_type, f.visibility,
            f.expires_at, f.recalled_at, f.created_at
     FROM file_metadata f
     WHERE f.id = ?`
  ).bind(fileId).first<{
    id: string;
    room_id: string;
    uploader_session_id: string;
    r2_key: string;
    encrypted_filename: string;
    encrypted_meta: string | null;
    file_size: number;
    mime_type: string;
    visibility: string;
    expires_at: string;
    recalled_at: string | null;
    created_at: string;
  }>();

  if (!file) {
    return c.json(
      { success: false, error: 'File not found', code: 'NOT_FOUND' },
      404
    );
  }

  if (file.recalled_at) {
    return c.json(
      { success: false, error: 'File has been recalled', code: 'FILE_EXPIRED' },
      410
    );
  }

  if (new Date(file.expires_at) < new Date()) {
    return c.json(
      { success: false, error: 'File has expired', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Auth check for private files
  if (file.visibility === 'private') {
    const sessionToken = c.get('sessionToken') || '';
    const session = c.get('session');

    if (!session) {
      return c.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        401
      );
    }

    const membership = await c.env.DB.prepare(
      'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
    ).bind(file.room_id, sessionToken).first();

    if (!membership) {
      return c.json(
        { success: false, error: 'Not a member of this file\'s room', code: 'FORBIDDEN' },
        403
      );
    }
  }

  const isPublic = file.visibility === 'public';

  const fileMeta: FileMetaDTO = {
    id: file.id,
    room_id: file.room_id,
    uploader_session_id: file.uploader_session_id,
    encrypted_filename: file.encrypted_filename,
    encrypted_meta: file.encrypted_meta || '',
    file_size: file.file_size,
    mime_type: file.mime_type,
    visibility: file.visibility as FileMetaDTO['visibility'],
    encrypted: !isPublic, // public files are unencrypted, private files are encrypted
    expires_at: file.expires_at,
    recalled_at: file.recalled_at || undefined,
    created_at: file.created_at,
    r2_key: file.r2_key,
  };

  return c.json({ success: true, data: fileMeta }, 200);
}

// ---- GET /api/files/room/:roomId ----

/**
 * List files in a room (paginated by cursor).
 * Requires room membership (files are encrypted so only members can use the data).
 */
export async function handleRoomFilesList(c: Context<AppContext>): Promise<Response> {
  const roomId = c.req.param('roomId');

  if (!roomId) {
    return c.json(
      { success: false, error: 'Room ID required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const query = c.req.query();
  const parsed = fileListQuerySchema.safeParse(query);
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

  const { type, visibility, cursor, limit } = parsed.data;
  const sessionToken = c.get('sessionToken') || '';

  // Verify room exists
  const room = await c.env.DB.prepare(
    'SELECT id, deleted_at FROM rooms WHERE id = ?'
  ).bind(roomId).first<{ id: string; deleted_at: string | null }>();

  if (!room || room.deleted_at) {
    return c.json(
      { success: false, error: 'Room not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Verify membership
  const membership = await c.env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
  ).bind(roomId, sessionToken).first();

  if (!membership) {
    return c.json(
      { success: false, error: 'Not a member of this room', code: 'FORBIDDEN' },
      403
    );
  }

  // Build query with filters
  let sql = `SELECT f.id, f.room_id, f.uploader_session_id, f.encrypted_filename,
                    f.encrypted_meta, f.file_size, f.mime_type, f.visibility,
                    f.expires_at, f.recalled_at, f.created_at, f.r2_key
             FROM file_metadata f
             WHERE f.room_id = ? AND f.recalled_at IS NULL AND f.expires_at > datetime('now')`;

  const params: unknown[] = [roomId];

  if (type) {
    sql += ` AND f.mime_type LIKE ?`;
    params.push(`${type.split('/')[0] || type}%`);
  }

  if (visibility) {
    sql += ` AND f.visibility = ?`;
    params.push(visibility);
  }

  if (cursor) {
    sql += ` AND f.created_at < ?`;
    params.push(cursor);
  }

  sql += ` ORDER BY f.created_at DESC LIMIT ?`;
  params.push(limit + 1); // +1 to detect hasMore

  const stmt = c.env.DB.prepare(sql);
  const result = await stmt.bind(...params).all<{
    id: string;
    room_id: string;
    uploader_session_id: string;
    encrypted_filename: string;
    encrypted_meta: string | null;
    file_size: number;
    mime_type: string;
    visibility: string;
    expires_at: string;
    recalled_at: string | null;
    created_at: string;
    r2_key: string | null;
  }>();

  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const files = hasMore ? rows.slice(0, limit) : rows;

  const fileDTOs: FileMetaDTO[] = files.map((f) => ({
    id: f.id,
    room_id: f.room_id,
    uploader_session_id: f.uploader_session_id,
    encrypted_filename: f.encrypted_filename,
    encrypted_meta: f.encrypted_meta || '',
    file_size: f.file_size,
    mime_type: f.mime_type,
    visibility: f.visibility as FileMetaDTO['visibility'],
    encrypted: f.visibility !== 'public', // public files are unencrypted, private files are encrypted
    expires_at: f.expires_at,
    recalled_at: f.recalled_at || undefined,
    created_at: f.created_at,
    r2_key: f.r2_key || undefined,
  }));

  const response: FileListResponse = {
    files: fileDTOs,
    cursor: hasMore && fileDTOs.length > 0 ? fileDTOs[fileDTOs.length - 1].created_at : null,
  };

  return c.json({ success: true, data: response }, 200);
}

// ---- DELETE /api/files/:id ----

/**
 * Recall (delete) a file.
 * 1. Verify file exists and uploader matches (or admin scope)
 * 2. Delete R2 object
 * 3. Mark as recalled in D1
 * 4. Decrement usage stats
 * 5. Broadcast file_recalled via RoomDO
 */
export async function handleFileRecall(c: Context<AppContext>): Promise<Response> {
  const fileId = c.req.param('id');

  if (!fileId) {
    return c.json(
      { success: false, error: 'File ID required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  const sessionToken = c.get('sessionToken') || '';
  const session = c.get('session');

  // Look up file
  const file = await c.env.DB.prepare(
    `SELECT f.id, f.room_id, f.uploader_session_id, f.r2_key, f.file_size,
            f.recalled_at, r.room_code
     FROM file_metadata f
     JOIN rooms r ON r.id = f.room_id
     WHERE f.id = ?`
  ).bind(fileId).first<{
    id: string;
    room_id: string;
    uploader_session_id: string;
    r2_key: string;
    file_size: number;
    recalled_at: string | null;
    room_code: string;
  }>();

  if (!file) {
    return c.json(
      { success: false, error: 'File not found', code: 'NOT_FOUND' },
      404
    );
  }

  if (file.recalled_at) {
    return c.json(
      { success: false, error: 'File has already been recalled', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Authorization: uploader or admin
  const isAdmin = session?.account_type === 'admin';
  const isUploader = file.uploader_session_id === sessionToken;

  if (!isAdmin && !isUploader) {
    return c.json(
      { success: false, error: 'Only the uploader or an admin can recall this file', code: 'FORBIDDEN' },
      403
    );
  }

  const now = new Date().toISOString();

  // Delete R2 object
  try {
    await c.env.FILES.delete(file.r2_key);
  } catch (err) {
    console.error('R2 delete failed during file recall:', err);
    // [Debt: structured logging]
    // Continue — we still mark as recalled in D1
  }

  // Mark as recalled in D1
  await c.env.DB.prepare(
    'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
  ).bind(now, fileId).run();

  // Decrement usage stats
  await c.env.DB.prepare(
    `UPDATE usage_stats
     SET total_bytes = MAX(0, total_bytes - ?),
         file_count = MAX(0, file_count - 1),
         updated_at = ?
     WHERE room_id = ?`
  ).bind(file.file_size, now, file.room_id).run();

  const userAgent = c.req.header('User-Agent') ?? undefined;
  await logAudit(c.env, {
    action: 'file_recalled',
    actor_type: session?.account_type ?? 'anonymous',
    actor_id: sessionToken,
    target_type: 'file',
    target_id: fileId,
    ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || undefined,
    user_agent: userAgent,
    details: {
      room_id: file.room_id,
      initiated_by_admin: isAdmin,
      initiated_by_uploader: isUploader,
    },
  });

  // Broadcast recall via RoomDO
  try {
    const doId = c.env.RoomDO.idFromName(file.room_code);
    const roomStub = c.env.RoomDO.get(doId);

    const recallEvent = {
      type: 'recall' as const,
      payload: {
        file_id: fileId,
        id: fileId,         // Backward compat: some clients check payload.id
        message_id: '',     // Explicitly empty — this is a file recall, not message
      },
      sender_session_id: sessionToken,
      device_label: '',
      timestamp: now,
    };

    await roomStub.fetch(new URL('http://do/internal/broadcast'), {
      method: 'POST',
      body: JSON.stringify(recallEvent),
    });
  } catch (err) {
    console.error('Failed to broadcast file_recalled via DO:', err);
    // [Debt: structured logging]
  }

  return c.json(
    { success: true, data: { success: true } },
    200
  );
}

// ---- GET /api/files/:id/raw ----

/**
 * Stream a file with Content-Disposition: inline for browser rendering.
 *
 * Unlike the /download endpoint which triggers a download, this endpoint
 * is designed for inline display (images, text, PDFs in the browser).
 *
 * Same auth checks as download: private files require room membership.
 * Public (unencrypted) files do NOT include the X-File-Encrypted header.
 */
export async function handleRawFile(c: Context<AppContext>): Promise<Response> {
  const fileId = c.req.param('id');

  if (!fileId) {
    return c.json(
      { success: false, error: 'File ID required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Look up file in D1
  const file = await c.env.DB.prepare(
    `SELECT f.id, f.room_id, f.r2_key, f.encrypted_filename, f.file_size, f.mime_type,
            f.visibility, f.expires_at, f.recalled_at, f.created_at,
            r.room_code
     FROM file_metadata f
     JOIN rooms r ON r.id = f.room_id
     WHERE f.id = ?`
  ).bind(fileId).first<{
    id: string;
    room_id: string;
    r2_key: string;
    encrypted_filename: string;
    file_size: number;
    mime_type: string;
    visibility: string;
    expires_at: string;
    recalled_at: string | null;
    created_at: string;
    room_code: string;
  }>();

  if (!file) {
    return c.json(
      { success: false, error: 'File not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Check if recalled
  if (file.recalled_at) {
    return c.json(
      { success: false, error: 'File has been recalled', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Check if expired
  if (new Date(file.expires_at) < new Date()) {
    // Lazy cleanup: delete from R2 and mark as recalled
    try {
      await c.env.FILES.delete(file.r2_key);
      await c.env.DB.prepare(
        'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), fileId).run();
    } catch {
      // Best-effort cleanup
    }
    return c.json(
      { success: false, error: 'File has expired', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Auth check for private files
  const isPublic = file.visibility === 'public';

  if (!isPublic) {
    const sessionToken = c.get('sessionToken') || '';
    const session = c.get('session');

    if (!session) {
      return c.json(
        { success: false, error: 'Authentication required for private files', code: 'UNAUTHORIZED' },
        401
      );
    }

    // Verify room membership
    const membership = await c.env.DB.prepare(
      'SELECT id FROM room_members WHERE room_id = ? AND session_id = ?'
    ).bind(file.room_id, sessionToken).first();

    if (!membership) {
      return c.json(
        { success: false, error: 'You are not a member of this file\'s room', code: 'FORBIDDEN' },
        403
      );
    }
  }

  // Stream file from R2
  try {
    const r2Object = await c.env.FILES.get(file.r2_key);

    if (!r2Object) {
      return c.json(
        { success: false, error: 'File data not found in storage', code: 'NOT_FOUND' },
        404
      );
    }

    const headers = new Headers();
    // Write R2-stored HTTP metadata first (sets Content-Type, Content-Length, etc.)
    r2Object.writeHttpMetadata(headers);
    // Then override with the correct MIME type from our database.
    // R2 stores 'application/octet-stream' during multipart upload, which
    // would break browser rendering for image/text/PDF files if not overridden.
    headers.set('Content-Type', file.mime_type);
    // Always use inline for the raw endpoint (browser rendering)
    headers.set('Content-Disposition', 'inline');
    // Always set X-File-Encrypted: all files are client-encrypted before upload
    headers.set('X-File-Encrypted', 'true');
    headers.set('X-File-Id', fileId);
    headers.set('Cache-Control', 'private, max-age=60');

    if (r2Object.size) {
      headers.set('Content-Length', r2Object.size.toString());
    }


    return new Response(r2Object.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('R2 get failed (raw):', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Storage temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }
}

// ---- GET /api/files/:id/public ----

/**
 * Public file access endpoint — NO authentication required.
 *
 * This endpoint bypasses the auth middleware (see index.ts auth skip logic).
 * Only files with visibility='public' can be accessed.
 * Recalled or expired files return 410.
 *
 * Response includes CORS header for cross-origin embedding.
 * No X-File-Encrypted header (public files are unencrypted).
 */
export async function handlePublicFile(c: Context<AppContext>): Promise<Response> {
  const fileId = c.req.param('id');

  if (!fileId) {
    return c.json(
      { success: false, error: 'File ID required', code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Look up file in D1
  const file = await c.env.DB.prepare(
    `SELECT f.id, f.room_id, f.r2_key, f.file_size, f.mime_type,
            f.visibility, f.expires_at, f.recalled_at
     FROM file_metadata f
     WHERE f.id = ?`
  ).bind(fileId).first<{
    id: string;
    room_id: string;
    r2_key: string;
    file_size: number;
    mime_type: string;
    visibility: string;
    expires_at: string;
    recalled_at: string | null;
  }>();

  if (!file) {
    return c.json(
      { success: false, error: 'File not found', code: 'NOT_FOUND' },
      404
    );
  }

  // Public files only — reject private files with 403
  if (file.visibility !== 'public') {
    return c.json(
      { success: false, error: 'This file is not publicly accessible', code: 'FORBIDDEN' },
      403
    );
  }

  // Check if recalled
  if (file.recalled_at) {
    return c.json(
      { success: false, error: 'File has been recalled', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Check if expired
  if (new Date(file.expires_at) < new Date()) {
    // Lazy cleanup
    try {
      await c.env.FILES.delete(file.r2_key);
      await c.env.DB.prepare(
        'UPDATE file_metadata SET recalled_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), fileId).run();
    } catch {
      // Best-effort cleanup
    }
    return c.json(
      { success: false, error: 'File has expired', code: 'FILE_EXPIRED' },
      410
    );
  }

  // Stream file from R2
  try {
    const r2Object = await c.env.FILES.get(file.r2_key);

    if (!r2Object) {
      return c.json(
        { success: false, error: 'File data not found in storage', code: 'NOT_FOUND' },
        404
      );
    }

    // Determine Content-Disposition: use attachment for non-browser-viewable types
    const browserViewableTypes = ['image/', 'video/', 'audio/', 'text/', 'application/pdf'];
    const isBrowserViewable = browserViewableTypes.some((t) => file.mime_type.startsWith(t));

    const headers = new Headers();
    // Write R2-stored HTTP metadata first (sets Content-Type, Content-Length, etc.)
    r2Object.writeHttpMetadata(headers);
    // Then override with the correct MIME type from our database.
    // R2 stores 'application/octet-stream' during multipart upload, which
    // would break browser rendering for image/text/PDF files if not overridden.
    headers.set('Content-Type', file.mime_type);
    headers.set('Content-Disposition', isBrowserViewable ? 'inline' : 'attachment');
    headers.set('X-File-Id', fileId);
    // Public files are also client-encrypted before upload; always set this header
    headers.set('X-File-Encrypted', 'true');
    // Allow cross-origin access for public files (embedding on external sites)
    headers.set('Access-Control-Allow-Origin', '*');
    // Short cache for public files to prevent CDN caching of expired content
    // max-age=30, must-revalidate ensures browsers revalidate frequently
    headers.set('Cache-Control', 'public, max-age=30, must-revalidate');

    if (r2Object.size) {
      headers.set('Content-Length', r2Object.size.toString());
    }


    return new Response(r2Object.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('R2 get failed (public):', err);
    // [Debt: structured logging]
    return c.json(
      { success: false, error: 'Storage temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }
}
