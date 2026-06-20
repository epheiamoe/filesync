/**
 * epheia-files API Worker — Main entry point.
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
import { handleFileDownload, handleFileInfo, handleRoomFilesList, handleFileRecall } from './files/download';

// ---- Chat ----
import { handleSendMessage, handleGetMessages, handleRecallMessage } from './chat/messages';

// ---- WebSocket ----
import { handleWsTicket, handleWsConnect } from './ws/handler';

// ---- Admin ----
import { handleAdminStats, handleAdminRooms } from './admin/stats';
import { handleDestroyRoom } from './admin/rooms';

// ---- DO (must be exported for wrangler) ----
export { RoomDO } from './do/room';

// ---- Create App ----
const app = new Hono<AppContext>();

// ---- CORS Middleware ----
// Allow all origins for development; restrict in production.
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-File-Encrypted', 'X-File-Id'],
  maxAge: 86400,
}));

// ---- Auth Middleware ----
// Extracts Bearer token from Authorization header, validates against KV,
// and attaches session + sessionToken to context.
// Applied to all routes except /api/auth/login and /api/ws/connect
app.use('/api/*', async (c, next) => {
  // Skip auth for login endpoint and WS connect (uses ticket-based auth)
  if (c.req.path === '/api/auth/login') {
    return next();
  }

  // Skip auth for WS connect — it uses ticket validation instead
  if (c.req.path === '/api/ws/connect') {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Allow OPTIONS (CORS preflight) without auth
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    return c.json(
      { success: false, error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' },
      401
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return c.json(
      { success: false, error: 'Empty token', code: 'UNAUTHORIZED' },
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
app.delete('/api/admin/rooms/:code', handleDestroyRoom);

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
