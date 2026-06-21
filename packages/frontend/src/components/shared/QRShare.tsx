/**
 * QRShare component — QR code generation and display for room sharing.
 *
 * Features:
 * - Simple QR: share string only (always visible)
 * - Full QR: login URL with share string + temp credential (admin only)
 * - "Generate Quick QR" button for admin users to create temp credentials
 * - Animated reveal with spring physics
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { useStore } from '@/lib/store';
import { buildLoginUrl } from '@/lib/url';
import { Button } from '@/components/ui/Button';

interface CredentialResult {
  code: string;
  expires_at: string;
}

interface QRShareProps {
  shareString: string;
  roomCode: string;
  isOpen: boolean;
  onClose: () => void;
  /** Whether the current user is an admin (shows "Generate Quick QR" button) */
  isAdmin?: boolean;
  /** Pre-built full QR URL (login URL with credential embedded) */
  fullQrUrl?: string;
  /** Callback to generate a temp credential — admin only */
  onGenerateCredential?: () => Promise<CredentialResult>;
}

export function QRShare({
  shareString,
  roomCode,
  isOpen,
  onClose,
  isAdmin = false,
  fullQrUrl,
  onGenerateCredential,
}: QRShareProps) {
  const simpleCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);
  const [copiedSimple, setCopiedSimple] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCredCode, setCopiedCredCode] = useState(false);
  const [showFullQR, setShowFullQR] = useState(false);
  const [generatedCred, setGeneratedCred] = useState<CredentialResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedFullUrl, setGeneratedFullUrl] = useState('');
  const navigate = useNavigate();
  const addToast = useStore((s) => s.addToast);

  // ---- Simple QR rendering ----
  useEffect(() => {
    if (!isOpen || !simpleCanvasRef.current) return;
    import('qrcode').then((QRCode) => {
      if (simpleCanvasRef.current) {
        QRCode.toCanvas(simpleCanvasRef.current, shareString, {
          width: 256,
          margin: 2,
          color: {
            dark: '#141413',
            light: '#faf9f5',
          },
        });
      }
    });
  }, [isOpen, shareString]);

  // ---- Full QR rendering ----
  useEffect(() => {
    if (!isOpen || !fullCanvasRef.current) return;
    const targetUrl = fullQrUrl || generatedFullUrl;
    if (!targetUrl) return;
    import('qrcode').then((QRCode) => {
      if (fullCanvasRef.current) {
        QRCode.toCanvas(fullCanvasRef.current, targetUrl, {
          width: 256,
          margin: 2,
          color: {
            dark: '#141413',
            light: '#faf9f5',
          },
        });
      }
    });
  }, [isOpen, fullQrUrl, generatedFullUrl]);

  // ---- Has full QR available? ----
  const hasFullQR = !!(fullQrUrl || generatedCred);

  // ---- Auto-show full QR tab when generated ----
  useEffect(() => {
    if (generatedCred) {
      setShowFullQR(true);
    }
  }, [generatedCred]);

  // ---- Copy handlers ----
  const handleCopySimple = async () => {
    try {
      await navigator.clipboard.writeText(shareString);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareString;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedSimple(true);
    setTimeout(() => setCopiedSimple(false), 2000);
    addToast({ type: 'success', message: t('chat.copied') });
  };

  const handleCopyUrl = async () => {
    const url = fullQrUrl || generatedFullUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    addToast({ type: 'success', message: t('chat.copied') });
  };

  const handleCopyCredCode = async () => {
    if (!generatedCred) return;
    try {
      await navigator.clipboard.writeText(generatedCred.code);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = generatedCred.code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedCredCode(true);
    setTimeout(() => setCopiedCredCode(false), 2000);
    addToast({ type: 'success', message: t('chat.copied') });
  };

  // ---- Generate credential ----
  const handleGenerate = async () => {
    if (!onGenerateCredential) return;
    setGenerating(true);
    try {
      const cred = await onGenerateCredential();
      setGeneratedCred(cred);
      setGeneratedFullUrl(buildLoginUrl(shareString, cred.code));
    } catch {
      // Error handled by caller (toast)
    } finally {
      setGenerating(false);
    }
  };

  // ---- Export ----
  const handleExport = () => {
    const blob = new Blob([shareString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epheia-room-${roomCode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Full QR URL display ----
  const displayFullUrl = fullQrUrl || generatedFullUrl;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/40 z-[800] flex items-center justify-center p-4"
            onClick={onClose}
          >
            {/* Modal */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="bg-canvas rounded-xl p-8 max-w-sm w-full shadow-xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t('rooms.shareString')}
            >
              <h2 className="text-display-sm font-display text-ink mb-4 text-center">
                {t('rooms.shareString')}
              </h2>

              {/* Tab bar: Simple QR | Full QR */}
              {hasFullQR && (
                <div className="flex rounded-lg bg-canvas-card p-0.5 mb-4" role="tablist" aria-label={t('rooms.shareString')}>
                  <button
                    role="tab"
                    aria-selected={!showFullQR}
                    onClick={() => setShowFullQR(false)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      !showFullQR
                        ? 'bg-canvas text-ink shadow-sm'
                        : 'text-muted hover:text-body'
                    }`}
                  >
                    {t('rooms.simpleQR')}
                  </button>
                  <button
                    role="tab"
                    aria-selected={showFullQR}
                    onClick={() => setShowFullQR(true)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      showFullQR
                        ? 'bg-canvas text-ink shadow-sm'
                        : 'text-muted hover:text-body'
                    }`}
                  >
                    {t('rooms.fullQR')}
                  </button>
                </div>
              )}

              {/* Simple QR Code */}
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
                className={`flex justify-center mb-4 ${showFullQR ? 'hidden' : ''}`}
              >
                <canvas
                  ref={simpleCanvasRef}
                  className="border-4 border-hairline rounded-lg"
                  aria-label={t('rooms.simpleQrCode')}
                />
              </motion.div>

              {/* Full QR Code */}
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
                className={`flex justify-center mb-4 ${!showFullQR ? 'hidden' : ''}`}
              >
                <canvas
                  ref={fullCanvasRef}
                  className="border-4 border-hairline rounded-lg"
                  aria-label={t('rooms.fullQrCode')}
                />
              </motion.div>

              {/* Admin: Generate Quick QR button */}
              {isAdmin && onGenerateCredential && (
                <div className="mb-4 p-3 bg-canvas-card rounded-lg">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onClick={handleGenerate}
                    loading={generating}
                    disabled={generating}
                  >
                    {t('rooms.generateQuickQR')}
                  </Button>

                  {generatedCred && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-3 space-y-2 overflow-hidden"
                    >
                      <p className="text-[10px] text-muted">
                        {t('rooms.quickQRExpires')}: {new Date(generatedCred.expires_at).toLocaleString()}
                      </p>
                      <div className="flex gap-2">
                        <code className="flex-1 px-2 py-1 bg-canvas rounded text-xs font-mono text-body truncate">
                          {generatedCred.code}
                        </code>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleCopyCredCode}
                          aria-label={copiedCredCode ? t('common.copied') : t('common.copy')}
                        >
                          {copiedCredCode ? t('common.copied') : t('common.copy')}
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* Full QR URL display */}
              {showFullQR && displayFullUrl && (
                <div className="mb-4">
                  <label className="text-xs text-muted mb-1 block">
                    {t('rooms.fullQRUrl')}
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 bg-canvas-card rounded-md text-[10px] font-mono text-body break-all">
                      {displayFullUrl}
                    </code>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCopyUrl}
                      aria-label={copiedUrl ? t('common.copied') : t('common.copy')}
                    >
                      {copiedUrl ? t('common.copied') : t('common.copy')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Share string (always visible) */}
              <div className="mb-4">
                <label className="text-xs text-muted mb-1 block">
                  {t('rooms.shareString')}
                </label>
                <div className="flex gap-2">
                  <code className="flex-1 px-3 py-2 bg-canvas-card rounded-md text-xs font-mono text-body break-all">
                    {shareString}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopySimple}
                    aria-label={copiedSimple ? t('common.copied') : t('common.copy')}
                  >
                    {copiedSimple ? t('common.copied') : t('common.copy')}
                  </Button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 mt-6">
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  onClick={() => {
                    onClose();
                    navigate(`/room/${roomCode}`);
                  }}
                >
                  {t('rooms.enterRoom')}
                </Button>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onClick={handleExport}
                  >
                    {t('rooms.exportKey')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    fullWidth
                    onClick={onClose}
                  >
                    {t('common.close')}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
