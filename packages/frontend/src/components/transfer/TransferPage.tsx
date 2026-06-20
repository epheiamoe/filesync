/**
 * TransferPage — File/Text transfer view with sidebar tabs.
 *
 * Two panels:
 * - Left sidebar: filter options and type tabs
 * - Right content: list of files or texts (both drawn from the same data as Chat)
 */

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { FileList } from './FileList';
import { TabBar } from '@/components/ui/TabBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { UploadZone } from './UploadZone';
import { ExpandableText } from '@/components/ui/ExpandableText';
import { DestroyAnimation } from '@/components/ui/DestroyAnimation';
import type { MessageDTO, FileMetaDTO } from '@/lib/store';

interface TransferPageProps {
  roomId: string;
  roomCode: string;
  files: FileMetaDTO[];
  messages: MessageDTO[];
  decryptedMessages: Map<string, string>;
}

export function TransferPage({ roomId, roomCode, files, messages, decryptedMessages }: TransferPageProps) {
  const [activeTab, setActiveTab] = useState<'texts' | 'files'>('files');
  const [filter, setFilter] = useState('all');

  const tabs = [
    { key: 'texts', label: t('transfer.texts') },
    { key: 'files', label: t('transfer.files') },
  ];

  const filterTabs = [
    { key: 'all', label: t('transfer.filterAll') },
    { key: 'image', label: t('transfer.filterImage') },
    { key: 'video', label: t('transfer.filterVideo') },
    { key: 'document', label: t('transfer.filterDoc') },
    { key: 'other', label: t('transfer.filterOther') },
  ];

  // Filter text messages (only type 'text', not 'file_shared' or 'system')
  const textMessages = useMemo(
    () => messages.filter((m) => m.message_type === 'text' && !m.recalled_at),
    [messages],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Upload Zone — always visible for explicit click-to-upload */}
      <UploadZone roomId={roomId} roomCode={roomCode} />

      {/* Content tabs */}
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onChange={(k) => setActiveTab(k as 'texts' | 'files')}
      />

      {/* Active content */}
      {activeTab === 'files' ? (
        <FileList
          roomId={roomId}
          roomCode={roomCode}
          files={files}
          filter={filter}
        />
      ) : textMessages.length === 0 ? (
        <EmptyState
          title={t('transfer.texts')}
          message={t('transfer.noTexts')}
        />
      ) : (
        <motion.div
          className="flex flex-col gap-3"
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {textMessages.map((msg) => (
            <TextListItem
              key={msg.id}
              message={msg}
              decryptedContent={decryptedMessages.get(msg.id)}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

// ---- Text List Item for Transfer "Texts" tab ----

interface TextListItemProps {
  message: MessageDTO;
  decryptedContent: string | undefined;
}

function TextListItem({ message, decryptedContent }: TextListItemProps) {
  const session = useStore((s) => s.session);
  const removeMessage = useStore((s) => s.removeMessage);
  const addToast = useStore((s) => s.addToast);
  const [isDestroying, setIsDestroying] = useState(false);

  const isOwnMessage = message.sender_session_id === session?.token;

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const date = new Date(message.created_at).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

  const handleCopy = useCallback(async () => {
    if (!decryptedContent) return;
    try {
      await navigator.clipboard.writeText(decryptedContent);
      addToast({ type: 'success', message: t('chat.copied') });
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [decryptedContent, addToast]);

  const handleRecall = useCallback(async () => {
    try {
      await api.recallMessage(message.id, message.room_id);
      setIsDestroying(true);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [message.id, message.room_id, addToast]);

  const handleDestroyed = useCallback(() => {
    removeMessage(message.id);
    addToast({ type: 'info', message: t('chat.recalled') });
  }, [message.id, removeMessage, addToast]);

  return (
    <DestroyAnimation isDestroying={isDestroying} onDestroyed={handleDestroyed}>
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 10 },
          visible: {
            opacity: 1,
            y: 0,
            transition: { type: 'spring', stiffness: 500, damping: 40 },
          },
        }}
        className="bg-canvas-card border border-hairline-soft rounded-lg p-3"
        role="listitem"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-soft">
            {message.device_label || t('common.loading')}
          </span>
          <span className="text-xs text-muted-soft">
            {date} {time}
          </span>
        </div>
        <div>
          {decryptedContent ? (
            <ExpandableText text={decryptedContent} maxLength={300} />
          ) : (
            <p className="text-sm text-muted-soft">{t('common.loading')}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-2 pt-2 border-t border-hairline">
          <button
            onClick={handleCopy}
            disabled={!decryptedContent}
            className="text-xs px-2 py-1 rounded text-muted hover:text-ink hover:bg-canvas-soft transition-colors disabled:opacity-40"
            type="button"
          >
            {t('chat.copy')}
          </button>
          {isOwnMessage && !isDestroying && (
            <button
              onClick={handleRecall}
              className="text-xs px-2 py-1 rounded text-error hover:bg-error/10 transition-colors"
              type="button"
            >
              {t('chat.recall')}
            </button>
          )}
        </div>
      </motion.div>
    </DestroyAnimation>
  );
}
