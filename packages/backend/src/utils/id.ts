/**
 * ID generation utilities for filesync.
 *
 * Primary keys (generateId) use UUID v4. Session tokens and temporary codes
 * use crypto.getRandomValues for higher entropy. No external dependencies.
 *
 * @module utils/id
 */

/**
 * Generate a UUID v4 string.
 * Used as primary key for all database records.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a 4-digit room code as a zero-padded string.
 * Range: "0000" to "9999".
 * Used for human-memorable room identification.
 * Collision handling is done at the room creation level (retry up to 10 times).
 */
export function generateRoomCode(): string {
  const num = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return num.toString().padStart(4, '0');
}

import { encodeBase32 } from '../crypto/base32';

/**
 * Generate an 8-character Crockford base32 temporary credential code.
 *
 * 5 random bytes → 40 bits → 8 base32 characters. The Crockford alphabet
 * excludes visually ambiguous characters (I, L, O, U), keeping the code easy
 * to read aloud or transcribe while providing ~2.56 trillion combinations.
 */
export function generateTempCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return encodeBase32(bytes, 0);
}

/**
 * Generate a 32-character hex API key.
 * Equivalent to 128 bits of entropy.
 * Format: lowercase hex string.
 */
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random hex salt for password hashing.
 * Returns 32-character hex string (16 random bytes).
 */
export function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a cryptographically random session token.
 *
 * Uses 32 bytes (256 bits) of entropy from `crypto.getRandomValues`, encoded
 * as a 64-character lowercase hex string. This replaces the previous UUID v4
 * based token (128 bits) while remaining backward compatible with older 32-char
 * tokens stored in KV.
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
