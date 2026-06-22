/**
 * CountdownCircle — Telegram-style SVG countdown circle.
 *
 * Displays a circular progress indicator showing remaining time until expiry.
 * Uses SVG `stroke-dashoffset` animation with CSS transition for smooth updates.
 *
 * Color mapping:
 *   - Green (>50% remaining)
 *   - Yellow (20-50% remaining)
 *   - Orange-red (<20% remaining)
 *   - Red (expired — 0% remaining)
 *
 * Clicking the circle shows a fixed-position tooltip with the remaining time.
 * The tooltip is rendered via a portal on document.body so it cannot expand
 * the chat container or trigger horizontal scrollbars.
 *
 * A native `title` attribute is kept as a hover/accessibility fallback.
 *
 * Why SVG instead of canvas:
 *   - Simpler DOM-based rendering, works with Tailwind
 *   - CSS transitions handle smooth color/offset changes
 *   - Accessible via aria-label describing remaining time
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@/i18n';

export interface CountdownCircleProps {
  /** ISO 8601 expiry timestamp. */
  expiresAt: string;
  /** Circle diameter in pixels. Default 24. */
  size?: number;
  /** Stroke width in pixels. Default 2. */
  strokeWidth?: number;
  /** Total TTL in seconds (for accurate percentage calculation). */
  ttlSeconds?: number;
  /** Custom className. */
  className?: string;
  /** Called once when the countdown reaches zero. Guarded against duplicate calls via useRef. */
  onExpired?: () => void;
}

/** Auto-hide delay for the click tooltip in milliseconds. */
const TOOLTIP_HIDE_DELAY_MS = 3000;

/** Format remaining milliseconds to a human-readable string. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return t('transfer.expired');
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

export function CountdownCircle({
  expiresAt,
  size = 24,
  strokeWidth = 2,
  ttlSeconds,
  className = '',
  onExpired,
}: CountdownCircleProps) {
  const [remaining, setRemaining] = useState(0);
  const [percent, setPercent] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capture the initial remaining time as baseline when ttlSeconds is not provided.
  // This allows us to display a percentage even without an explicit TTL.
  const initialBaselineRef = useRef<number>(0);

  // Guard to ensure onExpired fires at most once, even if setInterval
  // fires multiple ticks after remaining hits zero.
  const expiredFiredRef = useRef(false);

  // Single interval updates both remaining and percent every second
  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const expires = new Date(expiresAt).getTime();
      const rem = Math.max(0, expires - now);
      setRemaining(rem);

      if (rem <= 0) {
        setPercent(0);
        if (!expiredFiredRef.current) {
          expiredFiredRef.current = true;
          onExpired?.();
        }
        return;
      }

      if (ttlSeconds && ttlSeconds > 0) {
        // Use exact TTL for accurate percentage
        const pct = (rem / (ttlSeconds * 1000)) * 100;
        setPercent(Math.max(0, Math.min(100, pct)));
      } else if (initialBaselineRef.current > 0) {
        // Use captured initial baseline for percentage estimation
        const pct = (rem / initialBaselineRef.current) * 100;
        setPercent(Math.max(0, Math.min(100, pct)));
      }
    };

    // Capture initial baseline on mount (before first interval tick)
    const now = Date.now();
    const expires = new Date(expiresAt).getTime();
    initialBaselineRef.current = Math.max(0, expires - now);

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, ttlSeconds, onExpired]);

  // Position the fixed tooltip relative to the button viewport rect.
  const positionTooltip = useCallback(() => {
    const button = buttonRef.current;
    const tooltip = tooltipRef.current;
    if (!button || !tooltip) return;

    const rect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;

    // Default: show above the button, centered horizontally.
    let top = rect.top - tooltipRect.height - margin;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    // If there is not enough room above, flip to below the button.
    if (top < margin) {
      top = rect.bottom + margin;
    }

    // Clamp horizontally inside the viewport.
    const maxLeft = window.innerWidth - tooltipRect.width - margin;
    left = Math.max(margin, Math.min(left, maxLeft));

    setTooltipStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 9999,
    });
  }, []);

  // Show tooltip on click and restart the auto-hide timer.
  const handleClick = useCallback(() => {
    setShowTooltip((prev) => !prev);
  }, []);

  // Position tooltip once it is rendered.
  useEffect(() => {
    if (!showTooltip) return;
    positionTooltip();
    // Re-position on resize/scroll to keep the tooltip anchored to the button.
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
    };
  }, [showTooltip, positionTooltip]);

  // Auto-hide after delay; clicking again resets the timer.
  useEffect(() => {
    if (!showTooltip) return;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, TOOLTIP_HIDE_DELAY_MS);
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [showTooltip]);

  // Hide tooltip on outside click, ESC, or blur.
  useEffect(() => {
    if (!showTooltip) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setShowTooltip(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTooltip(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showTooltip]);

  // Determine color based on remaining percentage
  const color =
    remaining <= 0
      ? '#dc2626' // red-600: expired
      : percent < 20
        ? '#f97316' // orange-500: critical
        : percent < 50
          ? '#eab308' // yellow-500: warning
          : '#22c55e'; // green-500: healthy

  // SVG geometry
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - percent / 100);

  const formattedTime = formatRemaining(remaining);

  const tooltipContent =
    remaining <= 0
      ? t('transfer.expired')
      : t('transfer.timeRemainingTooltip', { time: formattedTime });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onBlur={() => setShowTooltip(false)}
        className={`relative inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-full ${className}`.trim()}
        aria-label={t('transfer.timeRemaining', { time: formattedTime })}
        title={remaining <= 0 ? t('transfer.expired') : formattedTime}
        aria-pressed={showTooltip}
      >
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          aria-hidden="true"
          className="transform -rotate-90"
        >
          {/* Background track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-hairline opacity-25"
          />
          {/* Countdown arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 0.5s ease, stroke 0.5s ease',
            }}
          />
        </svg>
      </button>

      {showTooltip &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            style={tooltipStyle}
            className="pointer-events-none px-2.5 py-1.5 rounded-lg bg-ink/90 text-canvas text-xs shadow-lg whitespace-nowrap max-w-xs"
            role="tooltip"
            aria-hidden="false"
          >
            {tooltipContent}
          </div>,
          document.body,
        )}
    </>
  );
}
