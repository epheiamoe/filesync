/**
 * MessageBubble — Chat message bubble with Telegram-style animations.
 *
 * Features:
 * - Device label above bubble
 * - Decrypted message content
 * - Timestamp below
 * - Auto-collapse for long text (>300 chars)
 * - Right-click / long-press context menu with recall option
 * - Recalled messages shown with italic muted style
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { ExpandableText } from '@/components/ui/ExpandableText';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { DestroyAnimation } from '@/components/ui/DestroyAnimation';
import type { MessageDTO } from '@/lib/store';

interface MessageBubbleProps {
  message: MessageDTO;
  decryptedContent: string | undefined;
  roomCode: string;
  /** Whether this message was sent by the current session — controls alignment. */
  isSelf?: boolean;
}

export function MessageBubble({ message, decryptedContent, roomCode, isSelf = false }: MessageBubbleProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [isDestroying, setIsDestroying] = useState(false);
  const session = useStore((s) => s.session);
  const removeMessage = useStore((s) => s.removeMessage);
  const addToast = useStore((s) => s.addToast);

  const isRecalled = !!message.recalled_at;
  const isOwnMessage = message.sender_session_id === session?.token;

  const handleCopy = useCallback(async () => {
    if (!decryptedContent) return;
    try {
      await navigator.clipboard.writeText(decryptedContent);
      addToast({ type: 'success', message: t('chat.copied') });
    } catch {
      // Fallback for non-HTTPS or older browsers
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [decryptedContent, addToast]);

  const handleRecall = useCallback(async () => {
    try {
      await api.recallMessage(message.id, message.room_id);
      // Start destruction animation — onDestroyed will remove from store
      setIsDestroying(true);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [message.id, message.room_id, addToast]);

  const handleDestroyed = useCallback(() => {
    removeMessage(message.id);
    addToast({ type: 'info', message: t('chat.recalled') });
  }, [message.id, removeMessage, addToast]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleLongPress = () => {
    // On mobile, check if it's a touch device
    if ('ontouchstart' in window) {
      setBottomSheetOpen(true);
    }
  };

  const menuItems: ContextMenuItem[] = [
    {
      key: 'copy',
      label: t('chat.copy'),
      onClick: handleCopy,
    },
    ...(isOwnMessage && !isRecalled
      ? [
          {
            key: 'recall' as const,
            label: t('chat.recall'),
            danger: true,
            onClick: handleRecall,
          },
        ]
      : []),
  ];

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      <DestroyAnimation isDestroying={isDestroying} onDestroyed={handleDestroyed}>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20, scale: 0.97 },
            visible: {
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { type: 'spring', stiffness: 300, damping: 30 },
            },
          }}
          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
          onContextMenu={handleContextMenu}
          onTouchStart={() => {
            // Long press handling — start a timer
            const timer = setTimeout(() => handleLongPress(), 500);
            const cancel = () => clearTimeout(timer);
            document.addEventListener('touchend', cancel, { once: true });
            document.addEventListener('touchmove', cancel, { once: true });
          }}
          className={`group flex flex-col gap-0.5 ${isRecalled || isDestroying ? 'opacity-60' : ''} ${isSelf ? 'items-end' : 'items-start'}`}
        >
          {/* Device label */}
          {message.device_label && (
            <span className="text-[11px] text-muted-soft px-1">
              {message.device_label}
            </span>
          )}

          {/* Bubble */}
          <div
            className={`
              max-w-[85%] sm:max-w-[70%] rounded-lg px-3.5 py-2.5
              ${isRecalled
                ? 'bg-canvas-card italic text-muted'
                : isSelf
                  ? 'bg-primary/10 text-body'
                  : 'bg-canvas-card text-body'
              }
            `.trim().replace(/\s+/g, ' ')}
          >
            {isRecalled ? (
              <p className="text-sm italic">{t('chat.recalled')}</p>
            ) : decryptedContent ? (
              <ExpandableText text={decryptedContent} maxLength={300} />
            ) : (
              <p className="text-sm text-muted-soft animate-pulse-soft">
                {t('common.loading')}
              </p>
            )}
          </div>

          {/* Timestamp */}
          <span className="text-[10px] text-muted-soft px-1">{time}</span>
        </motion.div>
      </DestroyAnimation>

      {/* Desktop context menu */}
      <ContextMenu
        isOpen={!!contextMenu}
        onClose={() => setContextMenu(null)}
        items={menuItems}
        position={contextMenu}
      />

      {/* Mobile bottom sheet */}
      <BottomSheet
        isOpen={bottomSheetOpen}
        onClose={() => setBottomSheetOpen(false)}
      >
        <div className="flex flex-col gap-1">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                item.onClick();
                setBottomSheetOpen(false);
              }}
              className={`
                w-full text-left px-4 py-3 rounded-md text-sm
                ${item.danger ? 'text-error' : 'text-ink'}
                hover:bg-canvas-card transition-colors
              `.trim().replace(/\s+/g, ' ')}
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setBottomSheetOpen(false)}
            className="w-full text-left px-4 py-3 rounded-md text-sm text-muted hover:bg-canvas-card transition-colors mt-2"
          >
            {t('common.cancel')}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
