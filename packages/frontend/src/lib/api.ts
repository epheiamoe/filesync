/**
 * filesync API Client — Typed fetch wrapper for Worker API.
 *
 * Auto-attaches Authorization header, handles 401 redirects,
 * and provides typed methods for all API endpoints.
 *
 * @module api
 */

import type {
  LoginRequest,
  LoginResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  RoomInfo,
  CreateTempCredentialRequest,
  CreateTempCredentialResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  AdminStats,
  AdminRoomRow,
  DestroyRoomResponse,
  DestroyAllRoomsResponse,
  SendMessageRequest,
  SendMessageResponse,
  ChatMessagesResponse,
  DeleteMessageResponse,
  UploadInitRequest,
  UploadInitResponse,
  UploadPartResponse,
  UploadCompleteRequest,
  UploadCompleteResponse,
  AbortUploadResponse,
  FileMetaDTO,
  FileListResponse,
  ApiResponse,
  WsTicketResponse,
} from '@shared/types';
import { getOrCreateClientFingerprint } from './crypto';

// ---- Auth state access (injected at runtime) ----
let getToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function setTokenGetter(fn: () => string | null): void {
  getToken = fn;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// ---- Base fetch ----

// API base URL is controlled by the VITE_API_BASE_URL environment variable.
// In development, Vite proxies requests to the local backend on /api.
// In production builds, VITE_API_BASE_URL must be set; otherwise the build
// throws so users never accidentally deploy against a stale hardcoded domain.
const BASE_URL: string = import.meta.env.DEV
  ? '/api'
  : import.meta.env.VITE_API_BASE_URL ||
    (() => {
      throw new Error(
        'Missing required environment variable VITE_API_BASE_URL. ' +
          'Set it in your Cloudflare Pages production environment variables or local .env file.',
      );
    })();

/**
 * Returns the API base URL — for use in direct URL construction
 * (e.g., window.open for files/raw). In dev, returns '/api';
 * in production, returns the full Workers API URL.
 */
export function getApiBaseUrl(): string {
  return BASE_URL;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { headers?: Record<string, string>; rawResponse?: boolean },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options?.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // 30s timeout to prevent infinite hangs on network issues
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (fetchErr: unknown) {
    clearTimeout(timeoutId);
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', '请求超时，请检查网络连接');
    }
    throw new ApiError(0, 'NETWORK_ERROR', fetchErr instanceof Error ? fetchErr.message : '网络错误');
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired or invalid');
  }

  if (!res.ok) {
    // Try to parse error response
    let errorData: ApiResponse | null = null;
    try {
      errorData = await res.json();
    } catch {
      // fall through
    }
    const message = errorData?.error || `HTTP ${res.status}`;
    const code = errorData?.code || 'UNKNOWN_ERROR';
    throw new ApiError(res.status, code, message);
  }

  if (options?.rawResponse) {
    return res as unknown as T;
  }

  const data = await res.json();
  return data as T;
}

// ---- Public API ----

