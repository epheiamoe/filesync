/**
 * DestroyAnimation — Telegram-style destroy wrapper for framer-motion.
 *
 * Wraps children in a motion.div that animates scale→0 + opacity→0
 * with spring physics when `isDestroying` becomes true.
 * Calls `onDestroyed` when the animation completes, allowing the
 * parent to remove the item from the store.
 *
 * Why spring physics instead of CSS transition:
 * - framer-motion provides deterministic onAnimationComplete callbacks
 * - Spring stiffness: 300, damping: 25 gives ~400ms feel matching Telegram
 * - Using existing framer-motion dependency (already in bundle)
 *
 * Why a wrapper component instead of inline animation:
 * - Reusable across MessageBubble, ChatFileCard, FileItem, and RoomCard
 * - Encapsulates animation configuration in one place
 * - Makes it easy to tweak timing/feel across all destroyed items
 */

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface DestroyAnimationProps {
  /** When true, plays the destruction animation (scale→0, opacity→0). */
  isDestroying: boolean;
  /** Content to animate out when destroyed. */
  children: ReactNode;
  /** Called after the destruction animation completes. */
  onDestroyed?: () => void;
}

export function DestroyAnimation({
  isDestroying,
  children,
  onDestroyed,
}: DestroyAnimationProps) {
  return (
    <motion.div
      animate={
        isDestroying
          ? { scale: 0, opacity: 0 }
          : { scale: 1, opacity: 1 }
      }
      exit={{ opacity: 0, scale: 0, transition: { duration: 0.15 } }}
      transition={
        isDestroying
          ? { type: 'spring', stiffness: 300, damping: 25, duration: 0.4 }
          : { duration: 0 }
      }
      onAnimationComplete={() => {
        if (isDestroying && onDestroyed) {
          onDestroyed();
        }
      }}
    >
      {children}
    </motion.div>
  );
}
