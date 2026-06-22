/**
 * Login rate limiting backed by Cloudflare KV.
 *
 * Uses a fixed-window failure counter plus a short-term block flag. Both IP
 * and username dimensions are tracked independently, so shared NAT exits do
 * not accidentally lock legitimate users while still protecting individual
 * accounts from IP-rotating attackers.
 *
 * @module auth/rate-limit
 */

import type { Context } from 'hono';
import type { AppContext, AppEnv } from '../types';

export interface RateLimitConfig {
  windowSeconds: number;
  maxFailures: number;
  blockSeconds: number;
}

interface FailureState {
  count: number;
  firstFailAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowSeconds: 300,
  maxFailures: 5,
  blockSeconds: 900,
};

function getConfig(env: AppEnv, config?: RateLimitConfig): RateLimitConfig {
  if (config) return config;

  return {
    windowSeconds: parseInt(String(env.RATE_LIMIT_WINDOW_SECONDS), 10) || DEFAULT_CONFIG.windowSeconds,
    maxFailures: parseInt(String(env.RATE_LIMIT_MAX_FAILURES), 10) || DEFAULT_CONFIG.maxFailures,
    blockSeconds: parseInt(String(env.RATE_LIMIT_BLOCK_SECONDS), 10) || DEFAULT_CONFIG.blockSeconds,
  };
}

function blockKey(ip: string, username?: string): string {
  return username
    ? `ratelimit:user:${username}:block`
    : `ratelimit:ip:${ip}:block`;
}

function failKey(ip: string, username?: string): string {
  return username
    ? `ratelimit:user:${username}:fail`
    : `ratelimit:ip:${ip}:fail`;
}

/**
 * Extract the client IP from Hono request headers.
 *
 * Prefers Cloudflare's `CF-Connecting-IP`, falls back to the first entry of
 * `X-Forwarded-For`, and finally returns `'unknown'` so rate limiting still
 * has a key even in local test environments.
 */
export function getClientIP(c: Context<AppContext>): string {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp.trim();

  const forwarded = c.req.header('X-Forwarded-For');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }

  return 'unknown';
}

async function isBlocked(
  env: AppEnv,
  ip: string,
  username: string | undefined,
  config: RateLimitConfig
): Promise<{ blocked: false } | { blocked: true; retryAfter: number }> {
  const key = blockKey(ip, username);
  const raw = await env.KV.get(key);
  if (!raw) return { blocked: false };

  const blockUntil = parseInt(raw, 10);
  if (Number.isNaN(blockUntil)) {
    await env.KV.delete(key);
    return { blocked: false };
  }

  const now = Date.now();
  if (now < blockUntil) {
    const retryAfter = Math.max(1, Math.ceil((blockUntil - now) / 1000));
    return { blocked: true, retryAfter };
  }

  // Block expired — clean it up
  await env.KV.delete(key);
  return { blocked: false };
}

async function checkFailureWindow(
  env: AppEnv,
  ip: string,
  username: string | undefined,
  config: RateLimitConfig
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const key = failKey(ip, username);
  const raw = await env.KV.get(key);
  if (!raw) return { allowed: true };

  let state: FailureState;
  try {
    state = JSON.parse(raw) as FailureState;
  } catch {
    await env.KV.delete(key);
    return { allowed: true };
  }

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Reset stale window
  if (now - state.firstFailAt > windowMs) {
    await env.KV.delete(key);
    return { allowed: true };
  }

  if (state.count >= config.maxFailures) {
    const blockUntil = now + config.blockSeconds * 1000;
    await env.KV.put(blockKey(ip, username), String(blockUntil), {
      expirationTtl: config.blockSeconds,
    });
    await env.KV.delete(key);
    return { allowed: false, retryAfter: config.blockSeconds };
  }

  return { allowed: true };
}

/**
 * Check whether a login request is currently allowed.
 *
 * Checks both the IP dimension and the username dimension (if provided). If
 * either is blocked, the stricter retryAfter value is returned.
 */
export async function checkRateLimit(
  env: AppEnv,
  ip: string,
  username?: string,
  config?: RateLimitConfig
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const cfg = getConfig(env, config);

  const ipBlock = await isBlocked(env, ip, undefined, cfg);
  if (ipBlock.blocked) return { allowed: false, retryAfter: ipBlock.retryAfter };

  if (username) {
    const userBlock = await isBlocked(env, ip, username, cfg);
    if (userBlock.blocked) return { allowed: false, retryAfter: userBlock.retryAfter };
  }

  const ipWindow = await checkFailureWindow(env, ip, undefined, cfg);
  if (!ipWindow.allowed) return ipWindow;

  if (username) {
    const userWindow = await checkFailureWindow(env, ip, username, cfg);
    if (!userWindow.allowed) return userWindow;
  }

  return { allowed: true };
}

/**
 * Record a failed login attempt.
 *
 * Increments the failure counter for both the IP and the username (if given).
 * If the counter reaches the threshold within the window, a block flag is set.
 */
export async function recordFailedAttempt(
  env: AppEnv,
  ip: string,
  username?: string,
  config?: RateLimitConfig
): Promise<void> {
  const cfg = getConfig(env, config);
  const targets: (string | undefined)[] = [undefined];
  if (username) targets.push(username);

  for (const dimension of targets) {
    const key = failKey(ip, dimension);
    const now = Date.now();
    const windowMs = cfg.windowSeconds * 1000;

    let state: FailureState = { count: 1, firstFailAt: now };
    const raw = await env.KV.get(key);

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FailureState;
        if (now - parsed.firstFailAt <= windowMs) {
          state = {
            count: parsed.count + 1,
            firstFailAt: parsed.firstFailAt,
          };
        }
      } catch {
        // Malformed state — start fresh
      }
    }

    if (state.count >= cfg.maxFailures) {
      const blockUntil = now + cfg.blockSeconds * 1000;
      await env.KV.put(blockKey(ip, dimension), String(blockUntil), {
        expirationTtl: cfg.blockSeconds,
      });
      await env.KV.delete(key);
    } else {
      await env.KV.put(key, JSON.stringify(state), {
        expirationTtl: cfg.windowSeconds,
      });
    }
  }
}

/**
 * Clear rate-limit state for a successful login.
 *
 * Removes both failure counters and block flags for the IP and username.
 */
export async function clearRateLimit(
  env: AppEnv,
  ip: string,
  username?: string
): Promise<void> {
  const keys: string[] = [
    failKey(ip, undefined),
    blockKey(ip, undefined),
  ];

  if (username) {
    keys.push(failKey(ip, username), blockKey(ip, username));
  }

  await Promise.all(keys.map((key) => env.KV.delete(key).catch(() => undefined)));
}
