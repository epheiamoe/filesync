/**
 * CORS whitelist unit tests.
 */
import { describe, it, expect } from 'vitest';
import { createCorsOptions } from '../src/index';
import type { AppEnv } from '../src/types';

function makeEnv(corsOrigins: string | undefined): AppEnv {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    FILES: {} as R2Bucket,
    RoomDO: {} as DurableObjectNamespace,
    CORS_ALLOWED_ORIGINS: corsOrigins,
  };
}

describe('createCorsOptions', () => {
  it('reflects any origin when CORS_ALLOWED_ORIGINS is unset', () => {
    const options = createCorsOptions(makeEnv(undefined));
    expect(options.origin('https://localhost:5173')).toBe('https://localhost:5173');
    expect(options.origin('https://evil.com')).toBe('https://evil.com');
    expect(options.credentials).toBe(true);
  });

  it('reflects any origin when CORS_ALLOWED_ORIGINS is "*"', () => {
    const options = createCorsOptions(makeEnv('*'));
    expect(options.origin('https://localhost:5173')).toBe('https://localhost:5173');
    expect(options.origin('https://evil.com')).toBe('https://evil.com');
    expect(options.credentials).toBe(true);
  });

  it('returns exact origin when request origin is in whitelist', () => {
    const options = createCorsOptions(makeEnv('https://a.com,https://b.com'));
    expect(options.origin('https://a.com')).toBe('https://a.com');
    expect(options.origin('https://b.com')).toBe('https://b.com');
    expect(options.credentials).toBe(true);
  });

  it('returns null for origins not in whitelist', () => {
    const options = createCorsOptions(makeEnv('https://a.com,https://b.com'));
    expect(options.origin('https://evil.com')).toBeNull();
    expect(options.origin('https://a.com.evil.com')).toBeNull();
  });

  it('matches whitelist case-insensitively but returns original origin casing', () => {
    const options = createCorsOptions(makeEnv('https://App.Filesync.PAGES.DEV'));
    expect(options.origin('https://app.filesync.pages.dev')).toBe('https://app.filesync.pages.dev');
  });

  it('never returns "*" in production whitelist mode despite credentials: true', () => {
    const options = createCorsOptions(makeEnv('https://app.filesync.pages.dev'));
    const result = options.origin('https://app.filesync.pages.dev');
    expect(result).not.toBe('*');
    expect(result).toBe('https://app.filesync.pages.dev');
  });
});
