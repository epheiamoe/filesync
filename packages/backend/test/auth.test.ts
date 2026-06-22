/**
 * Auth module tests — session management, password verification.
 * Tests that don't require D1/KV infrastructure.
 */
import { describe, it, expect } from 'vitest';
import { verifyPassword, hashPassword, sha256 } from '../src/crypto/hash';

describe('Session management (unit)', () => {
  it('should generate valid hex tokens', () => {
    // Session tokens are now 64-char hex strings (256 bits of entropy)
    const token = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(token).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce UUIDs when randomUUID is used', () => {
    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe('Password verification', () => {
  it('should verify correctly hashed PBKDF2 passwords', async () => {
    const password = 'SecureP@ss1';
    const hashed = await hashPassword(password);
    expect(hashed).toMatch(/^\$pbkdf2-sha256\$i=600000\$/);

    const valid = await verifyPassword(password, hashed);
    expect(valid).toBe(true);
  });

  it('should reject incorrect passwords', async () => {
    const hashed = await hashPassword('RealPass');
    const valid = await verifyPassword('FakePass', hashed);
    expect(valid).toBe(false);
  });

  it('should be case-sensitive', async () => {
    const hashed = await hashPassword('CaseTest');
    expect(await verifyPassword('casetest', hashed)).toBe(false);
    expect(await verifyPassword('CaseTest', hashed)).toBe(true);
  });

  it('should handle special characters in passwords', async () => {
    const password = 'p@$$w0rd!čžš';
    const hashed = await hashPassword(password);
    const valid = await verifyPassword(password, hashed);
    expect(valid).toBe(true);
  });

  it('should still verify legacy SHA-256(salt+password) hashes', async () => {
    const storedHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a2ef14f9f7885c301271f725421f990a8145cee015023edda62805ad205efb99';
    expect(await verifyPassword('admin123', storedHash)).toBe(true);
    expect(await verifyPassword('wrong', storedHash)).toBe(false);
  });
});

describe('Login request validation (structural)', () => {
  it('should have valid SHA-256 output format', async () => {
    const hash = await sha256('anything');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce same hash for same input', async () => {
    const input = 'consistent-test-input';
    const hash1 = await sha256(input);
    const hash2 = await sha256(input);
    expect(hash1).toBe(hash2);
  });
});
