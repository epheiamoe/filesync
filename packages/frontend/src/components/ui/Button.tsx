/**
 * Button component — Claude design system.
 *
 * Variants:
 * - primary: Coral background (#cc785c), white text
 * - secondary: Cream background with hairline border
 * - dark: Navy background, cream text
 * - ghost: Transparent, ink text
 * - danger: Error red background
 *
 * Uses framer-motion for press/hover animations.
 */

import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted',
  secondary:
    'bg-canvas text-ink border border-hairline hover:bg-canvas-soft',
  dark: 'bg-surface-dark text-on-dark hover:bg-surface-dark-elevated',
  ghost: 'bg-transparent text-ink hover:bg-canvas-card',
  danger:
    'bg-error text-on-primary hover:brightness-90',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-md',
  md: 'px-5 py-2.5 text-sm rounded-md',
  lg: 'px-6 py-3 text-base rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      children,
      loading = false,
      icon,
      fullWidth = false,
      className = '',
      disabled,
      ...props
    },
    ref,
  ) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
        whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
        className={`
          inline-flex items-center justify-center gap-2 font-medium
          transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-primary
          disabled:cursor-not-allowed
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `.trim().replace(/\s+/g, ' ')}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <SpinnerIcon />
        ) : icon ? (
          <span className="w-4 h-4 flex-shrink-0">{icon}</span>
        ) : null}
        {children}
      </motion.button>
    );
  },
);

Button.displayName = 'Button';

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin w-4 h-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
