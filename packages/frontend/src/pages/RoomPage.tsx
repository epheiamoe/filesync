/**
 * RoomPage — Main room view with Chat and Transfer tabs.
 *
 * Two-tab layout with Claude-style tab design.
 * Fetches room info, connects WebSocket, manages E2EE decryption.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText, hashKey, storeRoomKey, decodeShareString } from '@/lib/crypto';
import { parseDeviceLabel } from '@/lib/device';
import { RoomSocket } from '@/lib/ws';
import { TabBar } from '@/components/ui/TabBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ChatPage } from '@/components/chat/ChatPage';
import { TransferPage } from '@/components/transfer/TransferPage';
import type { MessageDTO, OnlineMember } from '@/lib/store';

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

  // Load room info — auto-join with cached key, or prompt for key input
  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError('');
    setNeedsKey(false);

    const initRoom = async () => {
      // Check if we have a cached key for this room
      let roomKey = getRoomKey(code);

      // If no cached key, check session storage for a just-entered key
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

      // If we have the key, auto-join
      if (roomKey) {
        setJoining(true);
        try {
          const keyHash = await hashKey(roomKey);
          const deviceLabel = parseDeviceLabel();
          await api.joinRoom(code, keyHash, deviceLabel);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          // 403/409 means already a member (ok) or key mismatch
          if (!msg.includes('already') && !msg.includes('member')) {
            setError(msg || t('rooms.keyMismatch'));
            setLoading(false);
            setJoining(false);
            return;
          }
        }
        setJoining(false);
      } else {
        // No key cached — show key input prompt
        setNeedsKey(true);
        setLoading(false);
        return;
      }

      // Now load room info and messages
      try {
        const roomInfo = await api.getRoomInfo(code);
        setCurrentRoom({
          id: roomInfo.id,
          roomCode: roomInfo.room_code,
          createdAt: roomInfo.created_at,
          memberCount: roomInfo.member_count,
        });

        // Load messages
        const msgRes = await api.getMessages(roomInfo.id);
        setMessages(msgRes.messages);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.error');
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    initRoom();
  }, [code, setCurrentRoom, setMessages]);

  // Handle key input form submission
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

      // Reload — now with the key cached, the effect above will auto-join
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
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('rooms.invalidShareString');
      setError(message);
      setJoining(false);
    }
  };

  // Connect WebSocket
  useEffect(() => {
    if (!code || !session?.token) return;

    const socket = new RoomSocket(code, session.token);
    setWs(socket);

    socket.onMessage((event) => {
      switch (event.type) {
        case 'chat': {
          const msg = event.payload as MessageDTO;
          addMessage(msg);
          break;
        }
        case 'recall': {
          const payload = event.payload as { message_id: string };
          removeMessage(payload.message_id);
          break;
        }
        case 'file_shared': {
          const file = event.payload as unknown as Parameters<typeof addFile>[0];
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
  }, [code, session?.token, addMessage, removeMessage, addFile, setOnlineMembers]);

  // Decrypt messages as they arrive
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

  const tabs = [
    { key: 'chat', label: t('chat.title') },
    { key: 'transfer', label: t('transfer.title') },
  ];

  if (loading || joining) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-muted">{joining ? t('rooms.joining') : t('common.loading')}</p>
      </div>
    );
  }

  // Key input prompt — shown when no cached key available
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

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
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
            {/* Online badge */}
            {onlineMembers.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <span className="w-2 h-2 rounded-full bg-success" />
                {onlineMembers.length} {t('rooms.online')}
              </span>
            )}
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

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ x: activeTab === 'chat' ? -20 : 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: activeTab === 'chat' ? 20 : -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          >
            {activeTab === 'chat' ? (
              <ChatPage
                roomId={currentRoom.id}
                roomCode={code!}
                messages={messages}
                decryptedMessages={decryptedMessages}
              />
            ) : (
              <TransferPage
                roomId={currentRoom.id}
                roomCode={code!}
                files={files}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
