/**
 * ChatPage — Chat view with interleaved messages and files.
 *
 * Displays messages and files sorted by time, with bubbles:
 * - Self messages: right-aligned, coral-tinted background
 * - Others messages: left-aligned, card background
 * - File cards: inline download cards (both self and others)
 *
 * Input bar is rendered by parent (RoomPage) as a shared bottom bar.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { useStore } from '@/lib/store';
import { MessageBubble } from './MessageBubble';
import { ChatFileCard } from './ChatFileCard';
import { EmptyState } from '@/components/ui/EmptyState';
import type { MessageDTO, FileMetaDTO } from '@/lib/store';

interface ChatPageProps {
  roomId: string;
  roomCode: string;
  messages: MessageDTO[];
  files: FileMetaDTO[];
  decryptedMessages: Map<string, string>;
  sessionToken: string;
}

/** A unified timeline item — either a text message or a file. */
interface TimelineItem {
  kind: 'message' | 'file';
  message?: MessageDTO;
  file?: FileMetaDTO;
  timestamp: string;
}

export function ChatPage({
  roomId,
  roomCode,
  messages,
  files,
  decryptedMessages,
  sessionToken,
}: ChatPageProps) {
  const onlineMembers = useStore((s) => s.onlineMembers);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevTotalRef = useRef(0);

  // With flex-col-reverse, scrollTop === 0 means at "bottom" (newest messages visible).
  // We use a small threshold (50px) to account for minor scroll jitter.
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop <= 50;
    setIsAtBottom(atBottom);
    if (atBottom) setNewMessageCount(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // With flex-col-reverse, scrolling to 0 means bottom (newest items)
    requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
  }, []);

  const totalItems = messages.length + files.length;

  // Auto-scroll when at bottom and new items arrive
  useEffect(() => {
    if (isAtBottom && totalItems > 0) {
      scrollToBottom();
    }
  }, [totalItems, isAtBottom, scrollToBottom]);

  // Track new messages when scrolled away from bottom
  useEffect(() => {
    if (totalItems > prevTotalRef.current && !isAtBottom && totalItems > 0) {
      setNewMessageCount((prev) => prev + (totalItems - prevTotalRef.current));
    }
    prevTotalRef.current = totalItems;
  }, [totalItems, isAtBottom]);

  // Merge messages and files into a single timeline sorted by created_at
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({
        kind: 'message' as const,
        message: m,
        timestamp: m.created_at,
      })),
      ...files.map((f) => ({
        kind: 'file' as const,
        file: f,
        timestamp: f.created_at,
      })),
    ];
    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return items;
  }, [messages, files]);

  if (timeline.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <EmptyState message={t('chat.noMessages')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Online members — collapsible sidebar on large screens */}
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

      {/* Timeline — flex-col-reverse so newest items are at the visual bottom.
          With CSS flex-col-reverse, the first array element (oldest) appears at
          the far scroll end, and the last (newest) renders at the visual bottom.
          scrollTop === 0 means "at bottom" (viewing newest messages). */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-1 relative"
      >
        <motion.div
          className="flex flex-col-reverse gap-1"
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.03 } },
          }}
        >
          <AnimatePresence>
            {timeline.map((item) => {
              if (item.kind === 'message' && item.message) {
                const isSelf = item.message.sender_session_id === sessionToken;
                return (
                  <MessageBubble
                    key={item.message.id}
                    message={item.message}
                    decryptedContent={decryptedMessages.get(item.message.id)}
                    roomCode={roomCode}
                    isSelf={isSelf}
                  />
                );
              }
              if (item.kind === 'file' && item.file) {
                const isSelf = item.file.uploader_session_id === sessionToken;
                return (
                  <ChatFileCard
                    key={item.file.id}
                    file={item.file}
                    roomCode={roomCode}
                    isSelf={isSelf}
                  />
                );
              }
              return null;
            })}
          </AnimatePresence>
        </motion.div>

        {/* "n new messages" button — shown when scrolled away from bottom */}
        {!isAtBottom && newMessageCount > 0 && (
          <button
            onClick={() => {
              scrollToBottom();
              setNewMessageCount(0);
            }}
            className="absolute bottom-4 right-4 bg-primary text-white px-3 py-1.5 rounded-full shadow-lg text-sm z-10 hover:bg-primary-active transition-colors"
            aria-label={`${newMessageCount} ${t('chat.newMessages')}`}
          >
            {newMessageCount} {t('chat.newMessages')}
          </button>
        )}
      </div>
    </div>
  );
}

// ChatFileCard extracted to ./ChatFileCard.tsx for reuse across chat and transfer views.
