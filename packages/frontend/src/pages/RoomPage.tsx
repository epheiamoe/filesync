/**
 * RoomPage — Main room view with Chat and Transfer tabs.
 *
 * Features:
 * - Two-tab layout with shared bottom input bar (Telegram-style)
 * - Whole-page drag-drop for file upload
 * - Optimistic message display (appears immediately, deduplicated with WS)
 * - Combined messages+files timeline in Chat view
 */

import { useState, useEffect, useCallback, useRef, type DragEvent, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText, hashKey, storeRoomKey, decodeShareString, encryptText, encryptFile, encodeShareString } from '@/lib/crypto';
import { parseDeviceLabel } from '@/lib/device';
import { RoomSocket } from '@/lib/ws';
import { TabBar } from '@/components/ui/TabBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ChatPage } from '@/components/chat/ChatPage';
import { ChatInput } from '@/components/chat/ChatInput';
import { TransferPage } from '@/components/transfer/TransferPage';
import { UploadProgress } from '@/components/transfer/UploadProgress';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { QRShare } from '@/components/shared/QRShare';
import type { MessageDTO, OnlineMember, FileMetaDTO } from '@/lib/store';

// ---- Upload task tracking (same shape as UploadZone) ----

interface UploadTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'encrypting' | 'complete' | 'error';
  error?: string;
}

const CHUNK_SIZE_SMALL = 5 * 1024 * 1024; // 5MB for files <= 100MB
const CHUNK_SIZE_LARGE = 10 * 1024 * 1024; // 10MB for files > 100MB

