/**
 * ChatFileCard — Inline file card for chat view.
 *
 * Displays a file shared in the chat timeline with enhanced features:
 * - Images: rendered inline with click-to-lightbox, right-click context menu
 * - Text files (.txt, .md, .py, .js, etc.): filename + "Open" button → TextViewModal
 * - Other files: MIME-type icon, decrypted filename, size, download button
 * - Right-aligned for own files, left-aligned for others
 * - File recall with DestroyAnimation + context menu
 *
 * Props: file, roomCode, isSelf
 *
 * Why inline images instead of just download buttons:
 * - Reduces friction for viewing shared images — no need to download first
 * - The /api/files/:id/raw endpoint handles server-side decryption
 * - Lightbox provides full-screen viewing with download/recall controls
 *
 * Why text viewer as a modal:
 * - Text files can be large; expanding inline would disrupt chat flow
 * - Modal provides dedicated reading space with copy functionality
 * - For MVP, no syntax highlighting — plain monospace text (bundle size concern)
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText, decryptFile } from '@/lib/crypto';
import { Button } from '@/components/ui/Button';
import { DestroyAnimation } from '@/components/ui/DestroyAnimation';
import { Lightbox } from '@/components/ui/Lightbox';
import { TextViewModal } from '@/components/ui/TextViewModal';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import type { FileMetaDTO } from '@/lib/store';

export interface ChatFileCardProps {
  file: FileMetaDTO;
  roomCode: string;
  isSelf: boolean;
}

// ---- Text MIME type detection ----
// Handles common text formats. For MVP, we match on MIME type prefix
// and a set of known text-like application/* types.
// [Debt: Accessibility/i18n] Future: support more formats like .ipynb, .r, .rmd

const TEXT_MIME_PREFIXES = [
  'text/',
];

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

export function ChatFileCard({ file, roomCode, isSelf }: ChatFileCardProps) {
  const [decryptedName, setDecryptedName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [textContentLoading, setTextContentLoading] = useState(false);
  const [isDestroying, setIsDestroying] = useState(false);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number } | null>(null);

  const addToast = useStore((s) => s.addToast);
  const removeFile = useStore((s) => s.removeFile);
  const session = useStore((s) => s.session);

  const isImage = file.mime_type.startsWith('image/');
  const isText = isTextMime(file.mime_type);
  const isOwnFile = file.uploader_session_id === session?.token;
  const isRecalled = !!file.recalled_at;
  const isPublic = file.visibility === 'public';
  const publicUrl = isPublic
    ? `${window.location.origin}/api/files/${file.id}/public`
    : '';

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

  // Fetch image blob for inline display via the raw endpoint.
  // All files are stored encrypted in R2 (even "public" files are encrypted
  // at the storage layer — visibility only controls auth). The X-File-Encrypted
  // response header signals that the blob must be decrypted client-side
  // before rendering.
  useEffect(() => {
    if (!isImage || isRecalled) return;

    let revoked = false;
    const fetchImage = async () => {
      try {
        const response = await api.getFileRaw(file.id);
        const isEncrypted = response.headers.get('X-File-Encrypted') === 'true';
        let blob = await response.blob();

        // Decrypt if needed (private files are stored encrypted in R2)
        if (isEncrypted) {
          const key = getRoomKey(roomCode);
          if (key) {
            const encryptedBuffer = await blob.arrayBuffer();
            const decryptedBuffer = await decryptFile(key, encryptedBuffer);
            blob = new Blob([decryptedBuffer], { type: file.mime_type });
          }
          // If no key, we show the encrypted blob anyway (broken image)
          // which is better than a loading skeleton that never resolves.
        }

        if (!revoked) {
          const url = URL.createObjectURL(blob);
          setImageBlobUrl(url);
        }
      } catch {
        // Image unavailable — silently fall back to file card display
        // by keeping imageBlobUrl as null (shows loading state)
      }
    };
    fetchImage();

    return () => {
      revoked = true;
    };
    // Only re-fetch when file.id changes (not on imageBlobUrl change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, isImage, isRecalled]);

  // ---- Handlers ----

  const handleDownload = useCallback(async () => {
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
  }, [file.id, decryptedName, addToast]);

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

  const handleOpenText = useCallback(async () => {
    setTextContentLoading(true);
    try {
      const response = await api.getFileRaw(file.id);
      const isEncrypted = response.headers.get('X-File-Encrypted') === 'true';
      let content: string;

      if (isEncrypted) {
        const key = getRoomKey(roomCode);
        if (!key) {
          addToast({ type: 'error', message: t('e2ee.decryptError') });
          return;
        }
        const encryptedBlob = await response.blob();
        const encryptedBuffer = await encryptedBlob.arrayBuffer();
        const decryptedBuffer = await decryptFile(key, encryptedBuffer);
        const decoder = new TextDecoder();
        content = decoder.decode(decryptedBuffer);
      } else {
        content = await response.text();
      }

      setTextContent(content);
      setTextModalOpen(true);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setTextContentLoading(false);
    }
  }, [file.id, roomCode, addToast]);

  // Image right-click context menu
  const handleImageContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setImageContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Image context menu items
  const imageMenuItems: ContextMenuItem[] = [
    {
      key: 'download',
      label: t('chat.downloadFile'),
      onClick: handleDownload,
    },
    ...(isOwnFile && !isRecalled
      ? [
          {
            key: 'recall' as const,
            label: t('chat.recall'),
            danger: true as const,
            onClick: () => {
              handleRecall();
            },
          },
        ]
      : []),
  ];

  // ---- Rendering helpers ----

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

  // File type icon (used for non-image, non-text files)
  const mimeIcon = file.mime_type.startsWith('image/') ? '🖼'
    : file.mime_type.startsWith('video/') ? '🎬'
    : file.mime_type.startsWith('audio/') ? '🎵'
    : file.mime_type.includes('pdf') ? '📑'
    : file.mime_type.includes('zip') || file.mime_type.includes('rar') ? '📦'
    : '📄';

  return (
    <>
      <DestroyAnimation isDestroying={isDestroying} onDestroyed={handleDestroyed}>
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
            {/* ---- Inline image display ---- */}
            {isImage && !isRecalled ? (
              <div>
                {imageBlobUrl ? (
                  <img
                    src={imageBlobUrl}
                    alt={decryptedName || t('chat.viewImage')}
                    className="rounded-lg max-w-full max-h-80 object-cover cursor-pointer"
                    onClick={() => setLightboxOpen(true)}
                    onContextMenu={handleImageContextMenu}
                    // Long-press for mobile
                    onTouchStart={() => {
                      if ('ontouchstart' in window) {
                        const timer = setTimeout(() => {
                          setImageContextMenu({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                        }, 500);
                        const cancel = () => clearTimeout(timer);
                        document.addEventListener('touchend', cancel, { once: true });
                        document.addEventListener('touchmove', cancel, { once: true });
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-40 bg-canvas-card animate-pulse rounded-lg flex items-center justify-center">
                    <span className="text-xs text-muted">{t('common.loading')}</span>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-muted-soft truncate max-w-[60%]">
                    {decryptedName || ''}
                  </span>
                  <span className="text-[10px] text-muted-soft">{time}</span>
                </div>
              </div>
            ) : isText ? (
              /* ---- Text file card ---- */
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-lg" role="img" aria-label="file-type">📄</span>
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
                    loading={textContentLoading}
                    onClick={handleOpenText}
                  >
                    {t('chat.openFile')}
                  </Button>
                </div>
                <span className="text-[10px] text-muted-soft mt-1 block">{time}</span>
              </div>
            ) : (
              /* ---- Generic file card (existing behavior) ---- */
              <div>
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
            )}
          </div>
        </motion.div>
      </DestroyAnimation>

      {/* Image Lightbox */}
      <Lightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        src={imageBlobUrl || ''}
        alt={decryptedName || t('chat.viewImage')}
        onDownload={handleDownload}
        onRecall={isOwnFile && !isRecalled ? handleRecall : undefined}
        showRecall={isOwnFile && !isRecalled}
      />

      {/* Text File Viewer Modal */}
      <TextViewModal
        isOpen={textModalOpen}
        onClose={() => setTextModalOpen(false)}
        fileName={decryptedName || `file-${file.id}`}
        content={textContent}
        isPublic={isPublic}
        publicUrl={publicUrl}
      />

      {/* Image context menu (right-click / long-press on inline image) */}
      <ContextMenu
        isOpen={!!imageContextMenu}
        onClose={() => setImageContextMenu(null)}
        items={imageMenuItems}
        position={imageContextMenu}
      />
    </>
  );
}
