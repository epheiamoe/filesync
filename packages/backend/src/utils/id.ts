/**
 * ID generation utilities for filesync.
 * All IDs use crypto.randomUUID() for randomness with no external dependencies.
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

/**
 * Generate a 6-character alphanumeric temporary credential code.
 * Characters: A-Z (uppercase) + 0-9 (36 possible chars).
 * Total combinations: 36^6 ≈ 2.17 billion — sufficient for one-time use codes.
 */
export function generateTempCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
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
 * Generate a session token from a UUID.
 * Removes hyphens to produce a 32-character hex string.
 */
export function generateSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
