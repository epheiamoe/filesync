/**
 * ChatFileCard — Inline file card for chat view.
 *
 * Displays a file shared in the chat timeline with:
 * - MIME-type icon (image, video, audio, PDF, archive, generic)
 * - Decrypted filename (lazy, on mount)
 * - File size + download button
 * - Timestamp
 * - Right-aligned for own files, left-aligned for others
 *
 * Props: file, roomCode, isSelf
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText } from '@/lib/crypto';
import { Button } from '@/components/ui/Button';
import type { FileMetaDTO } from '@/lib/store';

export interface ChatFileCardProps {
  file: FileMetaDTO;
  roomCode: string;
  isSelf: boolean;
}

export function ChatFileCard({ file, roomCode, isSelf }: ChatFileCardProps) {
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
