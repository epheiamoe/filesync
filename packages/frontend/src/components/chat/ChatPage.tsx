/**
 * ChatPage — Main chat view with message list, input, and online sidebar.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, encryptText } from '@/lib/crypto';
import { parseDeviceLabel } from '@/lib/device';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type { MessageDTO } from '@/lib/store';

interface ChatPageProps {
  roomId: string;
  roomCode: string;
  messages: MessageDTO[];
  decryptedMessages: Map<string, string>;
}

export function ChatPage({ roomId, roomCode, messages, decryptedMessages }: ChatPageProps) {
  const onlineMembers = useStore((s) => s.onlineMembers);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const handleSend = async (text: string) => {
    if (!text.trim()) return;
    setSending(true);

    try {
      const key = getRoomKey(roomCode);
      if (!key) throw new Error('No encryption key');

      const encrypted = await encryptText(key, text);
      const deviceLabel = parseDeviceLabel();

      await api.sendMessage(roomId, encrypted, 'text', deviceLabel);
      // Message will arrive via WebSocket
    } catch {
      // Error handled silently — message will appear via WS on success
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {/* Online members - collapsible sidebar on large screens */}
      {onlineMembers.length > 0 && (
        <div className="flex items-center gap-2 mb-3 px-1 overflow-x-auto">
          {onlineMembers.map((m) => (
            <span
              key={m.session_id}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-canvas-card text-muted"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              {m.display_label || m.device_label}
            </span>
          ))}
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto mb-4">
        <MessageList
          messages={messages}
          decryptedMessages={decryptedMessages}
          roomCode={roomCode}
        />
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={sending} />
    </div>
  );
}
