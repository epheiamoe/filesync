/**
 * FileItem — Single file row with expand/collapse.
 *
 * Features:
 * - MIME type based icon
 * - Collapsed: icon, filename, size, time
 * - Expanded: full metadata, download, open/view, recall
 * - Status indicators: uploading, complete, expired, recalled
 * - Expiration countdown for < 5 minutes
 * - Recall with DestroyAnimation wrapper
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText, decryptFile } from '@/lib/crypto';
import { Lightbox } from '@/components/ui/Lightbox';
import { TextViewModal } from '@/components/ui/TextViewModal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DestroyAnimation } from '@/components/ui/DestroyAnimation';
import { Spinner } from '@/components/ui/Spinner';
import type { FileMetaDTO } from '@/lib/store';

interface FileItemProps {
  file: FileMetaDTO;
  roomCode: string;
  isSelected: boolean;
  onToggleSelect: () => void;
}

/** MIME types that can be viewed directly (opens in new tab via /api/files/:id/raw). */
const VIEWABLE_MIME_PREFIXES = ['image/', 'text/', 'application/pdf'];

// ---- Text MIME type detection ----
// Handles common text formats. For MVP, matched on MIME type prefix
// and a set of known text-like application/* types.
// [Debt: Accessibility/i18n] Duplicated from ChatFileCard — extract to @/lib/mime.ts
const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
  'application/x-yaml',
  'application/x-sh',
  'application/x-httpd-php',
  'application/x-ruby',
  'application/x-go',
  'application/x-rust',
  'application/typescript',
  'application/x-tex',
  'application/x-latex',
  'application/x-sql',
  'application/x-csh',
  'application/x-python-code',
  'application/x-perl',
]);

