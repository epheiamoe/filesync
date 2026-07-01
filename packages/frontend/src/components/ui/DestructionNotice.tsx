/**
 * DestructionNotice — Aggregated "items destroyed" notification.
 *
 * Replaces the previous per-item expired toast with a single iMessage-style
 * stacked card that shows how many messages/files were destroyed in the last
 * minute. It is fixed to the top of the viewport so it never covers the input
 * bar or the newest messages.
 *
 * Lifecycle:
 * - Appears when at least one destruction event is reported.
 * - Counts unique source IDs within a 60-second rolling window.
 * - Automatically dismisses after 10 seconds of idle time (no new events).
 * - Can be dismissed immediately by swiping up or clicking the close button.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { useStore } from '@/lib/store';

/** Swipe distance threshold (px) to dismiss the notice upward. */
const DISMISS_DRAG_THRESHOLD = -100;

export function DestructionNotice() {
  const destructionEvents = useStore((s) => s.destructionEvents);
  const dismissDestruction = useStore((s) => s.dismissDestruction);

  const count = destructionEvents.length;
  const visible = count > 0;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[1100] flex justify-center pointer-events-none"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            key="destruction-notice"
            initial={{ y: -80, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.3}
            onDragEnd={(_, info) => {
              if (
                info.offset.y < DISMISS_DRAG_THRESHOLD ||
                info.velocity.y < -500
              ) {
                dismissDestruction();
              }
            }}
            className="relative w-[calc(100%-2rem)] max-w-sm pointer-events-auto"
            role="alert"
          >
            {/* iMessage-style stacked deck behind the main card. */}
            <div className="relative">
              <div
                className="
                  relative z-[3] w-full
                  bg-surface-dark text-on-dark
                  rounded-xl px-4 py-3 shadow-xl
                  flex items-center gap-3
                  /* iMessage-style stacked ghost cards behind the main card. */
                  before:content-[''] before:absolute before:inset-x-0 before:bottom-0 before:-z-10
                    before:h-full before:rounded-xl before:bg-black/[0.08]
                    before:translate-y-[3px] before:scale-[0.98]
                  after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:-z-20
                    after:h-full after:rounded-xl after:bg-black/[0.04]
                    after:translate-y-[6px] after:scale-[0.96]
                "
              >
                {/* Flame icon (SVG) indicating destructive action. */}
                <svg
                  className="w-5 h-5 flex-shrink-0 text-error"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 2c0 4-4 6-4 10 0 2.21 1.79 4 4 4s4-1.79 4-4c0-4-4-6-4-10z" />
                  <path d="M12 12c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                </svg>

                <p className="text-sm flex-1">
                  {t('chat.destructionTitle', { count: String(count) })}
                </p>

                <button
                  type="button"
                  onClick={() => dismissDestruction()}
                  data-testid="destruction-close"
                  className="
                    flex-shrink-0 w-6 h-6 -mr-1
                    flex items-center justify-center
                    rounded-full
                    opacity-70 hover:opacity-100
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50
                    transition-opacity
                  "
                  aria-label={t('common.closeNotification')}
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
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
