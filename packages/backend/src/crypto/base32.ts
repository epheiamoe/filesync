/**
 * Crockford base32 encoding/decoding.
 *
 * Alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ
 * Excludes I, L, O, U to avoid visual confusion (I/1, O/0, U/V).
 *
 * Used for encoding room keys into human-readable share strings.
 * Group output in chunks of 4 characters separated by hyphens.
 *
 * @module crypto/base32
 */

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_MAP: Record<string, number> = {};

// Build reverse lookup map, including common ambiguous substitutions
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_MAP[CROCKFORD_ALPHABET[i]] = i;
}
// Map ambiguous characters to their canonical equivalents
// I/i/L/l → 1, O/o → 0, U/u → V (per Crockford spec, but we map to nearest)
CROCKFORD_MAP['I'] = 1; CROCKFORD_MAP['i'] = 1;
CROCKFORD_MAP['L'] = 1; CROCKFORD_MAP['l'] = 1;
CROCKFORD_MAP['O'] = 0; CROCKFORD_MAP['o'] = 0;
CROCKFORD_MAP['U'] = CROCKFORD_MAP['V']; CROCKFORD_MAP['u'] = CROCKFORD_MAP['V'];

/**
 * Encode bytes to Crockford base32 string, grouped by 4 chars with hyphens.
 *
 * @param data - Input bytes as Uint8Array or ArrayBuffer
 * @param groupSize - Number of characters per group (default 4)
 * @returns Crockford base32 encoded string, e.g. "XK7M-A3PQ-Z9WJ-YR2T"
 */
export function encodeBase32(data: Uint8Array | ArrayBuffer, groupSize = 4): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let result = '';
  let buffer = 0;
  let bitsInBuffer = 0;

  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bitsInBuffer += 8;

    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      const index = (buffer >> bitsInBuffer) & 0x1f;
      result += CROCKFORD_ALPHABET[index];
    }
  }

  // Handle remaining bits with padding (use 0 bits)
  if (bitsInBuffer > 0) {
    const index = (buffer << (5 - bitsInBuffer)) & 0x1f;
    result += CROCKFORD_ALPHABET[index];
  }

  // Group with hyphens
  if (groupSize > 0 && groupSize < result.length) {
    const groups: string[] = [];
    for (let i = 0; i < result.length; i += groupSize) {
      groups.push(result.slice(i, i + groupSize));
    }
    return groups.join('-');
  }

  return result;
}

/**
 * Decode a Crockford base32 string (with or without hyphens) back to bytes.
 *
 * Accepts mixed case and ambiguous characters (I→1, L→1, O→0, U→V).
 *
 * @param encoded - Crockford base32 encoded string, optionally hyphenated
 * @returns Decoded bytes as Uint8Array
 * @throws Error if string contains invalid characters
 */
export function decodeBase32(encoded: string): Uint8Array {
  // Remove hyphens and uppercase
  const cleaned = encoded.replace(/-/g, '').toUpperCase();

  const bits: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const value = CROCKFORD_MAP[char];
    if (value === undefined) {
      throw new Error(`Invalid Crockford base32 character: '${char}' at position ${i}`);
    }
    buffer = (buffer << 5) | value;
    bitsInBuffer += 5;

    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      bits.push((buffer >> bitsInBuffer) & 0xff);
    }
  }

  // Discard leftover padding bits (they were added only to reach a 5-bit boundary)
  return new Uint8Array(bits);
}

/**
 * Encode the first 16 characters of a room key as a shareable prefix.
 * This is used to form the share_string: "{room_code}-{key_prefix}".
 * 32 bytes of key → 52 chars base32 → first 16 chars → 4 groups of 4.
 *
 * @param keyBytes - 32-byte room key
 * @returns 16-character base32 string grouped as "XXXX-XXXX-XXXX-XXXX"
 */
export function encodeKeyPrefix(keyBytes: Uint8Array): string {
  const fullEncoded = encodeBase32(keyBytes, 0); // no grouping yet
  const prefix = fullEncoded.slice(0, 16);
  const groups: string[] = [];
  for (let i = 0; i < prefix.length; i += 4) {
    groups.push(prefix.slice(i, i + 4));
  }
  return groups.join('-');
}
