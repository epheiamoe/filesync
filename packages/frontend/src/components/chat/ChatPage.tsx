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

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText } from '@/lib/crypto';
import { MessageBubble } from './MessageBubble';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExpandableText } from '@/components/ui/ExpandableText';
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
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Scroll to bottom when new items arrive
  const totalItems = messages.length + files.length;
  useEffect(() => {
    scrollToBottom();
  }, [totalItems, scrollToBottom]);

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
    <div className="flex flex-col h-[calc(100vh-140px)]">
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

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-1">
        <motion.div
          className="flex flex-col gap-1"
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ---- Inline file card for chat view ----

interface ChatFileCardProps {
  file: FileMetaDTO;
  roomCode: string;
  isSelf: boolean;
}

function ChatFileCard({ file, roomCode, isSelf }: ChatFileCardProps) {
  const [decryptedName, setDecryptedName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const addToast = useStore((s) => s.addToast);

  // Decrypt filename on mount
  useEffect(() => {
    const decrypt = async () => {
      try {
        const key = getRoomKey(roomCode);
        if (key) {
          const name = await decryptText(key, file.encrypted_filename);
          setDecryptedName(name);
        }
      } catch {
        setDecryptedName(`[${t('e2ee.decryptError')}]`);
      }
    };
    decrypt();
  }, [file.encrypted_filename, roomCode]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await api.downloadFile(file.id);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decryptedName || `file-${file.id}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setDownloading(false);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const time = new Date(file.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const mimeIcon = file.mime_type.startsWith('image/') ? '🖼'
    : file.mime_type.startsWith('video/') ? '🎬'
    : file.mime_type.startsWith('audio/') ? '🎵'
    : file.mime_type.includes('pdf') ? '📑'
    : file.mime_type.includes('zip') || file.mime_type.includes('rar') ? '📦'
    : '📄';

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20, scale: 0.97 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { type: 'spring', stiffness: 300, damping: 30 },
        },
      }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`
          max-w-[85%] sm:max-w-[70%] rounded-lg px-3.5 py-2.5
          ${isSelf ? 'bg-primary/10' : 'bg-canvas-card'}
        `.trim().replace(/\s+/g, ' ')}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg" role="img" aria-label="file-type">{mimeIcon}</span>
          <span className="text-sm font-medium text-body truncate">
            {decryptedName || t('transfer.uploading')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-soft">
            {formatSize(file.file_size)}
          </span>
          <Button
            variant="primary"
            size="sm"
            loading={downloading}
            onClick={handleDownload}
          >
            {t('transfer.download')}
          </Button>
        </div>
        <span className="text-[10px] text-muted-soft mt-1 block">{time}</span>
      </div>
    </motion.div>
  );
}
