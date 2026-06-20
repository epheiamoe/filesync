/**
 * ExpandableText component — Auto-collapse long text.
 *
 * For texts > 300 chars, shows first 3 lines + expand button.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '@/i18n';

interface ExpandableTextProps {
  text: string;
  maxLength?: number;
  maxLines?: number;
  className?: string;
}

export function ExpandableText({
  text,
  maxLength = 300,
  maxLines = 3,
  className = '',
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const needsCollapse = text.length > maxLength;

  const displayText = needsCollapse && !expanded
    ? text.slice(0, maxLength) + '...'
    : text;

  return (
    <div className={className}>
      <AnimatePresence mode="wait">
        <motion.p
          key={expanded ? 'expanded' : 'collapsed'}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className={`text-sm text-body whitespace-pre-wrap break-words ${
            !expanded && needsCollapse ? `line-clamp-${maxLines}` : ''
          }`}
          style={!expanded && needsCollapse ? {
            display: '-webkit-box',
            WebkitLineClamp: maxLines,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } : undefined}
        >
          {displayText}
        </motion.p>
      </AnimatePresence>
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:text-primary-active mt-1 font-medium"
          aria-expanded={expanded}
        >
          {expanded ? t('common.collapse') : t('common.expand')}
        </button>
      )}
    </div>
  );
}
