// ============================================================
// @epheia-files/shared — All shared TypeScript types
// Used by both backend and frontend packages.
// Changes to this file require orchestrator approval per plan.md.
// ============================================================

// ---- Core Enums ----

/** Login methods supported by the auth system */
export type LoginMethod = 'admin' | 'api_key' | 'temp_credential';

/**
 * Message types for chat messages.
 * NOTE: In D1 schema these are stored as 'text' | 'file_notification' | 'system'.
 *       The API layer uses 'file_shared' for the WebSocket event name.
 *       The wire type 'file_shared' maps to D1 storage value 'file_notification'.
 */
export type MessageType = 'text' | 'file_shared' | 'system';

/** File visibility controls access to download endpoint */
export type FileVisibility = 'private' | 'public';

/** Credential type for audit trail */
export type CredentialType = 'temp_credential' | 'api_key';

// ---- Auth ----

export interface LoginRequest {
  method: LoginMethod;
  username?: string;
  password?: string;
  api_key?: string;
  temp_code?: string;
}

export interface LoginResponse {
  token: string;
  scope: string;
  account_type: string;
  expires_at: string;
}

export interface SessionData {
  account_type: string;
  scope: string;
  admin_id?: string;
}

// ---- Rooms ----

export interface CreateRoomRequest {
  key_hash: string;
  room_code?: string;
}

export interface CreateRoomResponse {
  id: string;
  room_code: string;
}

export interface JoinRoomRequest {
  room_code: string;
  key_hash: string;
  device_label?: string;
}

export interface JoinRoomResponse {
  success: boolean;
  room_id: string;
}

export interface RoomInfo {
  id: string;
  room_code: string;
  created_at: string;
  member_count: number;
}

// ---- Admin ----

export interface CreateTempCredentialRequest {
  label?: string;
}

export interface CreateTempCredentialResponse {
  code: string;
  expires_at: string;
}

export interface CreateApiKeyRequest {
  label: string;
}

export interface CreateApiKeyResponse {
  key: string;
}

export interface AdminStats {
  r2_total_bytes: number;
  r2_file_count: number;
  room_count: number;
  active_sessions: number;
}

// ---- Messages (preview — full types in task_2) ----

export interface MessageDTO {
  id: string;
  room_id: string;
  sender_session_id: string;
  encrypted_content: string;
  message_type: MessageType;
  device_label?: string;
  recalled_at?: string;
  created_at: string;
}

// ---- Files (preview — full types in task_2) ----

export interface FileMetaDTO {
  id: string;
  room_id: string;
  uploader_session_id: string;
  encrypted_filename: string;
  encrypted_meta: string;
  file_size: number;
  mime_type: string;
  visibility: FileVisibility;
  expires_at: string;
  recalled_at?: string;
  created_at: string;
  r2_key?: string;
}

// ---- API Standard Response Wrapper ----

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ---- WebSocket Message Types ----

export interface WsMessage {
  type: 'chat' | 'file_shared' | 'recall' | 'member_join' | 'member_leave' | 'system';
  payload: unknown;
  sender_session_id: string;
  device_label: string;
  timestamp: string;
}
