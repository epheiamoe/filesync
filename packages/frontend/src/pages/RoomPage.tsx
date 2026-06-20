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
import { getRoomKey, decryptText } from '@/lib/crypto';
import { RoomSocket } from '@/lib/ws';
import { TabBar } from '@/components/ui/TabBar';
import { Button } from '@/components/ui/Button';
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
  const [error, setError] = useState('');
  const [ws, setWs] = useState<RoomSocket | null>(null);
  const [decryptedMessages, setDecryptedMessages] = useState<Map<string, string>>(new Map());

  // Load room info
  useEffect(() => {
    if (!code) return;
    setLoading(true);

    const loadRoom = async () => {
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

    loadRoom();
  }, [code, setCurrentRoom, setMessages]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Spinner size="lg" />
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
