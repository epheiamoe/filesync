/**
 * Scope constants tests.
 */
import { describe, it, expect } from 'vitest';
import { SCOPES, ADMIN_SCOPE, API_KEY_SCOPE, TEMP_CREDENTIAL_SCOPE } from '../../src/auth/scopes';

describe('SCOPES', () => {
  it('exposes expected individual scopes', () => {
    expect(SCOPES.ADMIN).toBe('admin');
    expect(SCOPES.CREATE_ROOMS).toBe('create_rooms');
    expect(SCOPES.JOIN_ROOM).toBe('join_room');
  });
});

describe('ADMIN_SCOPE', () => {
  it('contains admin, create_rooms and join_room', () => {
    const parts = ADMIN_SCOPE.split(' ');
    expect(parts).toContain('admin');
    expect(parts).toContain('create_rooms');
    expect(parts).toContain('join_room');
    expect(parts.length).toBe(3);
  });
});

describe('API_KEY_SCOPE', () => {
  it('contains create_rooms and join_room without admin', () => {
    expect(API_KEY_SCOPE).toBe('create_rooms join_room');
    expect(API_KEY_SCOPE).not.toContain('admin');
  });
});

describe('TEMP_CREDENTIAL_SCOPE', () => {
  it('is exactly join_room', () => {
    expect(TEMP_CREDENTIAL_SCOPE).toBe('join_room');
  });
});
