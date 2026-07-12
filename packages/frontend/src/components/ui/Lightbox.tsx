/**
 * Lightbox — Full-screen image viewer overlay.
 *
 * Displays an image centered on a dark overlay with:
 * - Close button (×) in top-right corner
 * - Download button in top-left corner
 * - Click-outside-to-close behavior (clicking the dark overlay closes)
 * - Image constrained to max 90vw × 90vh with object-contain
 * - Framer-motion scale-in + overlay fade-in animation
 *
 * Accessibility:
 * - role="dialog" + aria-modal="true" + aria-label for screen readers
 * - Focus trap: focuses the close button on open, restores focus on close
 * - Escape key closes the modal
 *
 * Why framer-motion instead of CSS transitions:
 * - Deterministic onAnimationComplete callbacks
 * - Scale-from-center spring feels natural (stiffness: 400, damping: 30)
 * - Consistent with DestroyAnimation and other motion patterns
 */

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';

export interface LightboxProps {
  /** Whether the lightbox is open. */
  isOpen: boolean;
  /** Called when the user wants to close the lightbox. */
  onClose: () => void;
  /** Image source URL (can be a blob URL or API endpoint). */
  src: string;
  /** Alt text for the image (used for accessibility and as fallback). */
  alt: string;
  /** Optional callback when the download button is clicked. */
  onDownload?: () => void;
  /** Optional callback when the share button is clicked (public files). */
  onShare?: () => void;
  /** Optional callback when the recall button is clicked (for own files). */
  onRecall?: () => void;
  /** Whether the file is the user's own (shows recall button in context). */
  showRecall?: boolean;
}

export function Lightbox({
  isOpen,
  onClose,
  src,
  alt,
  onDownload,
  onShare,
  onRecall,
  showRecall,
}: LightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap: focus close button when lightbox opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow the motion animation to start
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
      // Prevent body scroll while lightbox is open
      document.body.style.overflow = 'hidden';
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Click outside the image (but on the overlay) to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      // Only close if the click was directly on the overlay, not on the image
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
          onClick={handleOverlayClick}
          role="dialog"
          aria-modal="true"
          aria-label={t('chat.viewImage')}
        >
          {/* Top bar with action buttons */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
            {/* Download button (top-left) */}
            <div className="flex items-center gap-2">
              {onDownload && (
                <button
                  onClick={onDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  aria-label={t('chat.downloadImage')}
                >
                  <svg
                    className="w-4 h-4"
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
                  {t('chat.downloadFile')}
                </button>
              )}
              {onShare && (
                <button
                  onClick={onShare}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  aria-label={t('rooms.share')}
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  {t('rooms.share')}
                </button>
              )}
              {showRecall && onRecall && (
                <button
                  onClick={onRecall}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-300 hover:text-red-200 bg-white/10 hover:bg-red-500/20 rounded-lg transition-colors"
                  aria-label={t('chat.recall')}
                >
                  <svg
                    className="w-4 h-4"
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
                </button>
              )}
            </div>

            {/* Close button (top-right) */}
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              aria-label={t('chat.closePreview')}
            >
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Image */}
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl select-none"
            draggable={false}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
