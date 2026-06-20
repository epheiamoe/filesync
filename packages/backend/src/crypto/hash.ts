/**
 * SHA-256 hashing using Web Crypto API (subtle.digest).
 * Used server-side for key_hash comparison and password hashing.
 * Workers have native Web Crypto support — no external crypto libs needed.
 * @module crypto/hash
 */

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
 * Hash a password with a salt for storage.
 * Format: salt (32 hex chars) + SHA-256(salt + password) (64 hex chars) = 96 chars total.
 *
 * @param password - The plaintext password
 * @param salt - 32-character hex salt string (from generateSalt())
 * @returns 96-character hex string (salt + hash)
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const hash = await sha256(salt + password);
  return salt + hash;
}

/**
 * Verify a password against a stored hash.
 *
 * @param password - The plaintext password to verify
 * @param storedHash - The stored hash in format: salt(32) + hash(64)
 * @returns true if password matches
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.length < 64) return false; // minimum: at least a hash without salt

  const salt = storedHash.slice(0, 32);
  const computedHash = await hashPassword(password, salt);
  return computedHash === storedHash;
}
