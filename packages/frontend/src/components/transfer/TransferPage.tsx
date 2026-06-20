/**
 * TransferPage — File/Text transfer view with sidebar tabs.
 *
 * Two panels:
 * - Left sidebar: filter options and type tabs
 * - Right content: list of files or texts (both drawn from the same data as Chat)
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { FileList } from './FileList';
import { TabBar } from '@/components/ui/TabBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { UploadZone } from './UploadZone';
import { ExpandableText } from '@/components/ui/ExpandableText';
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
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const date = new Date(message.created_at).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

  return (
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
    </motion.div>
  );
}
