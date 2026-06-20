/**
 * epheia-files Device Label — Parse User-Agent to a human-readable label.
 *
 * Rules (from architecture.md):
 * 1. Extract OS: Windows / Mac / Linux / iPhone / iPad / Android / Unknown
 * 2. Extract Browser: Chrome / Firefox / Safari / Edge / Unknown
 * 3. Combine: "{OS} {Browser}" (e.g. "Windows Chrome")
 *
 * @module device
 */

export function parseDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown Device';

  const ua = navigator.userAgent;

  // --- OS Detection ---
  let os = 'Unknown';
  if (/Windows/i.test(ua)) {
    os = 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'Mac';
  } else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    os = 'Linux';
  } else if (/iPhone/i.test(ua)) {
    os = 'iPhone';
  } else if (/iPad/i.test(ua)) {
    os = 'iPad';
  } else if (/Android/i.test(ua)) {
    os = 'Android';
  }

  // --- Browser Detection ---
  let browser = 'Unknown';
  // Edge must come before Chrome (Edge UA includes "Chrome")
  if (/Edg\//.test(ua)) {
    browser = 'Edge';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox';
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browser = 'Chrome';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browser = 'Safari';
  }

  return `${os} ${browser}`;
}

/**
 * Get a short version of the device label for display.
 */
export function getDeviceShortLabel(): string {
  const label = parseDeviceLabel();
  // Trim to 20 chars max
  if (label.length > 20) {
    return label.slice(0, 19) + '\u2026';
  }
  return label;
}
