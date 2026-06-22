/**
 * PBKDF2 password hashing tests.
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from '../../src/crypto/pbkdf2';

describe('PBKDF2 hashPassword', () => {
  it('returns a PBKDF2 formatted hash with default 600000 iterations', async () => {
    const hashed = await hashPassword('password');
    expect(hashed).toMatch(/^\$pbkdf2-sha256\$i=600000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  });

  it('uses a random salt for each call', async () => {
    const h1 = await hashPassword('password');
    const h2 = await hashPassword('password');
    expect(h1).not.toBe(h2);
  });

  it('accepts custom iteration count', async () => {
    const hashed = await hashPassword('password', { iterations: 1000 });
    expect(hashed).toMatch(/^\$pbkdf2-sha256\$i=1000\$/);
  });

  it('accepts custom salt and key length', async () => {
    const hashed = await hashPassword('password', {
      saltBytes: 8,
      keyLengthBytes: 16,
      iterations: 1000,
    });
    expect(hashed).toMatch(/^\$pbkdf2-sha256\$i=1000\$[a-f0-9]{16}\$[a-f0-9]{32}$/);
  });
});

describe('PBKDF2 verifyPassword', () => {
  it('verifies its own hashes', async () => {
    const hashed = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', hashed)).toBe(true);
    expect(await verifyPassword('hunter3', hashed)).toBe(false);
  });

  it('verifies with custom parameters', async () => {
    const hashed = await hashPassword('secret', { iterations: 5000, keyLengthBytes: 16 });
    expect(await verifyPassword('secret', hashed)).toBe(true);
    expect(await verifyPassword('wrong', hashed)).toBe(false);
  });

  it('returns false for malformed PBKDF2 hashes', async () => {
    expect(await verifyPassword('x', '$pbkdf2-sha256$garbage')).toBe(false);
    expect(await verifyPassword('x', '$pbkdf2-sha256$i=abc$salt$hash')).toBe(false);
  });

  it('falls back to legacy SHA-256(salt + password) hashes', async () => {
    const storedHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a2ef14f9f7885c301271f725421f990a8145cee015023edda62805ad205efb99';
    expect(await verifyPassword('admin123', storedHash)).toBe(true);
    expect(await verifyPassword('admin124', storedHash)).toBe(false);
  });

  it('returns false for very short stored hashes', async () => {
    expect(await verifyPassword('x', 'short')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('PBKDF2 needsRehash', () => {
  it('returns true for legacy hashes', async () => {
    const storedHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a2ef14f9f7885c301271f725421f990a8145cee015023edda62805ad205efb99';
    expect(await needsRehash(storedHash)).toBe(true);
  });

  it('returns false for hashes with current default iterations', async () => {
    const hashed = await hashPassword('password');
    expect(await needsRehash(hashed)).toBe(false);
  });

  it('returns true when iteration count differs', async () => {
    const hashed = await hashPassword('password', { iterations: 1000 });
    expect(await needsRehash(hashed)).toBe(true);
    expect(await needsRehash(hashed, { iterations: 1000 })).toBe(false);
  });
});
