/**
 * FileList — List of file items for the room.
 *
 * Features:
 * - Icon based on mime type
 * - Expand to show full metadata
 * - Multi-select + batch delete
 * - Filter bar (not yet connected)
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { FileItem } from './FileItem';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import type { FileMetaDTO } from '@/lib/store';

interface FileListProps {
  roomId: string;
  roomCode: string;
  files: FileMetaDTO[];
  filter: string;
}

export function FileList({ roomId, roomCode, files, filter }: FileListProps) {
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const removeFile = useStore((s) => s.removeFile);
  const addToast = useStore((s) => s.addToast);

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    try {
      for (const id of selectedIds) {
        await api.recallFile(id);
        removeFile(id);
      }
      setSelectedIds(new Set());
      addToast({ type: 'info', message: t('transfer.batchDelete') });
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (files.length === 0) {
    return <EmptyState message={t('transfer.noFiles')} />;
  }

  return (
    <div>
      {/* Batch actions */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 mb-3 p-3 bg-canvas-card rounded-lg"
          >
            <span className="text-sm text-body">
              {selectedIds.size} {t('transfer.batchDelete')}
            </span>
            <Button
              variant="danger"
              size="sm"
              loading={loading}
              onClick={handleBatchDelete}
            >
              {t('common.delete')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              {t('common.cancel')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File items */}
      <motion.div
        className="flex flex-col gap-2"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.05 } },
        }}
      >
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          files.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              roomCode={roomCode}
              isSelected={selectedIds.has(file.id)}
              onToggleSelect={() => toggleSelect(file.id)}
            />
          ))
        )}
      </motion.div>
    </div>
  );
}
