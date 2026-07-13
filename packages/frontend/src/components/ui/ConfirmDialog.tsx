/**
 * ConfirmDialog — Reusable, accessible confirmation modal.
 *
 * Modeled after Cloudflare-style modals: clean, centered, prominent warning
 * icon, clear typography, and a constrained action area. Supports destructive
 * confirmations that require extra typed verification.
 *
 * Accessibility:
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - Focus is moved to the first focusable element when opened
 * - Escape closes the dialog
 * - Clicking the overlay closes the dialog
 * - Tab wraps between first and last focusable elements (basic focus trap)
 *
 * Why a custom dialog instead of window.confirm:
 * - Confirmation text can include rich context (prefix, copy button, hints)
 * - Users can interact with clipboard inside the dialog (copy/paste prefix)
 * - Consistent styling with the rest of the design system
 */

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  danger = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = 'confirm-dialog-title';

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus initial focusable element and body scroll lock
  useEffect(() => {
    if (!isOpen) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';

    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
      focusable[0]?.focus();
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen]);

  // Click overlay to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Basic focus trap: keep Tab inside the dialog
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={handleOverlayClick}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

          {/* Modal panel */}
          <motion.div
            ref={panelRef}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onKeyDown={handlePanelKeyDown}
            className="relative w-full max-w-md rounded-xl bg-canvas shadow-2xl overflow-hidden"
          >
            <div className="p-6 flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center"
                  aria-hidden="true"
                >
                  <svg
                    className="w-6 h-6 text-warning"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2
                    id={titleId}
                    className="text-title-sm font-display text-ink"
                  >
                    {title}
                  </h2>
                  <div className="mt-1 text-sm text-body leading-relaxed">
                    {description}
                  </div>
                </div>
              </div>

              {/* Optional extra content (e.g. verification input) */}
              {children && (
                <div className="flex flex-col gap-3">
                  {children}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end mt-1">
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="sm:w-auto"
                >
                  {cancelText}
                </Button>
                <Button
                  variant={danger ? 'danger' : 'primary'}
                  onClick={onConfirm}
                  disabled={confirmDisabled}
                  className="sm:w-auto"
                >
                  {confirmText}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
