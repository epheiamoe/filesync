/**
 * ChatInput — Auto-resizing textarea with file attach + send button.
 *
 * Features:
 * - Paperclip button to open file picker (for both Chat and Transfer views)
 * - Auto-resize (max 4 lines)
 * - Enter to send, Shift+Enter for newline
 * - Circular coral send button with pulse animation
 */

import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { t } from '@/i18n';

interface ChatInputProps {
  onSend: (text: string) => void;
  onFileSelect?: (files: FileList) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, onFileSelect, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [pulse, setPulse] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
    // Trigger pulse animation
    setPulse(true);
    setTimeout(() => setPulse(false), 300);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;

    // Auto-resize
    el.style.height = 'auto';
    const maxHeight = 6 * 24; // ~6 lines
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect?.(e.target.files);
      // Reset so the same file can be re-selected
      e.target.value = '';
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="flex items-end gap-2 bg-canvas border-t border-hairline pt-3 pb-safe">
      {/* File attach button — always visible for both Chat and Transfer */}
      {onFileSelect && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />
          <motion.button
            onClick={handleFileClick}
            disabled={disabled}
            className={`
              flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
              transition-colors duration-150
              ${disabled
                ? 'bg-hairline text-muted cursor-not-allowed'
                : 'bg-canvas-card text-muted hover:text-primary hover:bg-canvas-soft'
              }
            `.trim().replace(/\s+/g, ' ')}
            whileTap={{ scale: 0.9 }}
            aria-label={t('chat.attachFile')}
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
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </motion.button>
        </>
      )}

      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          disabled={disabled}
          rows={1}
          className={`
            w-full resize-none px-3.5 py-2.5 bg-canvas-card text-sm text-body
            rounded-lg placeholder:text-muted-soft
            border border-hairline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            disabled:opacity-50
          `.trim().replace(/\s+/g, ' ')}
          aria-label={t('chat.placeholder')}
        />
      </div>

      <motion.button
        onClick={handleSend}
        disabled={!hasText || disabled}
        className={`
          flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
          transition-colors duration-150
          ${hasText && !disabled
            ? 'bg-primary text-on-primary hover:bg-primary-active'
            : 'bg-hairline text-muted cursor-not-allowed'
          }
        `.trim().replace(/\s+/g, ' ')}
        whileTap={{ scale: 0.9 }}
        animate={pulse ? { scale: [1, 1.15, 1] } : {}}
        transition={{ duration: 0.3 }}
        aria-label={t('chat.send')}
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
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </svg>
      </motion.button>
    </div>
  );
}
