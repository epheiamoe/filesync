/**
 * filesync E2EE Crypto — Client-side encryption using Web Crypto API.
 *
 * Features:
 * - Generate 32-byte random room key
 * - Encode key as Crockford base32, grouped in 4-char chunks
 * - Decode share string back to {roomCode, key}
 * - SHA-256 hash key for server verification
 * - AES-256-GCM encrypt/decrypt for messages and files
 * - localStorage key persistence
 *
 * @module crypto
 */

// Crockford Base32 alphabet (no I, L, O, U to avoid confusion)
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ---- Key Generation ----

/**
 * Generate a cryptographically secure 32-byte random key for room encryption.
 * Uses crypto.getRandomValues for browser-grade randomness.
 */
export function generateRoomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

// ---- Base32 Crockford Encoding ----

/**
 * Encode bytes to Crockford base32 string.
 */
function bytesToBase32(bytes: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      const idx = (value >> bits) & 0x1f;
      result += CROCKFORD_ALPHABET[idx];
    }
  }

  // Handle remaining bits
  if (bits > 0) {
    const idx = (value << (5 - bits)) & 0x1f;
    result += CROCKFORD_ALPHABET[idx];
  }

  return result;
}

/**
 * Decode Crockford base32 string back to bytes.
 */
function base32ToBytes(str: string): Uint8Array {
  // Uppercase and remove separators
  const clean = str.toUpperCase().replace(/[^0-9A-TV-Z]/g, '');

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < clean.length; i++) {
    const idx = CROCKFORD_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      // Map I->1, L->1, O->0, U->V (Crockford decoding suggestions)
      const mapped = mapAmbiguousChar(clean[i]);
      if (mapped === -1) continue;
      value = (value << 5) | mapped;
    } else {
      value = (value << 5) | idx;
    }
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Map commonly confused characters to their Crockford base32 values.
 */
function mapAmbiguousChar(ch: string): number {
  switch (ch) {
    case 'I':
    case 'L':
      return 1;
    case 'O':
      return 0;
    case 'U':
      return CROCKFORD_ALPHABET.indexOf('V');
    default:
      return -1;
  }
}

// ---- Share String Format ----

/**
 * Encode key as grouped base32 string.
 * Uses ALL 52 Crockford base32 characters (13 groups × 4 chars/group).
 *
 * Previously this truncated to 16 chars (only ~10 bytes), which caused
 * zero-padded key mismatches. The full 52-char encoding carries all 32
 * bytes of the AES-256 key.
 */
export function encodeKeyGroups(key: Uint8Array): string {
  const base32 = bytesToBase32(key);
  // Use full 52-char base32 → 13 groups of 4
  const groups: string[] = [];
  for (let i = 0; i < base32.length; i += 4) {
    groups.push(base32.slice(i, i + 4));
  }
  return groups.join('-');
}

/**
 * Encode share string: "{roomCode}-{keyGroups}"
 * Example: "4821-XK7M-A3PQ-Z9WJ"
 */
export function encodeShareString(roomCode: string, key: Uint8Array): string {
  return `${roomCode}-${encodeKeyGroups(key)}`;
}

/**
 * Decode share string back to {roomCode, keyUint8Array}.
 *
 * Supports ONLY the full 52-char base32 format (13 groups × 4 chars).
 * Old 16-char (4 groups) format is detected and explicitly rejected
 * because it only carries 10 bytes of the 32-byte key, causing
 * zero-padded mismatch with the actual AES-256 key.
 *
 * Share string format: "4821-XK7M-A3PQ-Z9WJ-B5NT-FK26-G8VE-..."
 * (13 groups of 4 base32 chars after the 4-digit room code)
 */
