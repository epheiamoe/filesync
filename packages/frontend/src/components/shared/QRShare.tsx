/**
 * QRShare component — QR code generation and display for room sharing.
 *
 * Uses the 'qrcode' package to generate QR codes from share strings.
 * Animated reveal with spring physics.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { Button } from '@/components/ui/Button';

interface QRShareProps {
  shareString: string;
  roomCode: string;
  isOpen: boolean;
  onClose: () => void;
}

export function QRShare({ shareString, roomCode, isOpen, onClose }: QRShareProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    // Dynamic import to avoid bundling qrcode if not used
    import('qrcode').then((QRCode) => {
      if (canvasRef.current) {
        QRCode.toCanvas(canvasRef.current, shareString, {
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = shareString;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExport = () => {
    const blob = new Blob([shareString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epheia-room-${roomCode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
              className="bg-canvas rounded-xl p-8 max-w-sm w-full shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t('rooms.shareString')}
            >
              <h2 className="text-display-sm font-display text-ink mb-6 text-center">
                {t('rooms.shareString')}
              </h2>

              {/* QR Code */}
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
                className="flex justify-center mb-6"
              >
                <canvas
                  ref={canvasRef}
                  className="border-4 border-hairline rounded-lg"
                  aria-label="房间分享二维码"
                />
              </motion.div>

              {/* Share string */}
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
                    onClick={handleCopy}
                    aria-label={copied ? t('common.copied') : t('common.copy')}
                  >
                    {copied ? t('common.copied') : t('common.copy')}
                  </Button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={handleExport}
                >
                  {t('rooms.exportKey')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  onClick={onClose}
                >
                  {t('common.close')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