function isTextMime(mimeType: string): boolean {
  if (TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
  return TEXT_MIME_EXACT.has(mimeType);
}

function isViewable(mimeType: string): boolean {
  if (VIEWABLE_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
  return isTextMime(mimeType);
}

export function FileItem({ file, roomCode, isSelected, onToggleSelect }: FileItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [decryptedFilename, setDecryptedFilename] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [isDestroying, setIsDestroying] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState('');
  const [textViewOpen, setTextViewOpen] = useState(false);
  const [textContent, setTextContent] = useState('');
  const removeFile = useStore((s) => s.removeFile);
  const addToast = useStore((s) => s.addToast);
  const session = useStore((s) => s.session);

  const isRecalled = !!file.recalled_at;
  const isExpired = new Date(file.expires_at) < new Date();
  const isOwnFile = file.uploader_session_id === session?.token;

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

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const response = await api.downloadFile(file.id);

      // Check encryption flag before using bytes
      const isEncrypted = response.headers.get('X-File-Encrypted') === 'true';
      let blob: Blob;

      if (isEncrypted) {
        const key = getRoomKey(roomCode);
        if (!key) {
          addToast({ type: 'error', message: t('e2ee.decryptError') });
          return;
        }
        const encryptedBlob = await response.blob();
        const encryptedBuffer = await encryptedBlob.arrayBuffer();
        const decryptedBuffer = await decryptFile(key, encryptedBuffer);
        blob = new Blob([decryptedBuffer], { type: file.mime_type });
      } else {
        blob = await response.blob();
      }

      // Save decrypted blob
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decryptedFilename || `file-${file.id}`;
      document.body.appendChild(a); // Required for Firefox
      a.click();
      document.body.removeChild(a);
      // Revoke after a short delay to ensure the download starts
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setDownloading(false);
    }
  }, [file, roomCode, decryptedFilename, addToast]);

  // View file — client-side fetch → decrypt → display by MIME type.
  // All files are stored encrypted in R2. The X-File-Encrypted response
  // header signals that the blob must be decrypted client-side before rendering.
  const handleView = useCallback(async () => {
    if (viewLoading) return; // Loading guard: prevent duplicate fetches on rapid clicks
    setViewLoading(true);

    try {
      // 1. Fetch raw bytes from server
      const response = await api.getFileRaw(file.id);

      // 2. Check encryption flag
      const isEncrypted = response.headers.get('X-File-Encrypted') === 'true';
      let bytes: ArrayBuffer;

      if (isEncrypted) {
        // 3a. Get room key from localStorage
        const key = getRoomKey(roomCode);
        if (!key) {
          addToast({ type: 'error', message: t('e2ee.decryptError') });
          return;
        }

        // 3b. Decrypt: blob → ArrayBuffer → decryptFile
        const encBuf = await response.arrayBuffer();
        bytes = await decryptFile(key, encBuf);
      } else {
        // File is not encrypted (should not happen in current architecture
        // where all files are encrypted, but handled for robustness)
        bytes = await response.arrayBuffer();
      }

      const blob = new Blob([bytes], { type: file.mime_type });
      const mime = file.mime_type;

      // 4. Branch by MIME type
      if (mime.startsWith('image/')) {
        const url = URL.createObjectURL(blob);
        setLightboxSrc(url);
        setLightboxOpen(true);
      } else if (mime.startsWith('text/') || isTextMime(mime)) {
        const decoder = new TextDecoder();
        const text = decoder.decode(bytes);
        setTextContent(text);
        setTextViewOpen(true);
      } else if (mime === 'application/pdf') {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        // Delay revoke to allow the tab to consume the blob
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        // Fallback: download for unknown viewable types
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = decryptedFilename || `file-${file.id}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      console.error('[FileItem] View failed:', err);
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setViewLoading(false);
    }
  }, [file, roomCode, viewLoading, decryptedFilename, addToast]);

  // Recall with destroy animation
  const handleRecall = useCallback(async () => {
    try {
      await api.recallFile(file.id);
      setIsDestroying(true);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [file.id, addToast]);

  const handleDestroyed = useCallback(() => {
    removeFile(file.id);
    addToast({ type: 'info', message: t('chat.recalled') });
  }, [file.id, removeFile, addToast]);

  const handleLightboxClose = useCallback(() => {
    setLightboxOpen(false);
    if (lightboxSrc) {
      URL.revokeObjectURL(lightboxSrc);
      setLightboxSrc('');
    }
  }, [lightboxSrc]);

  const handleTextViewClose = useCallback(() => {
    setTextViewOpen(false);
    setTextContent('');
  }, []);

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
    <>
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
        className={`
          rounded-lg p-3 transition-colors
          ${isSelected ? 'bg-primary/10 border border-primary/30' : 'bg-canvas-card border border-hairline-soft'}
          ${status === 'recalled' || status === 'expired' || isDestroying ? 'opacity-50' : ''}
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
              {/* View button — for image, text, and PDF files */}
              {!isRecalled && isViewable(file.mime_type) && (
                <Button variant="secondary" size="sm" onClick={handleView} disabled={viewLoading}>
                  {viewLoading ? (
                    <Spinner size="sm" />
                  ) : (
                    <svg
                      className="w-3.5 h-3.5 mr-1"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                  {viewLoading ? t('common.loading') : t('transfer.view')}
                </Button>
              )}
              <Button variant="primary" size="sm" loading={downloading} onClick={handleDownload}>
                <svg
                  className="w-3.5 h-3.5 mr-1"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t('transfer.download')}
              </Button>
              {!isRecalled && isOwnFile && (
                <Button variant="danger" size="sm" onClick={handleRecall}>
                  <svg
                    className="w-3.5 h-3.5 mr-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  {t('chat.recall')}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </motion.div>
    </DestroyAnimation>
    {/* Lightbox for images opened from FileItem */}
    <Lightbox
      isOpen={lightboxOpen}
      onClose={handleLightboxClose}
      src={lightboxSrc}
      alt={decryptedFilename || t('chat.viewImage')}
    />
    {/* TextViewModal for text files opened from FileItem */}
    <TextViewModal
      isOpen={textViewOpen}
      onClose={handleTextViewClose}
      fileName={decryptedFilename || `file-${file.id}`}
      content={textContent}
      isPublic={file.visibility === 'public'}
      publicUrl={file.visibility === 'public' ? `${window.location.origin}/api/files/${file.id}/public` : ''}
    />
    </>
  );
}
