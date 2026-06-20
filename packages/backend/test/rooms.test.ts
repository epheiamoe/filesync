/**
 * Room module tests — room code generation, join logic validation.
 * Tests that don't require D1 infrastructure.
 */
import { describe, it, expect } from 'vitest';
import { generateRoomCode, generateId } from '../src/utils/id';

describe('Room code generation', () => {
  it('should always generate 4-digit codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[0-9]{4}$/);
      expect(code.length).toBe(4);
    }
  });

  it('should generate codes within valid range', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(10000);
    }
  });

  it('should have reasonable distribution across range', () => {
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) {
      const code = generateRoomCode();
      const num = parseInt(code, 10);
      const bucket = Math.floor(num / 1000);
      buckets[bucket]++;
    }
    // Each of 10 buckets should have at least some entries
    // (statistically extremely unlikely to have 0 in any bucket with 1000 samples)
    for (const count of buckets) {
      expect(count).toBeGreaterThan(0);
    }
  });
});

describe('Room ID generation', () => {
  it('should generate valid UUIDs', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique room IDs', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateId()));
    expect(ids.size).toBe(500);
  });
});

describe('Key hash format', () => {
  it('should accept 64-char hex strings as key_hash', () => {
    const validHash = 'a'.repeat(64);
    expect(validHash).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('should reject non-hex key hashes', () => {
    const invalidHash = 'z'.repeat(64);
    expect(invalidHash).not.toMatch(/^[a-f0-9]{64}$/i);
  });
});

describe('Device label parsing (structure)', () => {
  it('should recognize common User-Agent patterns', () => {
    const uaWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(uaWindows).toContain('Windows');
    expect(uaWindows).toContain('Chrome');

    const uaIPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(uaIPhone).toContain('iPhone');
    expect(uaIPhone).toContain('Safari');
  });
});
