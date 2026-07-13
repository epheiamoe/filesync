/**
 * filesync URL Utilities — URL construction helpers.
 *
 * @module url
 */

/**
 * Get the current application domain (origin) for building full URLs.
 */
export function getAppDomain(): string {
  return window.location.origin;
}

/**
 * Build a login URL from a share string and optional temp credential.
 *
 * Format:
 *   Without credential: https://domain/login#{shareString}
 *   With credential:    https://domain/login#{shareString}-{tempCredential}
 *
 * The hash fragment carries the share string so the login page can
 * extract it without a server round-trip (privacy-preserving — the
 * server never sees the share key).
 */
export function buildLoginUrl(shareString: string, credential?: string): string {
  // encodeURIComponent ensures the share string is safe in URL context
  // (e.g., share string may contain / or % characters from base32 encoding).
  // The credential code is Crockford base32 (8 chars; legacy codes were 6),
  // so encoding is not strictly necessary but applied for consistency.
  const encoded = encodeURIComponent(shareString);
  const base = `${getAppDomain()}/login#${encoded}`;
  return credential ? `${base}-${credential}` : base;
}

/**
 * Temp credential codes: 8-char Crockford base32 (current backend format,
 * see backend utils/id.ts generateTempCode) or 6-char legacy codes.
 * Share-string segments (room code + key groups) are always exactly 4
 * characters, so a trailing 6-8 char alphanumeric segment is unambiguous.
 */
const CREDENTIAL_RE = /^[A-Za-z0-9]{6,8}$/;

export interface ParsedInvite {
  shareString: string;
  credential: string | null;
}

/**
 * Split a raw invite string ("{shareString}[-{credential}]") into share
 * string and optional temp credential.
 */
export function splitShareAndCredential(raw: string): ParsedInvite {
  const lastDash = raw.lastIndexOf('-');
  if (lastDash > 0) {
    const suffix = raw.slice(lastDash + 1);
    if (CREDENTIAL_RE.test(suffix)) {
      return { shareString: raw.slice(0, lastDash), credential: suffix.toUpperCase() };
    }
  }
  return { shareString: raw, credential: null };
}

/**
 * Parse a login URL hash fragment produced by buildLoginUrl.
 *
 * URL format: /login#<shareString>[-<credential>]
 * Example:   /login#4821-XK7M-…-1V70-4JVA27Y7
 *            shareString = "4821-XK7M-…-1V70", credential = "4JVA27Y7"
 */
export function parseLoginHash(hash: string): ParsedInvite {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return { shareString: '', credential: null };

  // The hash may have been encodeURIComponent'd by the QR generator.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return splitShareAndCredential(decoded);
}
