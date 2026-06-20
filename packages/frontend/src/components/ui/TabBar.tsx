/**
 * TabBar component — Claude design system.
 *
 * Horizontal tab bar with active/inactive styling.
 * Active: surface-card background, ink text.
 * Inactive: transparent, muted text.
 */

import { motion } from 'framer-motion';

export interface Tab {
  key: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (key: string) => void;
  className?: string;
}

export function TabBar({ tabs, activeTab, onChange, className = '' }: TabBarProps) {
  return (
    <nav
      className={`flex gap-1 p-1 bg-canvas-card/50 rounded-lg ${className}`}
      role="tablist"
      aria-label="页面导航"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <motion.button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            aria-label={tab.label}
            onClick={() => onChange(tab.key)}
            className={`
              relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md
              transition-colors duration-150
              ${isActive ? 'bg-canvas-card text-ink' : 'text-muted hover:text-body'}
            `.trim().replace(/\s+/g, ' ')}
            whileTap={{ scale: 0.97 }}
          >
            {tab.icon && <span className="w-4 h-4">{tab.icon}</span>}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium text-on-dark bg-primary rounded-full">
                {tab.badge}
              </span>
            )}
            {isActive && (
              <motion.div
                className="absolute inset-0 bg-canvas-card rounded-md -z-10"
                layoutId="tab-indicator"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
          </motion.button>
        );
      })}
    </nav>
  );
}
