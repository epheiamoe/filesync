/**
 * Toast component — Notification toasts using framer-motion.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useStore, type Toast as ToastType } from '@/lib/store';

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useStore((s) => s.removeToast);

  const typeStyles = {
    success: 'bg-success text-on-primary',
    error: 'bg-error text-on-primary',
    info: 'bg-surface-dark text-on-dark',
  };

  const icons = {
    success: '✓',
    error: '✗',
    info: 'i',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg min-w-[280px] max-w-[400px]
        ${typeStyles[toast.type]}
      `}
      role="alert"
    >
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
        {icons[toast.type]}
      </span>
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="关闭通知"
      >
        ×
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);

  return (
    <div
      className="fixed bottom-6 right-6 z-[1100] flex flex-col gap-2"
      aria-live="polite"
      aria-label="通知"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
