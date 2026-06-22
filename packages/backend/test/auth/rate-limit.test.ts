/**
 * Login rate-limit tests using an in-memory KV mock.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  type RateLimitConfig,
} from '../../src/auth/rate-limit';
import type { AppEnv } from '../../src/types';

class MockKV implements Pick<KVNamespace, 'get' | 'put' | 'delete' | 'list'> {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ objects: unknown[]; truncated: boolean; cursor?: string }> {
    return { objects: [], truncated: false };
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

const TEST_CONFIG: RateLimitConfig = {
  windowSeconds: 60,
  maxFailures: 3,
  blockSeconds: 120,
};

function makeEnv(kv: MockKV): AppEnv {
  return { KV: kv as unknown as KVNamespace } as AppEnv;
}

describe('checkRateLimit', () => {
  it('allows the first request', async () => {
    const kv = new MockKV();
    const result = await checkRateLimit(makeEnv(kv), '1.2.3.4', 'alice', TEST_CONFIG);
    expect(result).toEqual({ allowed: true });
  });

  it('blocks after max failures within the window', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);

    await recordFailedAttempt(env, '1.2.3.4', 'alice', TEST_CONFIG);
    await recordFailedAttempt(env, '1.2.3.4', 'alice', TEST_CONFIG);

    // Still allowed at the threshold boundary
    let result = await checkRateLimit(env, '1.2.3.4', 'alice', TEST_CONFIG);
    expect(result.allowed).toBe(true);

    // Third failure crosses the threshold
    await recordFailedAttempt(env, '1.2.3.4', 'alice', TEST_CONFIG);

    result = await checkRateLimit(env, '1.2.3.4', 'alice', TEST_CONFIG);
    expect(result.allowed).toBe(false);
    expect(result).toHaveProperty('retryAfter');
    expect((result as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });

  it('blocks by IP even when username is different', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);

    for (let i = 0; i < TEST_CONFIG.maxFailures; i++) {
      await recordFailedAttempt(env, '5.6.7.8', undefined, TEST_CONFIG);
    }

    const result = await checkRateLimit(env, '5.6.7.8', 'bob', TEST_CONFIG);
    expect(result.allowed).toBe(false);
  });

  it('blocks by username even when IP is different', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);

    for (let i = 0; i < TEST_CONFIG.maxFailures; i++) {
      await recordFailedAttempt(env, '9.10.11.12', 'carol', TEST_CONFIG);
    }

    const result = await checkRateLimit(env, '13.14.15.16', 'carol', TEST_CONFIG);
    expect(result.allowed).toBe(false);
  });

  it('returns retryAfter equal to blockSeconds when newly blocked', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);

    for (let i = 0; i < TEST_CONFIG.maxFailures; i++) {
      await recordFailedAttempt(env, '1.2.3.4', 'dave', TEST_CONFIG);
    }

    const result = await checkRateLimit(env, '1.2.3.4', 'dave', TEST_CONFIG);
    expect(result).toEqual({ allowed: false, retryAfter: TEST_CONFIG.blockSeconds });
  });
});

describe('clearRateLimit', () => {
  it('removes block and fail counters', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);

    for (let i = 0; i < TEST_CONFIG.maxFailures; i++) {
      await recordFailedAttempt(env, '1.2.3.4', 'eve', TEST_CONFIG);
    }

    let blocked = await checkRateLimit(env, '1.2.3.4', 'eve', TEST_CONFIG);
    expect(blocked.allowed).toBe(false);

    await clearRateLimit(env, '1.2.3.4', 'eve');

    blocked = await checkRateLimit(env, '1.2.3.4', 'eve', TEST_CONFIG);
    expect(blocked.allowed).toBe(true);
  });
});

describe('recordFailedAttempt', () => {
  it('starts a new failure window after stale window expires', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);

    // Exceed threshold
    for (let i = 0; i < TEST_CONFIG.maxFailures; i++) {
      await recordFailedAttempt(env, '1.2.3.4', 'frank', TEST_CONFIG);
    }

    // Manually clear block so we can test that stale fail counter is reset
    await clearRateLimit(env, '1.2.3.4', 'frank');

    // Replace the fail counter with a stale entry
    await env.KV.put(
      'ratelimit:user:frank:fail',
      JSON.stringify({ count: 10, firstFailAt: Date.now() - TEST_CONFIG.windowSeconds * 1000 - 1 }),
      { expirationTtl: TEST_CONFIG.windowSeconds }
    );

    const result = await checkRateLimit(env, '1.2.3.4', 'frank', TEST_CONFIG);
    expect(result.allowed).toBe(true);
  });
});
