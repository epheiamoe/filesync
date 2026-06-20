/**
 * Utility tests — ID generation.
 */
import { describe, it, expect } from 'vitest';
import { generateId, generateRoomCode, generateTempCode, generateApiKey, generateSalt, generateSessionToken } from '../src/utils/id';

describe('generateId', () => {
  it('should return a UUID v4', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateRoomCode', () => {
  it('should return a 4-digit string', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[0-9]{4}$/);
  });

  it('should return zero-padded codes', () => {
    // Test multiple times to catch edge cases
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode();
      expect(code.length).toBe(4);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThanOrEqual(9999);
    }
  });

  it('should generate codes in valid range', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(10000);
    }
  });
});

describe('generateTempCode', () => {
  it('should return a 6-char alphanumeric string', () => {
    const code = generateTempCode();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('should generate unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateTempCode()));
    // With 36^6 combinations, 100 should all be unique
    expect(codes.size).toBe(100);
  });
});

describe('generateApiKey', () => {
  it('should return a 32-char hex string', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it('should generate unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });
});

describe('generateSalt', () => {
  it('should return a 32-char hex string', () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('generateSessionToken', () => {
  it('should return a 32-char hex string (UUID without hyphens)', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('should not contain hyphens', () => {
    const token = generateSessionToken();
    expect(token).not.toContain('-');
  });
});
