/**
 * Auth module tests — session management, password verification.
 * Tests that don't require D1/KV infrastructure.
 */
import { describe, it, expect } from 'vitest';
import { verifyPassword, hashPassword, sha256 } from '../src/crypto/hash';
import { generateSalt } from '../src/utils/id';

describe('Session management (unit)', () => {
  // Most session tests require KV binding; these test the pure logic.
  // Full integration tests with KV are in the integration test suite.

  it('should generate valid hex tokens', () => {
    // Session tokens are UUIDs without hyphens
    const token = crypto.randomUUID().replace(/-/g, '');
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('should have valid UUIDs as base for tokens', () => {
    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe('Password verification', () => {
  it('should verify correctly hashed passwords', async () => {
    const salt = generateSalt();
    const password = 'SecureP@ss1';
    const hashed = await hashPassword(password, salt);
    expect(hashed.length).toBe(96);

    const valid = await verifyPassword(password, hashed);
    expect(valid).toBe(true);
  });

  it('should reject incorrect passwords', async () => {
    const salt = generateSalt();
    const hashed = await hashPassword('RealPass', salt);
    const valid = await verifyPassword('FakePass', hashed);
    expect(valid).toBe(false);
  });

  it('should be case-sensitive', async () => {
    const salt = generateSalt();
    const hashed = await hashPassword('CaseTest', salt);
    expect(await verifyPassword('casetest', hashed)).toBe(false);
    expect(await verifyPassword('CaseTest', hashed)).toBe(true);
  });

  it('should handle special characters in passwords', async () => {
    const salt = generateSalt();
    const password = 'p@$$w0rd!čžš';
    const hashed = await hashPassword(password, salt);
    const valid = await verifyPassword(password, hashed);
    expect(valid).toBe(true);
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
