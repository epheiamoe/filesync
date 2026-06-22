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
 * Hovering the circle shows a native title tooltip with the remaining time.
 *
 * Why SVG instead of canvas:
 *   - Simpler DOM-based rendering, works with Tailwind
 *   - CSS transitions handle smooth color/offset changes
 *   - Accessible via role="timer" and aria-label
 */
import { useState, useEffect, useRef } from 'react';
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

  return (
    <button
      type="button"
      className={`relative inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-full ${className}`.trim()}
      aria-label={t('transfer.timeRemaining', { time: formattedTime })}
      title={remaining <= 0 ? t('transfer.expired') : formattedTime}
      role="timer"
      aria-live="polite"
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
  );
}
