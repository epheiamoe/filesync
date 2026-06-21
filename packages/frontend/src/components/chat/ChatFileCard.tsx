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

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { api, getApiBaseUrl } from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoomKey, decryptText, decryptFile } from '@/lib/crypto';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DestroyAnimation } from '@/components/ui/DestroyAnimation';
import { CountdownCircle } from '@/components/ui/CountdownCircle';
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
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number } | null>(null);

  const addToast = useStore((s) => s.addToast);
  const removeFile = useStore((s) => s.removeFile);
  const session = useStore((s) => s.session);

  const isImage = file.mime_type.startsWith('image/');
  const isText = isTextMime(file.mime_type);
  const isOwnFile = file.uploader_session_id === session?.token;
  const isRecalled = !!file.recalled_at;
  const isPublic = file.visibility === 'public';
  // Download link: served by the API (filesync-api.epheia.workers.dev/api/... in prod, /api/... in dev)
  const downloadUrl = isPublic
    ? `${getApiBaseUrl()}/files/${file.id}/public?download=1`
    : '';
  // Preview link: the isolated frontend viewer page
  const previewUrl = isPublic
    ? `${window.location.origin}/view/${file.id}`
    : '';

  // Share dialog state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState('');
  const downloadQrRef = useRef<HTMLCanvasElement>(null);
  const previewQrRef = useRef<HTMLCanvasElement>(null);

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
  //
  // We use a ref to track the current blob URL so the cleanup function can
  // revoke it on unmount or when file.id changes, preventing memory leaks
  // from orphaned blob URLs.
  const blobUrlRef = useRef<string | null>(null);

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
          blobUrlRef.current = url;
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
      // Revoke the previous blob URL to prevent memory leaks.
      // Without this, each decrypted image blob remains in memory
      // permanently after component unmount or file source change.
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
    // Only re-fetch when file.id changes (not on imageBlobUrl change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, isImage, isRecalled]);

  // ---- Handlers ----

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
      a.download = decryptedName || `file-${file.id}`;
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
  }, [file, roomCode, decryptedName, addToast]);

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

  // Share dialog handlers
  const handleOpenShare = useCallback(() => {
    setShareOpen(true);
  }, []);

  const handleCloseShare = useCallback(() => {
    setShareOpen(false);
    setShareCopied('');
  }, []);

  const handleCopyLink = useCallback(async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(label);
      setTimeout(() => setShareCopied(''), 2000);
    } catch {
      // Fallback
      setShareCopied(label);
      setTimeout(() => setShareCopied(''), 2000);
    }
  }, []);

  // Render QR codes when share dialog opens
  useEffect(() => {
    if (!shareOpen) return;
    import('qrcode').then((QRCode) => {
      if (downloadQrRef.current && downloadUrl) {
        QRCode.toCanvas(downloadQrRef.current, downloadUrl, {
          width: 160,
          margin: 1,
          color: { dark: '#141413', light: '#faf9f5' },
        });
      }
      if (previewQrRef.current && previewUrl) {
        QRCode.toCanvas(previewQrRef.current, previewUrl, {
          width: 160,
          margin: 1,
          color: { dark: '#141413', light: '#faf9f5' },
        });
      }
    });
  }, [shareOpen, downloadUrl, previewUrl]);

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
    ...(isPublic
      ? [
          {
            key: 'share' as const,
            label: t('rooms.share'),
            onClick: handleOpenShare,
          },
        ]
      : []),
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

  // Generic file card context menu (for text and other non-image files)
  const handleFileContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFileContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const fileMenuItems: ContextMenuItem[] = [
    {
      key: 'download',
      label: t('chat.downloadFile'),
      onClick: handleDownload,
    },
    ...(isPublic
      ? [
          {
            key: 'share' as const,
            label: t('rooms.share'),
            onClick: handleOpenShare,
          },
        ]
      : []),
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
              relative max-w-[85%] sm:max-w-[70%] rounded-lg px-3.5 py-2.5
              ${isSelf ? 'bg-primary/10' : 'bg-canvas-card'}
            `.trim().replace(/\s+/g, ' ')}
          >
            {/* Public file badge — top-left corner. Clickable to open share dialog. */}
            {isPublic && !isRecalled && (
              <button
                onClick={handleOpenShare}
                className="absolute top-1.5 left-1.5 z-10"
                aria-label={t('chat.shareDialog')}
              >
                <Badge variant="coral" className="text-[10px] px-1.5 py-0.5 cursor-pointer hover:opacity-80 transition-opacity">
                  {t('chat.public')}
                </Badge>
              </button>
            )}

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
                {/* Countdown circle for file expiry */}
                {!isRecalled && (
                  <div className="absolute bottom-1 right-1">
                    <CountdownCircle
                      expiresAt={file.expires_at}
                      ttlSeconds={file.ttl_seconds}
                      size={18}
                      strokeWidth={1.5}
                    />
                  </div>
                )}
              </div>
            ) : isText ? (
              /* ---- Text file card ---- */
              <div onContextMenu={handleFileContextMenu}>
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
                {/* Countdown circle for file expiry */}
                {!isRecalled && (
                  <div className="absolute bottom-1 right-1">
                    <CountdownCircle
                      expiresAt={file.expires_at}
                      ttlSeconds={file.ttl_seconds}
                      size={18}
                      strokeWidth={1.5}
                    />
                  </div>
                )}
              </div>
            ) : (
              /* ---- Generic file card (existing behavior) ---- */
              <div onContextMenu={handleFileContextMenu}>
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
                {/* Countdown circle for file expiry */}
                {!isRecalled && (
                  <div className="absolute bottom-1 right-1">
                    <CountdownCircle
                      expiresAt={file.expires_at}
                      ttlSeconds={file.ttl_seconds}
                      size={18}
                      strokeWidth={1.5}
                    />
                  </div>
                )}
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
        publicUrl={downloadUrl}
      />

      {/* Image context menu (right-click / long-press on inline image) */}
      <ContextMenu
        isOpen={!!imageContextMenu}
        onClose={() => setImageContextMenu(null)}
        items={imageMenuItems}
        position={imageContextMenu}
      />

      {/* File context menu (right-click on text/generic file cards) */}
      <ContextMenu
        isOpen={!!fileContextMenu}
        onClose={() => setFileContextMenu(null)}
        items={fileMenuItems}
        position={fileContextMenu}
      />

      {/* Public file share dialog — QR codes + copy links */}
      {shareOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-ink/40 z-[800] flex items-center justify-center p-4"
            onClick={handleCloseShare}
            aria-hidden="true"
          />
          {/* Dialog */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[801] bg-canvas rounded-xl p-6 max-w-sm mx-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('chat.shareDialog')}
          >
            <h2 className="text-display-sm font-display text-ink mb-4 text-center">
              {t('chat.shareDialog')}
            </h2>

            {/* Download section */}
            <div className="mb-4">
              <p className="text-xs text-muted mb-2 text-center">{t('chat.downloadLink')}</p>
              <canvas
                ref={downloadQrRef}
                className="mx-auto border-2 border-hairline rounded-lg mb-2"
                aria-label={t('chat.downloadLink')}
              />
              <div className="flex gap-2">
                <code className="flex-1 px-2 py-1 bg-canvas-card rounded text-[10px] font-mono text-body truncate">
                  {downloadUrl}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopyLink(downloadUrl, 'download')}
                >
                  {shareCopied === 'download' ? t('common.copied') : t('common.copy')}
                </Button>
              </div>
            </div>

            {/* Preview section */}
            <div className="mb-4">
              <p className="text-xs text-muted mb-2 text-center">{t('chat.previewLink')}</p>
              <canvas
                ref={previewQrRef}
                className="mx-auto border-2 border-hairline rounded-lg mb-2"
                aria-label={t('chat.previewLink')}
              />
              <div className="flex gap-2">
                <code className="flex-1 px-2 py-1 bg-canvas-card rounded text-[10px] font-mono text-body truncate">
                  {previewUrl}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopyLink(previewUrl, 'preview')}
                >
                  {shareCopied === 'preview' ? t('common.copied') : t('common.copy')}
                </Button>
              </div>
            </div>

            {/* Close */}
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              onClick={handleCloseShare}
            >
              {t('common.close')}
            </Button>
          </motion.div>
        </>
      )}
    </>
  );
}
