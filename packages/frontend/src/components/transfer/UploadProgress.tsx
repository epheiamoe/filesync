/**
 * UploadProgress — Per-file progress bar with spring animation.
 */

import { motion } from 'framer-motion';
import { t } from '@/i18n';

interface UploadTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'encrypting' | 'complete' | 'error';
  error?: string;
}

interface UploadProgressProps {
  task: UploadTask;
}

export function UploadProgress({ task }: UploadProgressProps) {
  const statusText = {
    pending: t('transfer.uploading'),
    encrypting: t('transfer.uploading'),
    uploading: `${task.progress}%`,
    complete: t('transfer.download'),
    error: task.error || t('common.error'),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="bg-canvas-card rounded-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-body truncate flex-1 mr-2">{task.name}</span>
        <span
          className={`text-xs flex-shrink-0 ${
            task.status === 'error' ? 'text-error' : 'text-muted'
          }`}
        >
          {statusText[task.status]}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-hairline rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${
            task.status === 'error' ? 'bg-error' : 'bg-primary'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${task.progress}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />
      </div>

      {/* Cancel button for active uploads */}
      {task.status === 'uploading' && (
        <button
          className="mt-2 text-xs text-muted hover:text-error transition-colors"
          aria-label={`${t('common.cancel')} ${task.name}`}
        >
          {t('common.cancel')}
        </button>
      )}
    </motion.div>
  );
}
