/**
 * PublicViewPage — Isolated public file viewer.
 *
 * Accessible at /view/:fileId without authentication.
 * Completely isolated from the main app — no access to rooms, chat,
 * or any authenticated features.
 *
 * Features:
 * - File info display (name, size, type)
 * - Image preview (inline)
 * - Text preview (scrollable)
 * - Download button
 * - Expiry countdown circle
 * - Minimal UI with back button
 *
 * Why a separate page instead of embedding in the main app:
 * - Public viewers should have zero access to rooms, chat, or E2EE keys
 * - Clean URL sharing: https://filesync.app/view/:fileId
 * - No auth guard = instant access for public recipients
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { getApiBaseUrl } from '@/lib/api';
import { CountdownCircle } from '@/components/ui/CountdownCircle';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

interface PublicFileInfo {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  expires_at: string;
  visibility: string;
}

export function PublicViewPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fileInfo, setFileInfo] = useState<PublicFileInfo | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  const apiBase = getApiBaseUrl();

  // Fetch file info
  useEffect(() => {
    if (!fileId) return;

    const fetchInfo = async () => {
      setLoading(true);
      setError('');
      try {
        // Use the public endpoint — no auth required
        const res = await fetch(`${apiBase}/files/${fileId}/public/info`);
        if (!res.ok) {
          if (res.status === 404) {
            setError(t('public.notFound'));
          } else if (res.status === 410) {
            setError(t('public.expiredTitle'));
          } else {
            setError(t('common.error'));
          }
          return;
        }
        const data = await res.json();
        if (data.success && data.data) {
          setFileInfo(data.data);
        } else {
          setError(data.error || t('common.error'));
        }
      } catch {
        setError(t('common.error'));
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [fileId, apiBase]);

  // Fetch preview content based on MIME type
  useEffect(() => {
    if (!fileInfo || !fileId) return;

    let revoked = false;

    const fetchPreview = async () => {
      try {
        const res = await fetch(`${apiBase}/files/${fileId}/public`);
        if (!res.ok) return;

        const mime = fileInfo.mime_type;

        if (mime.startsWith('image/')) {
          const blob = await res.blob();
          if (revoked) return;
          const url = URL.createObjectURL(blob);
          imageUrlRef.current = url;
          setImageUrl(url);
        } else if (
          mime.startsWith('text/') ||
          ['application/json', 'application/javascript', 'application/xml', 'application/x-yaml'].includes(mime)
        ) {
          const text = await res.text();
          if (!revoked) setTextContent(text);
        }
      } catch {
        // Preview unavailable — download button still works
      }
    };

    fetchPreview();

    return () => {
      revoked = true;
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
    };
  }, [fileInfo, fileId, apiBase]);

  const handleDownload = useCallback(() => {
    if (!fileId) return;
    // Open download URL directly (browser handles the download)
    window.open(`${apiBase}/files/${fileId}/public?download=1`, '_blank');
  }, [fileId, apiBase]);

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (error || !fileInfo) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4 px-4">
        <svg
          className="w-16 h-16 text-muted-soft"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h1 className="text-display-sm font-display text-ink">
          {error || t('public.notFound')}
        </h1>
        <Button variant="secondary" onClick={() => navigate('/')}>
          {t('public.backHome')}
        </Button>
      </div>
    );
  }

  const isImage = fileInfo.mime_type.startsWith('image/');
  const isText =
    fileInfo.mime_type.startsWith('text/') ||
    ['application/json', 'application/javascript', 'application/xml', 'application/x-yaml'].includes(
      fileInfo.mime_type,
    );

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* Minimal header */}
      <header className="sticky top-0 z-10 bg-canvas/80 backdrop-blur-sm border-b border-hairline">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            aria-label={t('public.backHome')}
          >
            ← {t('public.backHome')}
          </Button>
          <div className="flex items-center gap-2">
            <CountdownCircle
              expiresAt={fileInfo.expires_at}
              size={22}
              strokeWidth={2}
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* File info */}
          <div className="mb-6">
            <h1 className="text-title font-display text-ink mb-2 break-words">
              {fileInfo.filename}
            </h1>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>{formatSize(fileInfo.file_size)}</span>
              <span>·</span>
              <span>{fileInfo.mime_type}</span>
              <span>·</span>
              <span>
                {t('transfer.expires')}: {new Date(fileInfo.expires_at).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Download button — always visible */}
          <div className="mb-6">
            <Button variant="primary" size="md" onClick={handleDownload}>
              <svg
                className="w-4 h-4 mr-2"
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
              {t('public.download')}
            </Button>
          </div>

          {/* Preview */}
          {isImage && imageUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl overflow-hidden bg-canvas-card border border-hairline-soft"
            >
              <img
                src={imageUrl}
                alt={fileInfo.filename}
                className="w-full h-auto max-h-[70vh] object-contain"
              />
            </motion.div>
          )}

          {isText && textContent !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl overflow-hidden bg-canvas-card border border-hairline-soft p-4"
            >
              <pre className="text-xs font-mono text-body whitespace-pre-wrap break-words leading-relaxed select-text max-h-[60vh] overflow-y-auto">
                {textContent}
              </pre>
            </motion.div>
          )}

          {!isImage && !isText && (
            <div className="text-center py-12">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-muted-soft"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className="text-sm text-muted mb-4">
                {t('public.preview')} {t('transfer.filterOther')}
              </p>
              <Button variant="primary" onClick={handleDownload}>
                {t('public.download')}
              </Button>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
