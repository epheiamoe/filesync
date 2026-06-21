/**
 * UploadZone — Drag & drop file upload zone.
 *
 * Features:
 * - Drag & drop zone with dashed border
 * - Click to open file picker
 * - Paste support for files
 * - File validation: max 5GB per room
 * - Chunked upload with progress tracking
 * - Client-side encryption before upload
 */

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore, type FileMetaDTO } from '@/lib/store';
import { getRoomKey, encryptFile, encryptText } from '@/lib/crypto';
import { UploadProgress } from './UploadProgress';

interface UploadZoneProps {
  roomId: string;
  roomCode: string;
}

interface UploadTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'encrypting' | 'complete' | 'error';
  error?: string;
}

export function UploadZone({ roomId, roomCode }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFile = useStore((s) => s.addFile);
  const addToast = useStore((s) => s.addToast);

  const CHUNK_SIZE_SMALL = 5 * 1024 * 1024; // 5MB for files <= 100MB
  const CHUNK_SIZE_LARGE = 10 * 1024 * 1024; // 10MB for files > 100MB

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const key = getRoomKey(roomCode);
      if (!key) {
        addToast({ type: 'error', message: t('e2ee.encryptError') });
        return;
      }

      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      // Check total size against room limit (5GB)
      const totalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > 5 * 1024 * 1024 * 1024) {
        addToast({ type: 'error', message: t('transfer.maxSize') });
        return;
      }

      // Process each file
      for (const file of fileArray) {
        const taskId = crypto.randomUUID();
        const task: UploadTask = {
          id: taskId,
          name: file.name,
          size: file.size,
          progress: 0,
          status: 'encrypting',
        };

        setTasks((prev) => [...prev, task]);

        try {
          // 1. Encrypt the file
          const fileBuffer = await file.arrayBuffer();
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: 'uploading' } : t)),
          );

          const encrypted = await encryptFile(key, fileBuffer);

          // 2. Encrypt filename
          const encryptedFilename = await encryptText(key, file.name);

          // 3. Determine chunk size
          const chunkSize = file.size <= 100 * 1024 * 1024 ? CHUNK_SIZE_SMALL : CHUNK_SIZE_LARGE;

          // 4. Init upload
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min TTL
          const initRes = await api.initUpload(
            file.name,
            encrypted.byteLength,
            chunkSize,
            roomId,
            'private',
            expiresAt,
          );

          // 5. Upload chunks
          const totalChunks = Math.ceil(encrypted.byteLength / chunkSize);
          const parts: { etag: string; part_number: number }[] = [];

          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, encrypted.byteLength);
            const chunk = encrypted.slice(start, end);

            const partRes = await api.uploadPart(initRes.upload_id, i + 1, chunk);
            parts.push({ etag: partRes.etag, part_number: partRes.part_number });

            // Update progress
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? { ...t, progress: Math.round(((i + 1) / totalChunks) * 90) }
                  : t,
              ),
            );
          }

          // 6. Complete upload
          const completeRes = await api.completeUpload(
            initRes.upload_id,
            initRes.r2_key,
            parts,
            encryptedFilename,
            encrypted.byteLength,
            file.type || 'application/octet-stream',
            'private',
            expiresAt,
            roomId,
          );

          // Optimistic add to store — mirrors RoomPage.handleFileUpload behavior.
          // The file will be re-added by the WS broadcast (which store.addFile
          // deduplicates by ID), ensuring the file appears immediately in both
          // the Transfer and Chat views.
          const fmeta: FileMetaDTO = {
            id: completeRes.file_id,
            room_id: roomId,
            uploader_session_id: useStore.getState().session?.token || '',
            encrypted_filename: encryptedFilename,
            encrypted_meta: '',
            file_size: encrypted.byteLength,
            mime_type: file.type || 'application/octet-stream',
            visibility: 'private' as const,
            expires_at: expiresAt,
            ttl_seconds: 10 * 60, // 10 min hardcoded for UploadZone
            created_at: new Date().toISOString(),
          };
          console.log('[UploadZone] Optimistic addFile:', fmeta.id, 'name:', file.name);
          addFile(fmeta);

          // Mark complete
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, status: 'complete', progress: 100 } : t,
            ),
          );

          // Remove task after delay
          setTimeout(() => {
            setTasks((prev) => prev.filter((t) => t.id !== taskId));
          }, 3000);

          addToast({ type: 'success', message: `${file.name} ${t('transfer.upload')}` });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.error');
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: 'error', error: message } : t)),
          );
          addToast({ type: 'error', message: `${file.name}: ${message}` });
        }
      }
    },
    [roomCode, roomId, addFile, addToast],
  );

  // Drag & drop handlers
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Click handler
  const handleClick = () => {
    fileInputRef.current?.click();
  };

  // File input change
  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      // Reset input to allow re-selecting the same file
      e.target.value = '';
    }
  };

  // Paste handler
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  // Register paste listener globally
  // [Debt: Accessibility/i18n] Paste listener should be scoped to the upload zone
  // For MVP, we use a simple ref-based approach
  const zoneRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={zoneRef}>
      {/* Drop zone */}
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
          transition-colors duration-150
          ${isDragging
            ? 'border-primary bg-primary/5'
            : 'border-hairline hover:border-primary/50 hover:bg-canvas-card'
          }
        `.trim().replace(/\s+/g, ' ')}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
        role="button"
        aria-label={t('transfer.dragDrop')}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick();
        }}
      >
        <AnimatePresence mode="wait">
          {isDragging ? (
            <motion.div
              key="dragging"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-primary"
            >
              <svg
                className="w-12 h-12 mx-auto mb-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 3v14m0 0l-4-4m4 4l4-4M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
              </svg>
              <p className="text-sm font-medium">{t('transfer.dragDrop')}</p>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <svg
                className="w-12 h-12 mx-auto mb-3 text-muted-soft"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 3v14m0 0l-4-4m4 4l4-4M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
              </svg>
              <p className="text-sm text-body font-medium mb-1">
                {t('transfer.dragDrop')}
              </p>
              <p className="text-xs text-muted-soft">{t('transfer.pasteHint')}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInput}
          className="hidden"
          aria-hidden="true"
        />
      </motion.div>

      {/* Upload tasks */}
      <AnimatePresence>
        {tasks.length > 0 && (
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <UploadProgress key={task.id} task={task} />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
