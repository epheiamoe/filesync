/**
 * MemberListModal — Accessible modal showing the full list of online members.
 *
 * Features:
 * - Lists all online members with their deterministic display labels.
 * - Marks the current user with a "（你）" suffix.
 * - Empty state when no members are online.
 * - Keyboard friendly: focus trap, Escape to close, overlay click to close.
 *
 * Accessibility:
 * - role="dialog", aria-modal="true", aria-labelledby for screen readers.
 * - Focus moves to the close button when opened.
 * - Focus is trapped within the modal while open.
 * - Body scroll is locked while open.
 */

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import type { OnlineMember } from '@shared/types';

export interface MemberListModalProps {
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Called when the modal should close. */
  onClose: () => void;
  /** Full list of online members. */
  members: OnlineMember[];
  /** Current user's session id, used to mark "you". */
  currentSessionId: string;
}

export function MemberListModal({
  isOpen,
  onClose,
  members,
  currentSessionId,
}: MemberListModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus the close button on open and lock body scroll.
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
      document.body.style.overflow = 'hidden';
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [isOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Simple focus trap: if tabbing out of the modal, wrap focus back around.
  const handleTabKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
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
    },
    [],
  );

  const titleId = 'member-list-modal-title';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
        >
          {/* Overlay: click to close for pointer users. */}
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* Modal panel */}
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            onKeyDown={handleTabKey}
            className="relative w-full sm:max-w-md sm:max-h-[85vh] sm:rounded-xl bg-canvas shadow-2xl flex flex-col max-h-[92vh] rounded-t-xl overflow-hidden"
          >
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline flex-shrink-0">
              <h2
                id={titleId}
                className="text-sm font-medium text-body truncate pr-2"
              >
                {t('rooms.onlineMembers')}
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

            {/* Member list */}
            <div className="flex-1 overflow-y-auto p-4">
              {members.length === 0 ? (
                <p className="text-sm text-muted text-center py-6">
                  {t('rooms.noMembersOnline')}
                </p>
              ) : (
                <ul className="space-y-2" role="list">
                  {members.map((member) => {
                    const isYou = member.session_id === currentSessionId;
                    return (
                      <li
                        key={member.session_id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-canvas-card"
                      >
                        <span className="text-sm text-body truncate">
                          {member.display_label || member.device_label}
                        </span>
                        {isYou && (
                          <span className="text-xs text-muted shrink-0 ml-2">
                            {t('rooms.you')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
