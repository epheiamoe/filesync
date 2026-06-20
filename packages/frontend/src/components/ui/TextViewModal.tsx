/**
 * TextViewModal — Modal dialog for viewing text file content.
 *
 * Displays file content in a scrollable <pre> area with monospace font.
 * Features:
 * - Title bar with filename
 * - Close button (×) in title bar
 * - Scrollable content area
 * - Bottom action bar: "Copy All Content" + "Copy Link" (public files only)
 * - Framer-motion slide-up animation from bottom
 *
 * Accessibility:
 * - role="dialog" + aria-modal="true" + aria-labelledby for screen readers
 * - Focus trap: focuses the close button on open
 * - Escape key closes the modal
 * - Click outside (on overlay) closes the modal
 *
 * Why a modal instead of inline expansion:
 * - Text files can be very long (e.g., logs, source code)
 * - A modal provides dedicated space for reading without disrupting the chat flow
 * - Bottom action bar is always visible for quick copy actions
 *
 * Why no syntax highlighting (MVP):
 * - Adding a syntax highlighter (Prism/Shiki) adds ~50KB+ to the bundle
 * - For MVP, plain text with monospace font is sufficient
 * - [Debt: Accessibility/i18n] Future: add opt-in syntax highlighting via dynamic import
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';

export interface TextViewModalProps {
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Called when the user wants to close the modal. */
  onClose: () => void;
  /** Display name of the file (decrypted filename). */
  fileName: string;
  /** The text content to display. */
  content: string;
  /** Whether the file is publicly shared. Enables "Copy Link" button. */
  isPublic: boolean;
  /** The public URL for the file (used by "Copy Link" button). */
  publicUrl: string;
}

export function TextViewModal({
  isOpen,
  onClose,
  fileName,
  content,
  isPublic,
  publicUrl,
}: TextViewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  // Focus trap + body scroll lock
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 150);
      document.body.style.overflow = 'hidden';
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Click overlay to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Copy all content to clipboard
  const handleCopyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: ignore clipboard error in non-HTTPS contexts
    }
  }, [content]);

  // Copy public link to clipboard
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      // ignore
    }
  }, [publicUrl]);

  // Reset copied state when modal closes
  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  const titleId = 'text-view-modal-title';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          onClick={handleOverlayClick}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

          {/* Modal panel — slides up from bottom on mobile, scale-in on desktop */}
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="relative w-full sm:max-w-2xl sm:max-h-[85vh] sm:rounded-xl bg-canvas shadow-2xl flex flex-col max-h-[92vh] rounded-t-xl sm:rounded-xl overflow-hidden"
          >
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline flex-shrink-0">
              <h2
                id={titleId}
                className="text-sm font-medium text-body truncate pr-2"
              >
                {t('chat.textPreview')}: {fileName}
              </h2>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-canvas-card text-muted hover:text-ink transition-colors flex-shrink-0"
                aria-label={t('common.close')}
              >
                <svg
                  className="w-5 h-5"
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

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-xs font-mono text-body whitespace-pre-wrap break-words leading-relaxed select-text">
                {content}
              </pre>
            </div>

            {/* Bottom action bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-hairline flex-shrink-0 bg-canvas-card/50">
              {/* Copy all content */}
              <button
                onClick={handleCopyContent}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors
                  ${copied
                    ? 'bg-success/10 text-success'
                    : 'bg-canvas-card text-body hover:bg-primary/10 hover:text-primary'
                  }
                `.trim().replace(/\s+/g, ' ')}
                aria-label={t('chat.copyContent')}
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {copied ? (
                    <polyline points="20 6 9 17 4 12" />
                  ) : (
                    <>
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </>
                  )}
                </svg>
                {copied ? t('chat.contentCopied') : t('chat.copyContent')}
              </button>

              {/* Copy Link (only for public files) */}
              {isPublic && (
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-canvas-card text-body hover:bg-primary/10 hover:text-primary transition-colors"
                  aria-label={t('chat.copyLink')}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                  {t('chat.copyLink')}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
