/**
 * epheia-files State Management — Zustand store.
 *
 * Centralized state for auth, current room, messages, files,
 * online members, and device label.
 *
 * @module store
 */

import { create } from 'zustand';

export interface SessionInfo {
  token: string;
  accountType: string;
  scope: string;
  expiresAt: string;
}

export interface RoomInfo {
  id: string;
  roomCode: string;
  createdAt: string;
  memberCount: number;
}

export interface MessageDTO {
  id: string;
  room_id: string;
  sender_session_id: string;
  encrypted_content: string;
  message_type: 'text' | 'file_shared' | 'system';
  device_label?: string;
  recalled_at?: string;
  created_at: string;
}

export interface FileMetaDTO {
  id: string;
  room_id: string;
  uploader_session_id: string;
  encrypted_filename: string;
  encrypted_meta?: string;
  file_size: number;
  mime_type: string;
  visibility: 'private' | 'public';
  expires_at: string;
  recalled_at?: string;
  created_at: string;
  r2_key?: string;
}

export interface OnlineMember {
  session_id: string;
  device_label: string;
  display_label: string;
}

export interface AppState {
  // ---- Auth ----
  token: string | null;
  session: SessionInfo | null;
  isAuthenticated: boolean;

  // ---- Current Room ----
  currentRoom: RoomInfo | null;
  messages: MessageDTO[];
  files: FileMetaDTO[];
  onlineMembers: OnlineMember[];

  // ---- Device ----
  deviceLabel: string;

  // ---- UI ----
  toasts: Toast[];

  // ---- Actions ----
  login: (session: SessionInfo) => void;
  logout: () => void;
  setCurrentRoom: (room: RoomInfo | null) => void;
  addMessage: (msg: MessageDTO) => void;
  setMessages: (msgs: MessageDTO[]) => void;
  removeMessage: (id: string) => void;
  addFile: (file: FileMetaDTO) => void;
  setFiles: (files: FileMetaDTO[]) => void;
  removeFile: (id: string) => void;
  setOnlineMembers: (members: OnlineMember[]) => void;
  setDeviceLabel: (label: string) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
}

let toastCounter = 0;

// Restore session from localStorage on page load so auth survives refresh.
// Must read synchronously before first render, avoiding the useEffect timing gap
// where ProtectedRoute would reject before the effect fires.
function loadSavedSession(): SessionInfo | null {
  try {
    const saved = localStorage.getItem('epheia_session');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed.token === 'string' && typeof parsed.accountType === 'string') {
      return parsed as SessionInfo;
    }
    return null;
  } catch {
    return null;
  }
}

const savedSession = loadSavedSession();

export const useStore = create<AppState>((set) => ({
  // ---- Initial State ----
  token: savedSession?.token ?? null,
  session: savedSession,
  isAuthenticated: !!savedSession,
  currentRoom: null,
  messages: [],
  files: [],
  onlineMembers: [],
  deviceLabel: 'Unknown Device',
  toasts: [],

  // ---- Auth Actions ----
  login: (session) => {
    set({
      token: session.token,
      session,
      isAuthenticated: true,
    });
    try {
      localStorage.setItem('epheia_session', JSON.stringify(session));
    } catch {
      // ignore storage errors
    }
  },

  logout: () => {
    set({
      token: null,
      session: null,
      isAuthenticated: false,
      currentRoom: null,
      messages: [],
      files: [],
      onlineMembers: [],
    });
    try {
      localStorage.removeItem('epheia_session');
    } catch {
      // ignore
    }
  },

  // ---- Room Actions ----
  setCurrentRoom: (room) => {
    set({
      currentRoom: room,
      messages: [],
      files: [],
      onlineMembers: [],
    });
  },

  // ---- Message Actions ----
  addMessage: (msg) => {
    set((state) => {
      // Deduplicate by ID — prevents double-add when optimistic local add
      // races with the WebSocket broadcast of the same server-assigned message.
      if (state.messages.some((m) => m.id === msg.id)) {
        return state;
      }
      return { messages: [...state.messages, msg] };
    });
  },

  setMessages: (msgs) => {
    set({ messages: msgs });
  },

  removeMessage: (id) => {
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    }));
  },

  // ---- File Actions ----
  addFile: (file) => {
    set((state) => ({
      files: [...state.files, file],
    }));
  },

  setFiles: (files) => {
    set({ files });
  },

  removeFile: (id) => {
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
    }));
  },

  // ---- Online Members ----
  setOnlineMembers: (members) => {
    set({ onlineMembers: members });
  },

  // ---- Device ----
  setDeviceLabel: (label) => {
    set({ deviceLabel: label });
  },

  // ---- Toasts ----
  addToast: (toast) => {
    const id = `toast-${++toastCounter}`;
    const newToast: Toast = { ...toast, id };
    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));
    if (toast.duration !== 0) {
      setTimeout(() => {
        set((s) => ({
          toasts: s.toasts.filter((t) => t.id !== id),
        }));
      }, toast.duration || 3000);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