export function decodeShareString(shareStr: string): { roomCode: string; key: Uint8Array } | null {
  // Remove whitespace
  const clean = shareStr.trim().replace(/\s/g, '');

  // Find the first dash to separate room code from key
  const dashIdx = clean.indexOf('-');
  if (dashIdx < 1) return null;

  const roomCode = clean.slice(0, dashIdx);
  const keyPart = clean.slice(dashIdx + 1).replace(/-/g, '');

  // Validate roomCode: 4 digits only
  if (roomCode.length !== 4 || !/^\d{4}$/.test(roomCode)) return null;

  // Validate keyPart characters are in Crockford base32 set
  if (!/^[0-9A-HJKMNP-TV-Z]+$/i.test(keyPart)) return null;

  // Decode the key part
  const keyBytes = base32ToBytes(keyPart);

  // Reject old 16-char format (decodes to only 10 bytes, not 32).
  // The old format cannot reconstruct the full AES-256 key.
  // Callers should prompt the user to get a new share string.
  if (keyBytes.length < 32) {
    console.warn(
      '[crypto] decodeShareString: old 16-char share string format detected — ' +
      'key decodes to only ' + keyBytes.length + ' bytes (need 32). ' +
      'This format is deprecated. Please ask the room creator to generate a new share link.',
    );
    return null;
  }

  // If slightly over 32 bytes due to padding bits, truncate to exactly 32
  const key = keyBytes.length === 32 ? keyBytes : keyBytes.slice(0, 32);

  return { roomCode, key };
}

// ---- Hashing ----

/**
 * Hash key using SHA-256 for server-side verification.
 * Returns hex string.
 */
export async function hashKey(key: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', key.buffer as ArrayBuffer);
  return bufferToHex(new Uint8Array(hashBuffer));
}

// ---- AES-256-GCM Encryption / Decryption ----

/**
 * Import raw key bytes into a CryptoKey for AES-256-GCM.
 */
async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt content with AES-256-GCM.
 * Returns {ciphertext: ArrayBuffer, iv: Uint8Array}
 *
 * The IV is prepended to ciphertext+tag in the returned ciphertext for storage/transmission.
 * Format: iv(12B) + ciphertext + auth_tag(16B)
 */
export async function encryptContent(
  key: Uint8Array,
  plaintext: ArrayBuffer,
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
  const aesKey = await importAesKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintext,
  );
  return { ciphertext, iv };
}

/**
 * Encrypt content and return combined IV+ciphertext+tag as ArrayBuffer.
 * This is the format sent to the server.
 */
export async function encryptContentCombined(
  key: Uint8Array,
  plaintext: ArrayBuffer,
): Promise<ArrayBuffer> {
  const { ciphertext, iv } = await encryptContent(key, plaintext);
  // Combine: iv(12) + ciphertext + tag(16)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return combined.buffer;
}

/**
 * Decrypt content with AES-256-GCM.
 * The ciphertext must include the auth_tag at the end (16 bytes).
 *
 * @param key - 32-byte encryption key
 * @param ciphertext - encrypted data (ciphertext + auth_tag)
 * @param iv - 12-byte initialization vector
 */
export async function decryptContent(
  key: Uint8Array,
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  const aesKey = await importAesKey(key);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    aesKey,
    ciphertext,
  );
}

/**
 * Decrypt content that was stored as combined IV+ciphertext+tag format.
 * Input: iv(12B) + ciphertext + auth_tag(16B)
 */
export async function decryptContentCombined(
  key: Uint8Array,
  combined: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (combined.byteLength < 28) {
    throw new Error('Combined content too short: need at least 28 bytes (12 IV + 16 tag)');
  }
  const ivSlice = combined.slice(0, 12);
  const iv = new Uint8Array(ivSlice);
  const ciphertext = combined.slice(12);
  return decryptContent(key, ciphertext, iv);
}

// ---- Text Convenience ----

/**
 * Encrypt a string and return as base64.
 */
export async function encryptText(key: Uint8Array, text: string): Promise<string> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(text);
  const combined = await encryptContentCombined(key, plaintext.buffer as ArrayBuffer);
  return arrayBufferToBase64(combined);
}