export function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const {
    session,
    currentRoom,
    setCurrentRoom,
    messages,
    setMessages,
    addMessage,
    removeMessage,
    addFile,
    files,
    setOnlineMembers,
    onlineMembers,
  } = useStore();

  const [activeTab, setActiveTab] = useState('chat');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [ws, setWs] = useState<RoomSocket | null>(null);
  const [decryptedMessages, setDecryptedMessages] = useState<Map<string, string>>(new Map());
  const [sending, setSending] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadIsPublic, setUploadIsPublic] = useState(false);
  const [uploadTTLMinutes, setUploadTTLMinutes] = useState(10);
  const [roomReady, setRoomReady] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // ---- Room loading (unchanged core logic) ----

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError('');
    setNeedsKey(false);

    const initRoom = async () => {
      let roomKey = getRoomKey(code);
      if (!roomKey) {
        const sessionKey = sessionStorage.getItem(`join_key_${code}`);
        if (sessionKey) {
          try {
            roomKey = decodeShareString(sessionKey)?.key ?? null;
            if (roomKey) {
              storeRoomKey(code, roomKey);
              sessionStorage.removeItem(`join_key_${code}`);
            }
          } catch { /* ignore */ }
        }
      }

      if (roomKey) {
        setJoining(true);
        try {
          const keyHash = await hashKey(roomKey);
          const deviceLabel = parseDeviceLabel();
          await api.joinRoom(code, keyHash, deviceLabel);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          if (!msg.includes('already') && !msg.includes('member')) {
            setError(msg || t('rooms.keyMismatch'));
            setLoading(false);
            setJoining(false);
            return;
          }
        }
        setJoining(false);
      } else {
        setNeedsKey(true);
        setLoading(false);
        return;
      }

      try {
        const roomInfo = await api.getRoomInfo(code);
        setCurrentRoom({
          id: roomInfo.id,
          roomCode: roomInfo.room_code,
          createdAt: roomInfo.created_at,
          memberCount: roomInfo.member_count,
        });

        const msgRes = await api.getMessages(roomInfo.id);
        setMessages(msgRes.messages);

        // Load existing files via HTTP as a fallback/reconciliation layer.
        // WebSocket file_shared broadcasts handle real-time additions,
        // but may miss historical files after reconnect or for late joiners.
        try {
          const fileRes = await api.getFilesList(roomInfo.id);
          // Merge with any files that may have already arrived via WS.
          // Use functional update to avoid race conditions.
          useStore.setState((state) => {
            const existingIds = new Set(state.files.map((f) => f.id));
            const newFiles = fileRes.files.filter((f) => !existingIds.has(f.id));
            if (newFiles.length === 0) return state;
            return { files: [...state.files, ...newFiles] };
          });
        } catch {
          // Non-critical: files will still arrive via WS file_shared events
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.error');
        setError(message);
      } finally {
        setLoading(false);
        setRoomReady(true);
      }
    };

    initRoom();
  }, [code, setCurrentRoom, setMessages]);

  // ---- Key input form ----

  const handleKeySubmit = async () => {
    if (!code || !keyInput.trim()) return;
    setJoining(true);
    setError('');
    try {
      const decoded = decodeShareString(keyInput.trim());
      if (!decoded || decoded.roomCode !== code) {
        setError(t('rooms.invalidShareString'));
        setJoining(false);
        return;
      }
      const keyHash = await hashKey(decoded.key);
      const deviceLabel = parseDeviceLabel();
      await api.joinRoom(code, keyHash, deviceLabel);
      storeRoomKey(code, decoded.key);

      setNeedsKey(false);
      setJoining(false);
      setLoading(true);
      setKeyInput('');

      const roomInfo = await api.getRoomInfo(code);
      setCurrentRoom({
        id: roomInfo.id,
        roomCode: roomInfo.room_code,
        createdAt: roomInfo.created_at,
        memberCount: roomInfo.member_count,
      });
      const msgRes = await api.getMessages(roomInfo.id);
      setMessages(msgRes.messages);

      // Load existing files via HTTP as a fallback (same as initRoom above)
      try {
        const fileRes = await api.getFilesList(roomInfo.id);
        useStore.setState((state) => {
          const existingIds = new Set(state.files.map((f) => f.id));
          const newFiles = fileRes.files.filter((f) => !existingIds.has(f.id));
          if (newFiles.length === 0) return state;
          return { files: [...state.files, ...newFiles] };
        });
      } catch {
        // Non-critical
      }

      setRoomReady(true);
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('rooms.invalidShareString');
      setError(message);
      setJoining(false);
      setLoading(false);
    }
  };

  // ---- WebSocket connection ----

  useEffect(() => {
    if (!code || !session?.token) return;
    if (!roomReady) return;

    const socket = new RoomSocket(code, session.token);
    setWs(socket);

    socket.onMessage((event) => {
      switch (event.type) {
        case 'chat': {
          const msg = event.payload as MessageDTO;
          // Deduplication is handled by store.addMessage (idempotent by ID)
          // If room_id is missing from broadcast, inject from current room context
          if (!msg.room_id) msg.room_id = currentRoom?.id || '';
          addMessage(msg);
          break;
        }
        case 'recall': {
          const payload = event.payload as { message_id?: string; id?: string };
          // Support both old (message_id) and new (id) field names for recall
          const targetId = payload.message_id || payload.id || '';
          if (targetId) removeMessage(targetId);
          break;
        }
        case 'file_shared': {
          const file = event.payload as unknown as FileMetaDTO;
          // If room_id is missing from broadcast, inject from current room context
          if (!file.room_id) file.room_id = currentRoom?.id || '';
          addFile(file);
          break;
        }
      }
    });

    socket.onMemberUpdate((members: OnlineMember[]) => {
      setOnlineMembers(members);
    });

    socket.connect();

    return () => {
      socket.close();
    };
  }, [code, session?.token, roomReady, addMessage, removeMessage, addFile, setOnlineMembers]);

  // ---- Decrypt messages as they arrive ----

  useEffect(() => {
    if (!code) return;
    const key = getRoomKey(code);
    if (!key) return;

    const decryptNewMessages = async () => {
      const newDecrypted = new Map(decryptedMessages);
      for (const msg of messages) {
        if (!newDecrypted.has(msg.id) && msg.encrypted_content) {
          try {
            const plaintext = await decryptText(key, msg.encrypted_content);
            newDecrypted.set(msg.id, plaintext);
          } catch {
            newDecrypted.set(msg.id, `[${t('e2ee.decryptError')}]`);
          }
        }
      }
      setDecryptedMessages(newDecrypted);
    };

    decryptNewMessages();
  }, [messages, code]);

  // ---- Shared Send Handler (BUG 1 fix: optimistic local add) ----

  const handleSend = useCallback(async (text: string): Promise<boolean> => {
    if (!text.trim() || !code || !currentRoom || !session) return false;
    setSending(true);

    try {
      const key = getRoomKey(code);
      if (!key) throw new Error(t('e2ee.encryptError'));

      const encrypted = await encryptText(key, text);
      const deviceLabel = parseDeviceLabel();

      const res = await api.sendMessage(currentRoom.id, encrypted, 'text', deviceLabel);

      // Add message to local store immediately.
      // Uses the server-assigned message_id so that when the WebSocket
      // broadcast arrives with the same ID, store.addMessage deduplicates it.
      const newMsg: MessageDTO = {
        id: res.message_id,
        room_id: currentRoom.id,
        sender_session_id: session.token,
        encrypted_content: encrypted,
        message_type: 'text',
        device_label: deviceLabel,
        created_at: res.created_at,
      };
      addMessage(newMsg);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      console.error('[RoomPage] Failed to send message:', err);
      useStore.getState().addToast({
        type: 'error',
        message: `${t('chat.sendFailed')}: ${message}`,
      });
      return false;
    } finally {
      setSending(false);
    }
  }, [code, currentRoom, session, addMessage]);

  // ---- Shared File Upload Handler (used by input bar and drag-drop) ----

  const handleFileUpload = useCallback(
    async (fileList: FileList | File[]) => {
      if (!code) return;
      const key = getRoomKey(code);
      if (!key || !currentRoom) {
        useStore.getState().addToast({ type: 'error', message: t('e2ee.encryptError') });
        return;
      }

      const fileArray = Array.from(fileList);
      if (fileArray.length === 0) return;

      const totalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > 5 * 1024 * 1024 * 1024) {
        useStore.getState().addToast({ type: 'error', message: t('transfer.maxSize') });
        return;
      }

      for (const file of fileArray) {
        const taskId = crypto.randomUUID();
        const task: UploadTask = {
          id: taskId,
          name: file.name,
          size: file.size,
          progress: 0,
          status: 'encrypting',
        };

        setUploadTasks((prev) => [...prev, task]);

        try {
          const fileBuffer = await file.arrayBuffer();
          setUploadTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: 'uploading' } : t)),
          );

          const encrypted = await encryptFile(key, fileBuffer);
          const encryptedFilename = await encryptText(key, file.name);

          const chunkSize = file.size <= 100 * 1024 * 1024 ? CHUNK_SIZE_SMALL : CHUNK_SIZE_LARGE;
          const expiresAt = new Date(Date.now() + uploadTTLMinutes * 60 * 1000).toISOString();
          const visibility = uploadIsPublic ? 'public' : 'private';
          const initRes = await api.initUpload(
            file.name,
            encrypted.byteLength,
            chunkSize,
            currentRoom.id,
            visibility,
            expiresAt,
          );

          const totalChunks = Math.ceil(encrypted.byteLength / chunkSize);
          const parts: { etag: string; part_number: number }[] = [];

          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, encrypted.byteLength);
            const chunk = encrypted.slice(start, end);
            const partRes = await api.uploadPart(initRes.upload_id, i + 1, chunk);
            parts.push({ etag: partRes.etag, part_number: partRes.part_number });

            setUploadTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? { ...t, progress: Math.round(((i + 1) / totalChunks) * 90) }
                  : t,
              ),
            );
          }

          const completeRes = await api.completeUpload(
            initRes.upload_id,
            initRes.r2_key,
            parts,
            encryptedFilename,
            encrypted.byteLength,
            file.type || 'application/octet-stream',
            visibility,
            expiresAt,
            currentRoom.id,
          );

          // BUG FIX 1A: Immediately add file to store so it appears in both views
          const fileMeta: FileMetaDTO = {
            id: completeRes.file_id,
            room_id: currentRoom.id,
            uploader_session_id: session?.token || '',
            encrypted_filename: encryptedFilename,
            encrypted_meta: '',
            file_size: encrypted.byteLength,
            mime_type: file.type || 'application/octet-stream',
            visibility: visibility as FileMetaDTO['visibility'],
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          };
          addFile(fileMeta);

          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, status: 'complete', progress: 100 } : t,
            ),
          );

          setTimeout(() => {
            setUploadTasks((prev) => prev.filter((t) => t.id !== taskId));
          }, 3000);

          useStore.getState().addToast({ type: 'success', message: `${file.name} ${t('transfer.upload')}` });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.error');
          setUploadTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: 'error', error: message } : t)),
          );
          useStore.getState().addToast({ type: 'error', message: `${file.name}: ${message}` });
        }
      }
    },
    [code, currentRoom, uploadTTLMinutes, uploadIsPublic],
  );

  // ---- File input ref for the shared input bar ----

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
      e.target.value = '';
    }
  };

  // ---- Whole-page drag-drop (BUG 5) ----

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // ---- Tab config ----

  const tabs = [
    { key: 'chat', label: t('chat.title') },
    { key: 'transfer', label: t('transfer.title') },
  ];

  // ---- Loading / Joining state ----

  if (loading || joining) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-muted">{joining ? t('rooms.joining') : t('common.loading')}</p>
      </div>
    );
  }

  // ---- Key input prompt ----

  if (needsKey) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-center max-w-sm">
          <h2 className="text-title-lg font-display text-ink mb-2">{t('rooms.enterKeyTitle')}</h2>
          <p className="text-sm text-muted mb-4">{t('rooms.enterKeyDesc', { code: code! })}</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <Input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={t('rooms.shareKeyPlaceholder')}
            className="w-full"
            onKeyDown={(e) => e.key === 'Enter' && handleKeySubmit()}
            autoFocus
          />
          <Button variant="primary" onClick={handleKeySubmit} loading={joining}>
            {t('rooms.join')}
          </Button>
          {error && <p className="text-sm text-error text-center" role="alert">{error}</p>}
        </div>
        <Button variant="ghost" onClick={() => navigate('/rooms')}>
          {t('common.back')}
        </Button>
      </div>
    );
  }

  // ---- Error / Not found ----

  if (error || !currentRoom) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4">
        <p className="text-error">{error || t('rooms.roomNotFound')}</p>
        <Button variant="secondary" onClick={() => navigate('/rooms')}>
          {t('common.back')}
        </Button>
      </div>
    );
  }

  // ---- Main Room View ----

  return (
    <div
      className="min-h-screen bg-canvas flex flex-col relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-over overlay */}
      <AnimatePresence>
        {isDraggingOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-primary/10 border-4 border-dashed border-primary pointer-events-none flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="text-center text-primary">
              <svg
                className="w-16 h-16 mx-auto mb-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 3v14m0 0l-4-4m4 4l4-4M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
              </svg>
              <p className="text-lg font-medium">{t('transfer.dragDrop')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Room Header */}
      <header className="sticky top-0 z-10 bg-canvas/80 backdrop-blur-sm border-b border-hairline">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/rooms')}
              aria-label={t('common.back')}
            >
              ←
            </Button>
            <code className="text-display-sm font-display text-ink">
              {currentRoom.roomCode}
            </code>
            {onlineMembers.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <span className="w-2 h-2 rounded-full bg-success" />
                {onlineMembers.length} {t('rooms.online')}
              </span>
            )}
            {(() => {
              const key = getRoomKey(code!);
              if (!key) return null;
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                  aria-label={t('rooms.share')}
                  title={t('rooms.share')}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="w-5 h-5"
                  >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </Button>
              );
            })()}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/rooms')}
          >
            {t('rooms.leave')}
          </Button>
        </div>

        {/* Tab Bar */}
        <div className="max-w-5xl mx-auto px-4 pb-2">
          <TabBar
            tabs={tabs}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
        </div>
      </header>

      {/* Content — both ChatPage and TransferPage always mounted.
           Visibility controlled by CSS to avoid AnimatePresence unmounting
           which caused message loss and decrypted content reset on tab switch. */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4">
        <div className="relative">
          {/* Chat tab */}
          <div
            className={
              activeTab === 'chat'
                ? 'block'
                : 'hidden'
            }
            aria-hidden={activeTab !== 'chat'}
          >
            <ErrorBoundary>
              <ChatPage
                roomId={currentRoom.id}
                roomCode={code!}
                messages={messages}
                files={files}
                decryptedMessages={decryptedMessages}
                sessionToken={session?.token || ''}
              />
            </ErrorBoundary>
          </div>

          {/* Transfer tab */}
          <div
            className={
              activeTab === 'transfer'
                ? 'block'
                : 'hidden'
            }
            aria-hidden={activeTab !== 'transfer'}
          >
            <ErrorBoundary>
              <TransferPage
                roomId={currentRoom.id}
                roomCode={code!}
                files={files}
                messages={messages}
                decryptedMessages={decryptedMessages}
              />
            </ErrorBoundary>
          </div>
        </div>
      </main>

      {/* Shared Bottom Input Bar (BUG 2, 3, 4 fix) */}
      <div className="sticky bottom-0 z-10 bg-canvas/80 backdrop-blur-sm border-t border-hairline">
        <div className="max-w-5xl mx-auto px-4">
          {/* Hidden file input for the shared bar */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
            aria-hidden="true"
          />
          <ChatInput
            onSend={handleSend}
            onFileSelect={(files) => handleFileUpload(files)}
            disabled={sending}
            uploadIsPublic={uploadIsPublic}
            onUploadPublicChange={setUploadIsPublic}
            uploadTTLMinutes={uploadTTLMinutes}
            onUploadTTLChange={setUploadTTLMinutes}
          />
        </div>

        {/* Upload progress display */}
        <AnimatePresence>
          {uploadTasks.length > 0 && (
            <div className="max-w-5xl mx-auto px-4 pb-3 space-y-2">
              {uploadTasks.map((task) => (
                <UploadProgress key={task.id} task={task} />
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* QR Share Modal */}
      {(() => {
        const key = getRoomKey(code!);
        const shareString = key ? encodeShareString(code!, key) : '';
        return (
          <QRShare
            isOpen={shareOpen}
            onClose={() => setShareOpen(false)}
            shareString={shareString}
            roomCode={code!}
          />
        );
      })()}
    </div>
  );
}
