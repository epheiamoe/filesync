/**
 * FileItem — Single file row with expand/collapse.
 *
 * Features:
 * - MIME type based icon
 * - Collapsed: icon, filename, size, time
 * - Expanded: full metadata, download, open, recall
 * - Status indicators: uploading, complete, expired, recalled
 * - Expiration countdown for < 5 minutes
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText } from '@/lib/crypto';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { FileMetaDTO } from '@/lib/store';

interface FileItemProps {
  file: FileMetaDTO;
  roomCode: string;
  isSelected: boolean;
  onToggleSelect: () => void;
}

export function FileItem({ file, roomCode, isSelected, onToggleSelect }: FileItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [decryptedFilename, setDecryptedFilename] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const removeFile = useStore((s) => s.removeFile);
  const addToast = useStore((s) => s.addToast);

  const isRecalled = !!file.recalled_at;
  const isExpired = new Date(file.expires_at) < new Date();

  // Decrypt filename on expand
  const handleExpand = async () => {
    setExpanded(!expanded);
    if (!expanded && !decryptedFilename) {
      try {
        const key = getRoomKey(roomCode);
        if (key) {
          const name = await decryptText(key, file.encrypted_filename);
          setDecryptedFilename(name);
        }
      } catch {
        setDecryptedFilename(`[${t('e2ee.decryptError')}]`);
      }
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await api.downloadFile(file.id);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decryptedFilename || `file-${file.id}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setDownloading(false);
    }
  };

  const handleRecall = async () => {
    try {
      await api.recallFile(file.id);
      removeFile(file.id);
      addToast({ type: 'info', message: t('chat.recalled') });
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const getFileIcon = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return '🖼';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.startsWith('text/')) return '📄';
    if (mimeType.includes('pdf')) return '📑';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return '📦';
    return '📎';
  };

  const expiresIn = new Date(file.expires_at).getTime() - Date.now();
  const expiresSoon = expiresIn > 0 && expiresIn < 5 * 60 * 1000;

  const status = isRecalled
    ? 'recalled'
    : isExpired
    ? 'expired'
    : 'active';

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
      className={`
        rounded-lg p-3 transition-colors
        ${isSelected ? 'bg-primary/10 border border-primary/30' : 'bg-canvas-card border border-hairline-soft'}
        ${status === 'recalled' || status === 'expired' ? 'opacity-50' : ''}
      `.trim().replace(/\s+/g, ' ')}
      role="listitem"
    >
      {/* Collapsed view */}
      <div className="flex items-center gap-3 cursor-pointer" onClick={handleExpand}>
        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
            isSelected ? 'bg-primary border-primary' : 'border-hairline'
          }`}
          aria-label={isSelected ? '取消选择' : '选择文件'}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-on-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </button>

        {/* File icon */}
        <span className="text-xl flex-shrink-0" role="img" aria-label="file-type">
          {getFileIcon(file.mime_type)}
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-body truncate">
            {decryptedFilename || file.encrypted_filename.slice(0, 30) + '...'}
          </p>
          <p className="text-xs text-muted-soft">
            {formatSize(file.file_size)} · {new Date(file.created_at).toLocaleTimeString()}
          </p>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {file.visibility === 'public' && (
            <Badge variant="coral" className="text-[10px] px-1.5 py-0.5">
              {t('transfer.filterPublic')}
            </Badge>
          )}
          {status === 'recalled' && (
            <Badge variant="error" className="text-[10px] px-1.5 py-0.5">
              {t('chat.recalled')}
            </Badge>
          )}
          {status === 'expired' && (
            <Badge variant="warning" className="text-[10px] px-1.5 py-0.5">
              {t('transfer.expired')}
            </Badge>
          )}
          {expiresSoon && status === 'active' && (
            <Badge variant="error" className="text-[10px] px-1.5 py-0.5">
              {Math.ceil(expiresIn / 60000)}m
            </Badge>
          )}
          <svg
            className={`w-4 h-4 text-muted-soft transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Expanded view */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-3 pt-3 border-t border-hairline"
        >
          <dl className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div>
              <dt className="text-muted-soft">{t('transfer.filterAll')}</dt>
              <dd className="text-body">{file.mime_type}</dd>
            </div>
            <div>
              <dt className="text-muted-soft">{t('transfer.expires')}</dt>
              <dd className={expiresSoon ? 'text-error' : 'text-body'}>
                {new Date(file.expires_at).toLocaleString()}
              </dd>
            </div>
          </dl>
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" size="sm" loading={downloading} onClick={handleDownload}>
              {t('transfer.download')}
            </Button>
            {!isRecalled && (
              <Button variant="danger" size="sm" onClick={handleRecall}>
                {t('chat.recall')}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
