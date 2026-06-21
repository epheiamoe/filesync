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
  // The credential code is always 6-char alphanumeric, so encoding is not
  // strictly necessary but applied for consistency.
  const encoded = encodeURIComponent(shareString);
  const base = `${getAppDomain()}/login#${encoded}`;
  return credential ? `${base}-${credential}` : base;
}
