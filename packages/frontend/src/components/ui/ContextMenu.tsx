/**
 * ContextMenu component — Telegram-style right-click / long-press menu.
 *
 * Positions near the cursor on desktop; shows as bottom sheet on mobile.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: ContextMenuItem[];
  position: { x: number; y: number } | null;
}

export function ContextMenu({ isOpen, onClose, items, position }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && position && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            left: `${Math.min(position.x, window.innerWidth - 180)}px`,
            top: `${Math.min(position.y, window.innerHeight - 200)}px`,
            zIndex: 1000,
            transformOrigin: 'top left',
          }}
          className="min-w-[160px] bg-canvas border border-hairline rounded-lg shadow-lg py-1 overflow-hidden"
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              onClick={() => {
                item.onClick();
                onClose();
              }}
              className={`
                w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left
                hover:bg-canvas-card transition-colors duration-100
                ${item.danger ? 'text-error' : 'text-ink'}
              `.trim().replace(/\s+/g, ' ')}
            >
              {item.icon && <span className="w-4 h-4">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
