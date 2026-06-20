/**
 * Input component — Claude design system.
 *
 * Standard text input with label, error state, and coral focus ring.
 */

import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-body-strong"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            px-3.5 py-2.5 bg-canvas text-ink text-sm rounded-md
            border transition-colors duration-150
            placeholder:text-muted-soft
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            disabled:bg-canvas-card disabled:cursor-not-allowed
            ${error ? 'border-error ring-1 ring-error/20' : 'border-hairline'}
            ${className}
          `.trim().replace(/\s+/g, ' ')}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
          }
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-error" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-soft">
            {hint}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
