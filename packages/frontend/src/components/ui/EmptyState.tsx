/**
 * EmptyState component — Empty list illustration + message.
 */

import { t } from '@/i18n';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  message = t('common.empty'),
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon ? (
        <div className="w-16 h-16 mb-4 text-muted-soft">{icon}</div>
      ) : (
        <div className="w-16 h-16 mb-4 rounded-full bg-canvas-card flex items-center justify-center">
          <svg
            className="w-8 h-8 text-muted-soft"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
      )}
      {title && (
        <h3 className="text-title-sm font-display text-ink mb-1">{title}</h3>
      )}
      <p className="text-sm text-muted mb-6 max-w-xs">{message}</p>
      {action}
    </div>
  );
}
