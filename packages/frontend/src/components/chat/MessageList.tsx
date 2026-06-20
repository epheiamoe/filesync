/**
 * MessageList — Scrollable message list with staggered animations.
 *
 * Features:
 * - Auto-scroll to bottom on new messages
 * - Pull to load more (scroll up to load older)
 * - Staggered animation: each message slides in with spring
 */

import { useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { MessageBubble } from './MessageBubble';
import { EmptyState } from '@/components/ui/EmptyState';
import type { MessageDTO } from '@/lib/store';

interface MessageListProps {
  messages: MessageDTO[];
  decryptedMessages: Map<string, string>;
  roomCode: string;
}

export function MessageList({ messages, decryptedMessages, roomCode }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (messages.length === 0) {
    return <EmptyState message={t('chat.noMessages')} />;
  }

  return (
    <motion.div
      ref={containerRef}
      className="flex flex-col gap-1 px-1"
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.03 } },
      }}
    >
      <AnimatePresence>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            decryptedContent={decryptedMessages.get(msg.id)}
            roomCode={roomCode}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
