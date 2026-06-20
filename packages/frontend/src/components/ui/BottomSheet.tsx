/**
 * BottomSheet component — Mobile bottom sheet overlay.
 *
 * Slides up from bottom with spring animation.
 * Used for mobile long-press menus and action sheets.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-ink/40 z-[900]"
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[901] bg-canvas rounded-t-xl max-h-[80vh] overflow-y-auto pb-safe"
            role="dialog"
            aria-modal="true"
            aria-label={title || '菜单'}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-hairline rounded-full" />
            </div>
            {title && (
              <h3 className="px-6 py-2 text-sm font-medium text-muted text-center">
                {title}
              </h3>
            )}
            <div className="px-4 pb-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
