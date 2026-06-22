/**
 * PBKDF2-SHA256 password hashing with a self-describing storage format.
 *
 * This module replaces the legacy SHA-256(salt + password) scheme with a
 * computationally expensive key derivation function. The serialized format
 * makes future algorithm upgrades explicit and unambiguous:
 *
 *   $pbkdf2-sha256$i=100000$<salt_hex>$<hash_hex>
 *
 * Note: Cloudflare Workers' Web Crypto implementation caps PBKDF2 iterations
 * at 100,000 (see workerd issue #1346). We therefore use 100,000 as the
 * default, which is the strongest value currently supported on the platform.
 *
 * Backward compatibility: `verifyPassword` automatically detects legacy hashes
 * (plain 32-char hex salt + 64-char hex SHA-256) and falls back to the old
 * verification path. Callers can then trigger an automatic rehash on success.
 *
 * @module crypto/pbkdf2
 */

const DEFAULT_ITERATIONS = 100_000;
const DEFAULT_SALT_BYTES = 16;
const DEFAULT_KEY_LENGTH_BYTES = 32;
const PREFIX = '$pbkdf2-sha256$';

export interface Pbkdf2HashOptions {
  iterations?: number;
  saltBytes?: number;
  keyLengthBytes?: number;
}

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Utf8(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return toHex(hashBuffer);
}

/**
 * Hash a password using PBKDF2-SHA256.
 *
 * @param password - Plaintext password
 * @param options - Optional tuning parameters
 * @returns Serialized hash string in `$pbkdf2-sha256$...` format
 */
export async function hashPassword(
  password: string,
  options?: Pbkdf2HashOptions
): Promise<string> {
  const iterations = options?.iterations ?? DEFAULT_ITERATIONS;
  const saltBytes = options?.saltBytes ?? DEFAULT_SALT_BYTES;
  const keyLengthBytes = options?.keyLengthBytes ?? DEFAULT_KEY_LENGTH_BYTES;

  const salt = crypto.getRandomValues(new Uint8Array(saltBytes));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    keyLengthBytes * 8
  );

  return `${PREFIX}i=${iterations}$${toHex(salt)}$${toHex(derivedBits)}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Supports both the new PBKDF2 format and the legacy SHA-256(salt+password)
 * format (96 hex chars) so existing accounts keep working.
 *
 * @param password - Plaintext password to verify
 * @param storedHash - Stored hash string
 * @returns true if the password matches
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string') return false;

  if (storedHash.startsWith(PREFIX)) {
    const withoutPrefix = storedHash.slice(PREFIX.length);
    const parts = withoutPrefix.split('$');
    if (parts.length !== 3) return false;

    const iterMatch = parts[0].match(/^i=(\d+)$/);
    if (!iterMatch) return false;
    const iterations = parseInt(iterMatch[1], 10);

    const salt = fromHex(parts[1]);
    const expectedHash = parts[2];

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      expectedHash.length * 4
    );

    return toHex(derivedBits) === expectedHash;
  }

  // Legacy fallback: salt(32 hex chars) + SHA-256(salt + password)(64 hex chars)
  if (storedHash.length < 64) return false;
  const salt = storedHash.slice(0, 32);
  const expectedHash = storedHash.slice(32);
  const computedHash = await sha256Utf8(salt + password);
  return computedHash === expectedHash;
}

/**
 * Check whether a stored hash should be rehashed with current parameters.
 *
 * Returns true for legacy hashes or when the iteration count differs from the
 * current default/options.
 *
 * @param storedHash - Stored hash string
 * @param options - Optional tuning parameters to compare against
 * @returns true if the hash should be upgraded
 */
export async function needsRehash(
  storedHash: string,
  options?: Pbkdf2HashOptions
): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith(PREFIX)) return true;

  const expectedIterations = options?.iterations ?? DEFAULT_ITERATIONS;
  const withoutPrefix = storedHash.slice(PREFIX.length);
  const iterMatch = withoutPrefix.match(/^i=(\d+)/);
  if (!iterMatch) return true;

  const currentIterations = parseInt(iterMatch[1], 10);
  return currentIterations !== expectedIterations;
}
