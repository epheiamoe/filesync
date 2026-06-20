/**
 * Card component — Claude design system.
 *
 * Surface-card background, rounded-lg, generous padding.
 */

import { type HTMLMotionProps, motion } from 'framer-motion';

interface CardProps extends HTMLMotionProps<'div'> {
  variant?: 'cream' | 'dark' | 'flat';
  padding?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}

const variantStyles = {
  cream: 'bg-canvas-card border border-hairline-soft',
  dark: 'bg-surface-dark text-on-dark border border-surface-dark-elevated',
  flat: 'bg-canvas border border-hairline',
};

const paddingStyles = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
  xl: 'p-8 sm:p-10',
};

export function Card({
  variant = 'cream',
  padding = 'xl',
  children,
  className = '',
  ...props
}: CardProps) {
  return (
    <motion.div
      className={`
        rounded-lg
        ${variantStyles[variant]}
        ${paddingStyles[padding]}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      {...props}
    >
      {children}
    </motion.div>
  );
}
