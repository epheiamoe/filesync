import { describe, it, expect } from 'vitest';
import { buildLoginUrl, parseLoginHash, splitShareAndCredential } from '@/lib/url';

// A realistic share string: 4-digit room code + 13 groups of 4 Crockford
// base32 chars (32-byte AES key), as produced by encodeShareString.
const SHARE =
  '4821-NCYJ-EXN2-4ZFV-R1XW-326X-2RS9-MWKD-KANF-HVA5-E77B-8EF4-0ACB-1V70';

describe('splitShareAndCredential', () => {
  it('returns the whole string when no credential is appended', () => {
    expect(splitShareAndCredential(SHARE)).toEqual({
      shareString: SHARE,
      credential: null,
    });
  });

  it('extracts an 8-char credential (current backend format)', () => {
    expect(splitShareAndCredential(`${SHARE}-4JVA27Y7`)).toEqual({
      shareString: SHARE,
      credential: '4JVA27Y7',
    });
  });

  it('extracts a 6-char credential (legacy format)', () => {
    expect(splitShareAndCredential(`${SHARE}-A1B2C3`)).toEqual({
      shareString: SHARE,
      credential: 'A1B2C3',
    });
  });

  it('uppercases the extracted credential', () => {
    expect(splitShareAndCredential(`${SHARE}-4jva27y7`).credential).toBe('4JVA27Y7');
  });

  it('never mistakes a trailing 4-char key group for a credential', () => {
    // Every share-string segment is exactly 4 chars — outside the 6-8 range.
    const { shareString, credential } = splitShareAndCredential(SHARE);
    expect(credential).toBeNull();
    expect(shareString.endsWith('-1V70')).toBe(true);
  });

  it('returns the input untouched when there is no dash', () => {
    expect(splitShareAndCredential('ABCDEF12')).toEqual({
      shareString: 'ABCDEF12',
      credential: null,
    });
  });
});

describe('parseLoginHash', () => {
  it('returns empty results for an empty hash', () => {
    expect(parseLoginHash('')).toEqual({ shareString: '', credential: null });
    expect(parseLoginHash('#')).toEqual({ shareString: '', credential: null });
  });

  it('parses a hash without credential', () => {
    expect(parseLoginHash(`#${SHARE}`)).toEqual({
      shareString: SHARE,
      credential: null,
    });
  });

  it('parses a URI-encoded hash with an 8-char credential', () => {
    const hash = `#${encodeURIComponent(SHARE)}-4JVA27Y7`;
    expect(parseLoginHash(hash)).toEqual({
      shareString: SHARE,
      credential: '4JVA27Y7',
    });
  });

  it('survives malformed percent-encoding', () => {
    expect(parseLoginHash('#%E0%A4%A')).toEqual({
      shareString: '#%E0%A4%A'.slice(1),
      credential: null,
    });
  });
});

describe('buildLoginUrl → parseLoginHash round-trip', () => {
  it('recovers share string and credential from a full login URL', () => {
    const url = buildLoginUrl(SHARE, '4JVA27Y7');
    const hash = url.slice(url.indexOf('#'));
    expect(parseLoginHash(hash)).toEqual({
      shareString: SHARE,
      credential: '4JVA27Y7',
    });
  });

  it('recovers just the share string when no credential is given', () => {
    const url = buildLoginUrl(SHARE);
    const hash = url.slice(url.indexOf('#'));
    expect(parseLoginHash(hash)).toEqual({
      shareString: SHARE,
      credential: null,
    });
  });
});
