/**
 * Admin password change handler unit tests.
 */
import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { handleChangePassword } from '../../src/admin/password';
import { hashPassword, verifyPassword } from '../../src/crypto/hash';
import { ADMIN_SCOPE } from '../../src/auth/scopes';
import type { AppContext, AppEnv } from '../../src/types';

class MockD1 implements Pick<D1Database, 'prepare'> {
  private rows: Map<string, Record<string, unknown>[]> = new Map();
  private runs: { sql: string; bindings: unknown[] }[] = [];

  setRows(sql: string, rows: Record<string, unknown>[]): void {
    this.rows.set(sql.trim(), rows);
  }

  getRuns(): { sql: string; bindings: unknown[] }[] {
    return this.runs;
  }

  getLastRun(): { sql: string; bindings: unknown[] } | null {
    return this.runs[this.runs.length - 1] ?? null;
  }

  prepare(sql: string): {
    bind: (...values: unknown[]) => {
      first: <T>() => Promise<T | null>;
      run: () => Promise<{ meta?: { changes: number } }>;
    };
  } {
    return {
      bind: (...values: unknown[]) => {
        const normalizedSql = sql.trim();
        return {
          first: async <T>() => {
            const rows = this.rows.get(normalizedSql) || [];
            return (rows[0] ?? null) as T | null;
          },
          run: async () => {
            this.runs.push({ sql: normalizedSql, bindings: values });
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

class MockKV implements Pick<KVNamespace, 'get' | 'put' | 'delete' | 'list'> {
  async get(): Promise<string | null> {
    return null;
  }

  async put(): Promise<void> {}

  async delete(): Promise<void> {}

  async list(): Promise<{ objects: unknown[]; truncated: boolean }> {
    return { objects: [], truncated: false };
  }
}

function makeEnv(db: MockD1): AppEnv {
  return {
    DB: db as unknown as D1Database,
    KV: new MockKV() as unknown as KVNamespace,
    FILES: {} as R2Bucket,
    RoomDO: {} as DurableObjectNamespace,
  };
}

function createMockContext(
  env: AppEnv,
  session: { account_type: string; scope: string; admin_id?: string } | null,
  body: unknown,
  headers: Record<string, string> = {}
): { c: Context<AppContext>; response: { status: number; body: unknown } } {
  const state = { status: 200, body: undefined as unknown };

  const c = {
    env,
    get: (key: 'session') => (key === 'session' ? session : undefined),
    req: {
      json: async () => body,
      header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    },
    json: (jsonBody: unknown, status?: number) => {
      state.body = jsonBody;
      state.status = status ?? 200;
      return new Response(JSON.stringify(jsonBody), { status: state.status });
    },
    header: () => undefined,
  };

  return {
    c: c as unknown as Context<AppContext>,
    response: {
      get status() {
        return state.status;
      },
      get body() {
        return state.body;
      },
    },
  };
}

describe('handleChangePassword', () => {
  it('changes the password and stores a PBKDF2 hash', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const adminId = '00000000-0000-0000-0000-000000000001';
    const currentHash = await hashPassword('oldpassword');

    db.setRows(
      'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?',
      [{ id: adminId, username: 'admin', password_hash: currentHash }]
    );

    const { c, response } = createMockContext(
      env,
      { account_type: 'admin', scope: ADMIN_SCOPE, admin_id: adminId },
      { current_password: 'oldpassword', new_password: 'newlongpassword' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );

    await handleChangePassword(c);

    expect(response.status).toBe(200);
    expect((response.body as any).success).toBe(true);

    const update = db.getRuns().find((r) => r.sql.includes('UPDATE admin_accounts SET password_hash = ?'));
    expect(update).toBeDefined();
    const newHash = update!.bindings[0] as string;
    expect(newHash.startsWith('$pbkdf2-sha256$')).toBe(true);
    expect(await verifyPassword('newlongpassword', newHash)).toBe(true);
  });

  it('rejects incorrect current password', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const adminId = '00000000-0000-0000-0000-000000000001';
    const currentHash = await hashPassword('oldpassword');

    db.setRows(
      'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?',
      [{ id: adminId, username: 'admin', password_hash: currentHash }]
    );

    const { c, response } = createMockContext(
      env,
      { account_type: 'admin', scope: ADMIN_SCOPE, admin_id: adminId },
      { current_password: 'wrongpassword', new_password: 'newlongpassword' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );

    await handleChangePassword(c);

    expect(response.status).toBe(401);
    expect((response.body as any).code).toBe('UNAUTHORIZED');
  });

  it('rejects sessions with scope containing admin as substring', async () => {
    const db = new MockD1();
    const env = makeEnv(db);

    const { c, response } = createMockContext(
      env,
      { account_type: 'api_key', scope: 'room_admin create_rooms join_room' },
      { current_password: 'old', new_password: 'newlongpassword' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );

    await handleChangePassword(c);

    expect(response.status).toBe(403);
  });

  it('rejects non-admin sessions', async () => {
    const db = new MockD1();
    const env = makeEnv(db);

    const { c, response } = createMockContext(
      env,
      { account_type: 'temp_credential', scope: 'join_room' },
      { current_password: 'old', new_password: 'newlongpassword' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );

    await handleChangePassword(c);

    expect(response.status).toBe(403);
  });
});
