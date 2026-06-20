/**
 * TransferPage — File/Text transfer view with sidebar tabs.
 *
 * Two panels:
 * - Left sidebar: filter options and type tabs
 * - Right content: list of files or texts
 */

import { useState, useEffect, useCallback } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { FileList } from './FileList';
import { TabBar } from '@/components/ui/TabBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { UploadZone } from './UploadZone';
import { Spinner } from '@/components/ui/Spinner';
import type { FileMetaDTO } from '@/lib/store';

interface TransferPageProps {
  roomId: string;
  roomCode: string;
  files: FileMetaDTO[];
}

export function TransferPage({ roomId, roomCode, files }: TransferPageProps) {
  const [activeTab, setActiveTab] = useState<'texts' | 'files'>('files');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="flex flex-col gap-4">
      {/* Upload Zone */}
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
      ) : (
        <EmptyState
          title={t('transfer.texts')}
          message={t('transfer.noTexts')}
        />
      )}
    </div>
  );
}