export const api = {
  // === Auth ===
  async login(method: LoginRequest['method'], credentials: Record<string, string>): Promise<LoginResponse> {
    const body: LoginRequest = { method, ...credentials } as LoginRequest;
    const res = await request<ApiResponse<LoginResponse>>('POST', '/auth/login', body);
    return res.data!;
  },

  async logout(): Promise<void> {
    await request<ApiResponse<{ success: boolean }>>('POST', '/auth/logout');
  },

  async validateSession(): Promise<{ valid: boolean; account_type?: string; scope?: string }> {
    const res = await request<ApiResponse<{ valid: boolean; account_type?: string; scope?: string }>>('GET', '/auth/session');
    return res.data!;
  },

  async createTempCredential(label?: string): Promise<CreateTempCredentialResponse> {
    const body: CreateTempCredentialRequest = { label };
    const res = await request<ApiResponse<CreateTempCredentialResponse>>('POST', '/auth/credentials', body);
    return res.data!;
  },

  async listCredentials(): Promise<ApiResponse> {
    return request<ApiResponse>('GET', '/auth/credentials');
  },

  async revokeCredential(id: string): Promise<void> {
    await request<ApiResponse>('DELETE', `/auth/credentials/${id}`);
  },

  async createApiKey(label: string): Promise<CreateApiKeyResponse> {
    const body: CreateApiKeyRequest = { label };
    const res = await request<ApiResponse<CreateApiKeyResponse>>('POST', '/auth/api-keys', body);
    return res.data!;
  },

  async revokeApiKey(keyHash: string): Promise<void> {
    await request<ApiResponse>('DELETE', `/auth/api-keys/${keyHash}`);
  },

  // === Rooms ===
  async createRoom(keyHash: string, roomCode?: string): Promise<CreateRoomResponse> {
    const body: CreateRoomRequest = { key_hash: keyHash, room_code: roomCode };
    const res = await request<ApiResponse<CreateRoomResponse>>('POST', '/rooms', body);
    return res.data!;
  },

  async joinRoom(roomCode: string, keyHash: string, deviceLabel?: string): Promise<JoinRoomResponse> {
    // client_fingerprint is sent as an extra field — the shared type will be updated by impl-3.
    // Cast through unknown to avoid TS errors while impl-3 schema migration is pending.
    const body = {
      room_code: roomCode,
      key_hash: keyHash,
      device_label: deviceLabel,
      client_fingerprint: getOrCreateClientFingerprint(),
    } as JoinRoomRequest;
    const res = await request<ApiResponse<JoinRoomResponse>>('POST', '/rooms/join', body);
    return res.data!;
  },

  async getRoomInfo(code: string): Promise<RoomInfo> {
    const res = await request<ApiResponse<RoomInfo>>('GET', `/rooms/${code}`);
    return res.data!;
  },

  async listRooms(fingerprint?: string): Promise<RoomInfo[]> {
    const params = fingerprint ? `?client_fingerprint=${encodeURIComponent(fingerprint)}` : '';
    const res = await request<ApiResponse<{ rooms: RoomInfo[] }>>('GET', `/rooms${params}`);
    return res.data!.rooms;
  },

  async destroyRoom(roomCode: string): Promise<DestroyRoomResponse> {
    const res = await request<ApiResponse<DestroyRoomResponse>>('DELETE', `/admin/rooms/${roomCode}`);
    return res.data!;
  },

  // === Chat ===
  async getMessages(roomId: string, cursor?: string): Promise<ChatMessagesResponse> {
    const params = new URLSearchParams({ room_id: roomId });
    if (cursor) params.set('before', cursor);
    params.set('limit', '50');
    const res = await request<ApiResponse<ChatMessagesResponse>>('GET', `/chat/messages?${params}`);
    return res.data!;
  },

  async sendMessage(roomId: string, encryptedContent: string, messageType?: string, deviceLabel?: string, ttlSeconds?: number): Promise<SendMessageResponse> {
    const body: SendMessageRequest = {
      room_id: roomId,
      encrypted_content: encryptedContent,
      message_type: messageType as SendMessageRequest['message_type'],
      device_label: deviceLabel,
      ttl_seconds: ttlSeconds,
    };
    const res = await request<ApiResponse<SendMessageResponse>>('POST', '/chat/messages', body);
    return res.data!;
  },

  async recallMessage(messageId: string, roomId: string): Promise<DeleteMessageResponse> {
    const res = await request<ApiResponse<DeleteMessageResponse>>('DELETE', `/chat/messages/${messageId}`, { room_id: roomId });
    return res.data!;
  },

  // === Files ===
  async initUpload(
    filename: string,
    totalSize: number,
    chunkSize: number,
    roomId: string,
    visibility?: string,
    expiresAt?: string,
  ): Promise<UploadInitResponse> {
    const body: UploadInitRequest = {
      filename,
      total_size: totalSize,
      chunk_size: chunkSize,
      room_id: roomId,
      visibility: visibility as UploadInitRequest['visibility'],
      expires_at: expiresAt,
    };
    const res = await request<ApiResponse<UploadInitResponse>>('POST', '/files/upload/init', body);
    return res.data!;
  },

  async uploadPart(uploadId: string, partNumber: number, chunk: ArrayBuffer): Promise<UploadPartResponse> {
    const formData = new FormData();
    formData.append('upload_id', uploadId);
    formData.append('part_number', String(partNumber));
    formData.append('chunk', new Blob([chunk]));
    const res = await request<ApiResponse<UploadPartResponse>>('POST', '/files/upload/part', formData);
    return res.data!;
  },

  async completeUpload(
    uploadId: string,
    r2Key: string,
    parts: { etag: string; part_number: number }[],
    encryptedFilename: string,
    fileSize: number,
    mimeType: string,
    visibility: string,
    expiresAt: string,
    roomId: string,
    encryptedMeta?: string,
  ): Promise<UploadCompleteResponse> {
    const body: UploadCompleteRequest = {
      upload_id: uploadId,
      r2_key: r2Key,
      parts,
      encrypted_filename: encryptedFilename,
      encrypted_meta: encryptedMeta,
      file_size: fileSize,
      mime_type: mimeType,
      visibility: visibility as UploadCompleteRequest['visibility'],
      expires_at: expiresAt,
      room_id: roomId,
    };
    const res = await request<ApiResponse<UploadCompleteResponse>>('POST', '/files/upload/complete', body);
    return res.data!;
  },

  async abortUpload(uploadId: string): Promise<AbortUploadResponse> {
    const res = await request<ApiResponse<AbortUploadResponse>>('POST', '/files/upload/abort', { upload_id: uploadId });
    return res.data!;
  },

  async getFilesList(roomId: string, filter?: { type?: string; visibility?: string; cursor?: string }): Promise<FileListResponse> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.visibility) params.set('visibility', filter.visibility);
    if (filter?.cursor) params.set('cursor', filter.cursor);
    const res = await request<ApiResponse<FileListResponse>>('GET', `/files/room/${roomId}?${params}`);
    return res.data!;
  },

  async downloadFile(fileId: string): Promise<Response> {
    return request<Response>('GET', `/files/${fileId}/download`, undefined, { rawResponse: true });
  },

  async getFileRaw(fileId: string): Promise<Response> {
    return request<Response>('GET', `/files/${fileId}/raw`, undefined, { rawResponse: true });
  },

  async getFileInfo(fileId: string): Promise<FileMetaDTO> {
    const res = await request<ApiResponse<FileMetaDTO>>('GET', `/files/${fileId}/info`);
    return res.data!;
  },

  async recallFile(fileId: string): Promise<void> {
    await request<ApiResponse>('DELETE', `/files/${fileId}`);
  },

  // === Admin ===
  async getAdminStats(): Promise<AdminStats> {
    const res = await request<ApiResponse<AdminStats>>('GET', '/admin/stats');
    return res.data!;
  },

  async getAdminRooms(): Promise<AdminRoomRow[]> {
    const res = await request<ApiResponse<{ rooms: AdminRoomRow[] }>>('GET', '/admin/rooms');
    return res.data!.rooms;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request<ApiResponse<{ success: boolean }>>('PUT', '/admin/password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  async destroyAllRooms(): Promise<DestroyAllRoomsResponse> {
    const res = await request<ApiResponse<DestroyAllRoomsResponse>>('DELETE', '/admin/rooms');
    return res.data!;
  },

  // === WebSocket ===
  async getWsTicket(roomCode: string): Promise<WsTicketResponse> {
    const token = getToken();
    const res = await request<ApiResponse<WsTicketResponse>>('GET', `/ws?room=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token || '')}`);
    return res.data!;
  },

  // === Health ===
  async health(): Promise<{ status: string; timestamp: string }> {
    const res = await request<ApiResponse<{ status: string; timestamp: string }>>('GET', '/health');
    return res.data!;
  },
};

export { ApiError };
