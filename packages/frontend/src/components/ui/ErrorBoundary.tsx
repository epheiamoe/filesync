/**
 * ErrorBoundary — React error boundary for catching render errors.
 *
 * Wraps child components and catches unhandled errors during rendering.
 * Shows a fallback UI with the error message and a retry button that
 * resets the error state and re-renders the children.
 *
 * Why a class component:
 * - React error boundaries require `componentDidCatch` and/or
 *   `getDerivedStateFromError`, which are only available on class components
 *   (no hooks equivalent as of React 18/19).
 *
 * Why not toast-only:
 * - A render error can break the entire component subtree, so we need
 *   inline fallback UI to prevent a blank page.
 * - The retry button lets users recover without a full page refresh.
 *
 * Accessibility:
 * - Error message is marked with role="alert" for screen reader announcement.
 * - Retry button has a descriptive aria-label.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { t } from '@/i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console for debugging; structured logging can be added later.
    console.error('[ErrorBoundary] Caught render error:', error.message);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
    // [Debt: structured-logging] Send to remote logging service
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center gap-3 p-8 bg-canvas-card rounded-lg border border-hairline"
          role="alert"
        >
          <svg
            className="w-8 h-8 text-warning"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-muted text-center">
            {t('error.somethingWrong')}
          </p>
          {this.state.error && (
            <p className="text-xs text-muted-soft font-mono text-center max-w-md break-all">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm rounded-md bg-primary text-on-primary hover:bg-primary-active transition-colors"
            aria-label={t('error.retry')}
            type="button"
          >
            {t('error.retry')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
