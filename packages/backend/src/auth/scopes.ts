/**
 * Authorization scope constants.
 *
 * Centralizing scope strings prevents typos and makes the flattened
 * space-separated scope model easier to audit. New scopes should be added
 * here and nowhere else.
 *
 * @module auth/scopes
 */

export const SCOPES = {
  ADMIN: 'admin',
  CREATE_ROOMS: 'create_rooms',
  JOIN_ROOM: 'join_room',
} as const;

/** Full scope granted to admin accounts after password login. */
export const ADMIN_SCOPE = `${SCOPES.ADMIN} ${SCOPES.CREATE_ROOMS} ${SCOPES.JOIN_ROOM}`;

/** Default scope granted to API keys. */
export const API_KEY_SCOPE = `${SCOPES.CREATE_ROOMS} ${SCOPES.JOIN_ROOM}`;

/** Default scope granted to temporary credentials. */
export const TEMP_CREDENTIAL_SCOPE = SCOPES.JOIN_ROOM;
