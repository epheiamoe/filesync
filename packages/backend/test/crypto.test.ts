/**
 * Crypto utility tests — base32 encoding/decoding, SHA-256 hashing, password hashing.
 */
import { describe, it, expect } from 'vitest';
import { encodeBase32, decodeBase32, encodeKeyPrefix } from '../src/crypto/base32';
import { sha256, hashPassword, verifyPassword } from '../src/crypto/hash';

describe('Crockford base32', () => {
  it('should encode and decode roundtrip correctly', () => {
    const input = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const encoded = encodeBase32(input, 0); // no grouping
    expect(encoded).toBeTruthy();
    const decoded = decodeBase32(encoded);
    expect(decoded).toEqual(input);
  });

  it('should encode empty buffer', () => {
    const encoded = encodeBase32(new Uint8Array(0), 0);
    expect(encoded).toBe('');
    const decoded = decodeBase32(encoded);
    expect(decoded).toEqual(new Uint8Array(0));
  });

  it('should encode with grouping', () => {
    // 32 bytes → 52 chars base32 → 13 groups of 4
    const input = new Uint8Array(32).fill(0xAB);
    const encoded = encodeBase32(input, 4);
    // Verify format: groups of 4 separated by hyphens
    const groups = encoded.split('-');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(4);
    }
    // All characters should be from the Crockford alphabet
    for (const char of encoded.replace(/-/g, '')) {
      expect('0123456789ABCDEFGHJKMNPQRSTVWXYZ').toContain(char);
    }
  });

  it('should decode with hyphens', () => {
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = encodeBase32(input, 4);
    // Should contain hyphens
    expect(encoded).toContain('-');
    const decoded = decodeBase32(encoded);
    expect(decoded).toEqual(input);
  });

  it('should handle ambiguous characters (I→1, L→1, O→0, U→V)', () => {
    // Encode something that uses '1' in base32
    const input = new Uint8Array([0x00, 0x00]);
    const encoded = encodeBase32(input, 0);
    // Manually substitute ambiguous chars and verify decode still works
    const withAmbiguous = encoded.replace(/1/g, 'I').replace(/0/g, 'O');
    const decoded = decodeBase32(withAmbiguous);
    expect(decoded).toEqual(input);
  });

  it('should throw on invalid characters', () => {
    expect(() => decodeBase32('!!!!')).toThrow(/Invalid Crockford base32 character/);
  });

  it('should encodeKeyPrefix to 16 chars grouped by 4', () => {
    const key = new Uint8Array(32).fill(0x42);
    const prefix = encodeKeyPrefix(key);
    expect(prefix).toMatch(/^[0-9A-TV-Z]{4}-[0-9A-TV-Z]{4}-[0-9A-TV-Z]{4}-[0-9A-TV-Z]{4}$/);
  });

  it('should encode 32-byte key to exact 52 chars', () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const encoded = encodeBase32(key, 0);
    // 32 bytes = 256 bits. 256 / 5 = 51.2 → 52 chars with 4 bits padding
    expect(encoded.length).toBe(52);
  });
});

describe('SHA-256', () => {
  it('should produce consistent hash for known input', async () => {
    const hash = await sha256('hello');
    // SHA-256 of UTF-8 "hello"
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should produce 64-char hex string', async () => {
    const hash = await sha256('test');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce different hash for different inputs', async () => {
    const hash1 = await sha256('abc');
    const hash2 = await sha256('abd');
    expect(hash1).not.toBe(hash2);
  });

  it('should accept Uint8Array input', async () => {
    const bytes = new TextEncoder().encode('hello');
    const hashFromString = await sha256('hello');
    const hashFromBytes = await sha256(bytes);
    expect(hashFromBytes).toBe(hashFromString);
  });

  it('should hash empty string', async () => {
    const hash = await sha256('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('Password hashing', () => {
  it('should hash and verify password with PBKDF2 format', async () => {
    const hashed = await hashPassword('test123');
    // PBKDF2 format: $pbkdf2-sha256$i=...$salt$hash
    expect(hashed).toMatch(/^\$pbkdf2-sha256\$i=\d+\$[a-f0-9]+\$[a-f0-9]+$/);

    const valid = await verifyPassword('test123', hashed);
    expect(valid).toBe(true);
  });

  it('should reject wrong password against PBKDF2 hash', async () => {
    const hashed = await hashPassword('correct');
    const valid = await verifyPassword('wrong', hashed);
    expect(valid).toBe(false);
  });

  it('should reject invalid stored hash format', async () => {
    const valid = await verifyPassword('anything', 'tooshort');
    expect(valid).toBe(false);
  });

  it('should produce different hashes for the same password (random salt)', async () => {
    const hash1 = await hashPassword('samepass');
    const hash2 = await hashPassword('samepass');
    expect(hash1).not.toBe(hash2);
  });

  it('should still verify legacy SHA-256(salt + password) hashes', async () => {
    // Seed: salt=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6, password=admin123
    const storedHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a2ef14f9f7885c301271f725421f990a8145cee015023edda62805ad205efb99';
    const valid = await verifyPassword('admin123', storedHash);
    expect(valid).toBe(true);
  });
});