/**
 * Decrypt a base64-encoded encrypted string back to plain text.
 */
export async function decryptText(key: Uint8Array, encryptedBase64: string): Promise<string> {
  const combined = base64ToArrayBuffer(encryptedBase64);
  const plaintext = await decryptContentCombined(key, combined);
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Encrypt a file (ArrayBuffer) and return combined encrypted data.
 */
export async function encryptFile(key: Uint8Array, fileBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  return encryptContentCombined(key, fileBuffer);
}

/**
 * Decrypt a file (combined encrypted ArrayBuffer) back to original.
 */
export async function decryptFile(key: Uint8Array, encrypted: ArrayBuffer): Promise<ArrayBuffer> {
  return decryptContentCombined(key, encrypted);
}

// ---- localStorage Key Management ----

const KEY_STORAGE_PREFIX = 'epheia_files_room_';

export function storeRoomKey(roomCode: string, key: Uint8Array): void {
  try {
    const hex = bufferToHex(key);
    localStorage.setItem(`${KEY_STORAGE_PREFIX}${roomCode}_key`, hex);
  } catch {
    // localStorage unavailable
  }
}

export function getRoomKey(roomCode: string): Uint8Array | null {
  try {
    const hex = localStorage.getItem(`${KEY_STORAGE_PREFIX}${roomCode}_key`);
    if (!hex) return null;
    return hexToBuffer(hex);
  } catch {
    return null;
  }
}

export function removeRoomKey(roomCode: string): void {
  try {
    localStorage.removeItem(`${KEY_STORAGE_PREFIX}${roomCode}_key`);
  } catch {
    // ignore
  }
}

/** Check if a room key is cached in localStorage. */
export function hasRoomKey(roomCode: string): boolean {
  return getRoomKey(roomCode) !== null;
}

/** List all room codes that have a cached key in localStorage. */
export function listCachedRoomCodes(): string[] {
  try {
    const codes: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_STORAGE_PREFIX) && key.endsWith('_key')) {
        const roomCode = key.slice(KEY_STORAGE_PREFIX.length, -4); // strip prefix and '_key'
        codes.push(roomCode);
      }
    }
    return codes;
  } catch {
    return [];
  }
}

// ---- Utility Helpers ----

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer, 0, buffer.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---- File Integrity (Feature #8) ----

/**
 * Compute SHA-256 hash of an ArrayBuffer, returning 64-char hex string.
 *
 * Used for file integrity verification: the hash of the original (unencrypted)
 * file is computed client-side before encryption and stored on the server.
 * After download and decryption, the hash is recomputed and compared to
 * detect corruption or tampering.
 *
 * This provides an integrity layer on top of E2EE — even if the encrypted
 * R2 object is replaced, the hash mismatch will reveal it.
 */
export async function computeFileHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(new Uint8Array(hashBuffer));
}

// ---- Client Fingerprint (Fix #3) ----

const FINGERPRINT_STORAGE_KEY = 'epheia_client_fingerprint';

/**
 * Get or create a persistent client fingerprint stored in localStorage.
 *
 * This fingerprint identifies the same browser/device across login sessions,
 * allowing users (especially temp credential users) to see rooms they've
 * previously joined even after their session token changes.
 *
 * The fingerprint is a 32-char hex string generated once and persisted
 * until the user clears site data.
 *
 * Why this approach: server-side session tokens change on every login,
 * so room_members.session_id can't match across sessions. A client-side
 * persistent identifier solves this without server-side identity tracking.
 */
export function getOrCreateClientFingerprint(): string {
  try {
    const existing = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
    if (existing) return existing;

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const fingerprint = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
    return fingerprint;
  } catch {
    // localStorage unavailable (private mode / SSR) — return a session-only fallback
    return 'session_' + Math.random().toString(36).slice(2, 10);
  }
}
