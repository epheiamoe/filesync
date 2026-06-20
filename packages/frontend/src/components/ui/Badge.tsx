/**
 * Badge component — Claude design system.
 *
 * Pill-shaped badge with variants:
 * - default: Cream surface
 * - coral: Primary coral
 * - success: Green
 * - error: Red
 * - warning: Amber
 */

interface BadgeProps {
  variant?: 'default' | 'coral' | 'success' | 'error' | 'warning';
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  default: 'bg-canvas-card text-ink',
  coral: 'bg-primary text-on-primary',
  success: 'bg-success/15 text-success',
  error: 'bg-error/15 text-error',
  warning: 'bg-warning/15 text-warning',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-3 py-1 text-xs font-medium
        rounded-pill leading-none
        ${variantStyles[variant]}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </span>
  );
}
