/**
 * SHA-256 hashing using Web Crypto API (subtle.digest).
 * Used server-side for key_hash comparison and legacy password verification.
 *
 * Password hashing has been migrated to PBKDF2-SHA256 (see `./pbkdf2`).
 * This module keeps the old SHA-256(salt + password) helpers as
 * `legacyHashPassword` / `legacyVerifyPassword` for explicit backward
 * compatibility, while `hashPassword` and `verifyPassword` are re-exported
 * aliases that point to the new PBKDF2 implementation.
 *
 * @module crypto/hash
 */

import {
  hashPassword as pbkdf2HashPassword,
  verifyPassword as pbkdf2VerifyPassword,
  needsRehash as pbkdf2NeedsRehash,
} from './pbkdf2';

/**
 * Compute SHA-256 hash of input data and return hex string.
 *
 * @param input - Can be a string (UTF-8 encoded) or ArrayBuffer/Uint8Array
 * @returns 64-character lowercase hex string
 *
 * @example
 *   await sha256('hello') → '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
 */
export async function sha256(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  let data: ArrayBuffer;

  if (typeof input === 'string') {
    data = new TextEncoder().encode(input).buffer as ArrayBuffer;
  } else if (input instanceof Uint8Array) {
    data = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  } else {
    data = input as ArrayBuffer;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Legacy password hash: salt (32 hex chars) + SHA-256(salt + password) (64 hex chars).
 *
 * @deprecated New code should use `hashPassword` from this module, which writes
 * the PBKDF2 format. This helper is retained only for backward compatibility.
 */
export async function legacyHashPassword(password: string, salt: string): Promise<string> {
  const hash = await sha256(salt + password);
  return salt + hash;
}

/**
 * Legacy password verification for old-format stored hashes.
 *
 * @deprecated Prefer `verifyPassword`, which automatically detects both formats.
 */
export async function legacyVerifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.length < 64) return false;

  const salt = storedHash.slice(0, 32);
  const computedHash = await legacyHashPassword(password, salt);
  return computedHash === storedHash;
}

/**
 * Hash a password for storage using PBKDF2-SHA256.
 *
 * This is an alias to the new implementation in `./pbkdf2`. The returned
 * string uses the self-describing format `$pbkdf2-sha256$i=...$salt$hash`.
 */
export const hashPassword = pbkdf2HashPassword;

/**
 * Verify a password against a stored hash.
 *
 * Automatically supports both PBKDF2 and legacy SHA-256(salt+password) hashes.
 */
export const verifyPassword = pbkdf2VerifyPassword;

/**
 * Check whether a stored hash should be rehashed with current parameters.
 */
export const needsRehash = pbkdf2NeedsRehash;
