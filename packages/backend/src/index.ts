/**
 * filesync API Worker — Main entry point.
 *
 * Hono app with:
 *   - CORS middleware (allow all origins for dev)
 *   - Auth middleware (extracts Bearer token, validates against KV, attaches session)
 *   - Route modules for auth, rooms, files, chat, admin, and WebSocket
 *
 * @module index
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from './types';

// ---- Auth ----
import { handleLogin } from './auth/login';
import { handleCreateCredential, handleListCredentials, handleRevokeCredential, handleCreateApiKey, handleRevokeApiKey } from './auth/credentials';
import { validateSession, destroySession } from './auth/session';

// ---- Rooms ----
import { handleCreateRoom } from './rooms/create';
import { handleJoinRoom } from './rooms/join';
import { handleListRooms, handleGetRoom } from './rooms/list';

// ---- Files ----
import { handleUploadInit, handleUploadPart, handleUploadComplete, handleUploadAbort } from './files/upload';
import { handleFileDownload, handleFileInfo, handleRoomFilesList, handleFileRecall, handleRawFile, handlePublicFile } from './files/download';

// ---- Chat ----
import { handleSendMessage, handleGetMessages, handleRecallMessage } from './chat/messages';

// ---- WebSocket ----
import { handleWsTicket, handleWsConnect } from './ws/handler';

// ---- Admin ----
import { handleAdminStats, handleAdminRooms } from './admin/stats';
import { handleDestroyRoom, handleDestroyAllRooms } from './admin/rooms';
import { handleChangePassword } from './admin/password';

// ---- DO (must be exported for wrangler) ----
export { RoomDO } from './do/room';

// ---- Create App ----
const app = new Hono<AppContext>();

// ---- CORS Middleware ----
app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-File-Encrypted', 'X-File-Id'],
  credentials: true,
  maxAge: 86400,
}));

// ---- Auth Middleware ----
// Cookie-based auth: reads epheia_session cookie.
// Falls back to Authorization: Bearer header for API/CLI compatibility.
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health') {
    return next();
  }
  if (c.req.path === '/api/ws/connect') {
    return next();
  }
  // Skip auth for public file access
  if (c.req.path.match(/\/api\/files\/[^/]+\/public/)) {
    return next();
  }

  // Priority 1: HttpOnly cookie (browser sessions)
  const cookieHeader = c.req.header('Cookie') || '';
  const cookieMatch = cookieHeader.match(/epheia_session=([^;]+)/);
  let token = cookieMatch ? cookieMatch[1] : null;

  // Priority 2: Authorization header (API/CLI clients)
  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) {
    if (c.req.method === 'OPTIONS') return next();
    return c.json(
      { success: false, error: 'Missing authentication', code: 'UNAUTHORIZED' },
      401
    );
  }

  const session = await validateSession(c.env, token);
  if (!session) {
    return c.json(
      { success: false, error: 'Invalid or expired session', code: 'UNAUTHORIZED' },
      401
    );
  }

  c.set('session', session);
  c.set('sessionToken', token);
  return next();
});

// ---- Auth Routes ----
app.post('/api/auth/login', handleLogin);

app.post('/api/auth/logout', async (c) => {
  const token = c.get('sessionToken') as string;
  if (token) {
    await destroySession(c.env, token);
  }
  // Clear the session cookie
  c.header('Set-Cookie', 'epheia_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0');
  return c.json({ success: true, data: { success: true } });
});

app.get('/api/auth/session', (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ success: true, data: { valid: false } });
  }
  return c.json({
    success: true,
    data: {
      valid: true,
      account_type: session.account_type,
      scope: session.scope,
    },
  });
});

app.post('/api/auth/credentials', handleCreateCredential);
app.get('/api/auth/credentials', handleListCredentials);
app.delete('/api/auth/credentials/:id', handleRevokeCredential);
app.post('/api/auth/api-keys', handleCreateApiKey);
app.delete('/api/auth/api-keys/:keyHash', handleRevokeApiKey);

// ---- Room Routes ----
app.post('/api/rooms', handleCreateRoom);
app.get('/api/rooms', handleListRooms);
app.post('/api/rooms/join', handleJoinRoom);
app.get('/api/rooms/:code', handleGetRoom);

// ---- File Routes ----
// NOTE: More specific routes must be registered BEFORE parameterized routes
// to avoid path conflicts.
app.post('/api/files/upload/init', handleUploadInit);
app.post('/api/files/upload/part', handleUploadPart);
app.post('/api/files/upload/complete', handleUploadComplete);
app.post('/api/files/upload/abort', handleUploadAbort);
app.get('/api/files/room/:roomId', handleRoomFilesList);
// Raw and public endpoints must be registered before the general /:id/download route
// to ensure their distinct path patterns are matched correctly
app.get('/api/files/:id/raw', handleRawFile);
app.get('/api/files/:id/public', handlePublicFile);
app.get('/api/files/:id/download', handleFileDownload);
app.get('/api/files/:id/info', handleFileInfo);
app.delete('/api/files/:id', handleFileRecall);

// ---- Chat Routes ----
app.get('/api/chat/messages', handleGetMessages);
app.post('/api/chat/messages', handleSendMessage);
app.delete('/api/chat/messages/:id', handleRecallMessage);

// ---- WebSocket Routes ----
// Step 1: Request a ticket (requires Bearer auth via middleware)
app.get('/api/ws', handleWsTicket);
// Step 2: Connect with ticket (bypasses auth middleware — uses KV ticket validation)
app.get('/api/ws/connect', handleWsConnect);

// ---- Admin Routes ----
app.get('/api/admin/stats', handleAdminStats);
app.get('/api/admin/rooms', handleAdminRooms);
// Register DELETE /api/admin/rooms BEFORE /api/admin/rooms/:code
// to ensure the literal path is matched before the parameterized one
app.delete('/api/admin/rooms', handleDestroyAllRooms);
app.delete('/api/admin/rooms/:code', handleDestroyRoom);
app.put('/api/admin/password', handleChangePassword);

// ---- Health Check ----
app.get('/api/health', (c) => {
  return c.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// ---- 404 Handler ----
app.notFound((c) => {
  return c.json(
    { success: false, error: 'Not found', code: 'NOT_FOUND' },
    404
  );
});

// ---- Error Handler ----
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
    500
  );
});

// ---- Export ----
export default app;
