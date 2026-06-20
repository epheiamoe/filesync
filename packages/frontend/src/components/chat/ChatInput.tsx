/**
 * ChatInput — Auto-resizing textarea with file attach + send button.
 *
 * Features:
 * - Paperclip button to open file picker (for both Chat and Transfer views)
 * - Public file toggle + auto-destroy time selector (above textarea)
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
  /** Whether the file being uploaded should be public (unencrypted, shareable). */
  uploadIsPublic?: boolean;
  /** Callback when the public toggle changes. */
  onUploadPublicChange?: (isPublic: boolean) => void;
  /** Auto-destroy TTL in minutes (10, 30, 60, 360, 1440). */
  uploadTTLMinutes?: number;
  /** Callback when auto-destroy TTL changes. */
  onUploadTTLChange?: (minutes: number) => void;
  /** Whether to show upload settings (public toggle + auto-destroy selector). */
  showUploadSettings?: boolean;
}

const TTL_OPTIONS = [
  { value: 10, label: 'transfer.destroy10min' },
  { value: 30, label: 'transfer.destroy30min' },
  { value: 60, label: 'transfer.destroy1hr' },
  { value: 360, label: 'transfer.destroy6hr' },
  { value: 1440, label: 'transfer.destroy24hr' },
];

export function ChatInput({
  onSend,
  onFileSelect,
  disabled,
  uploadIsPublic = false,
  onUploadPublicChange,
  uploadTTLMinutes = 10,
  onUploadTTLChange,
  showUploadSettings = true,
}: ChatInputProps) {
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
    <div className="bg-canvas border-t border-hairline pt-3 pb-safe">
      {/* Upload settings: public toggle + auto-destroy selector */}
      {onFileSelect && showUploadSettings && (
        <div className="flex items-center gap-4 mb-2 px-1 flex-wrap">
          {/* Public file toggle */}
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={uploadIsPublic}
              onChange={(e) => onUploadPublicChange?.(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-hairline text-primary focus:ring-primary/20"
              aria-label={t('transfer.publicCheckbox')}
            />
            {t('transfer.publicCheckbox')}
          </label>

          {/* Auto-destroy selector */}
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span>{t('transfer.autoDestroy')}:</span>
            <select
              value={uploadTTLMinutes}
              onChange={(e) => onUploadTTLChange?.(Number(e.target.value))}
              className="text-xs border border-hairline rounded px-1.5 py-0.5 bg-canvas-card text-body"
              aria-label={t('transfer.autoDestroy')}
            >
              {TTL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="flex items-end gap-2">
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
    </div>
  );
}
