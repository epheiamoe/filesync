/**
 * Login handler unit tests.
 *
 * Uses in-memory D1/KV mocks to exercise authentication, rate limiting,
 * scope constants, and legacy-password rehashing without a real Cloudflare account.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Context } from 'hono';
import { handleLogin } from '../../src/auth/login';
import { hashPassword } from '../../src/crypto/hash';
import { sha256 } from '../../src/crypto/hash';
import { ADMIN_SCOPE, API_KEY_SCOPE, TEMP_CREDENTIAL_SCOPE } from '../../src/auth/scopes';
import type { AppContext, AppEnv } from '../../src/types';

// ---- Mocks ----

class MockD1 implements Pick<D1Database, 'prepare'> {
  private rows: Map<string, Record<string, unknown>[]> = new Map();
  private lastRun: { sql: string; bindings: unknown[] } | null = null;
  private shouldFailNext = false;

  setRows(sql: string, rows: Record<string, unknown>[]): void {
    this.rows.set(sql.trim(), rows);
  }

  getLastRun(): { sql: string; bindings: unknown[] } | null {
    return this.lastRun;
  }

  failNext(): void {
    this.shouldFailNext = true;
  }

  prepare(sql: string): {
    bind: (...values: unknown[]) => {
      first: <T>() => Promise<T | null>;
      all: <T>() => Promise<{ results?: T[] }>;
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
          all: async <T>() => {
            const rows = this.rows.get(normalizedSql) || [];
            return { results: rows as T[] };
          },
          run: async () => {
            this.lastRun = { sql: normalizedSql, bindings: values };
            if (this.shouldFailNext) {
              this.shouldFailNext = false;
              throw new Error('D1 simulated failure');
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

class MockKV implements Pick<KVNamespace, 'get' | 'put' | 'delete' | 'list'> {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ objects: unknown[]; truncated: boolean }> {
    return { objects: [], truncated: false };
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

function makeEnv(db: MockD1, kv: MockKV): AppEnv {
  return {
    DB: db as unknown as D1Database,
    KV: kv as unknown as KVNamespace,
    FILES: {} as R2Bucket,
    RoomDO: {} as DurableObjectNamespace,
    CORS_ALLOWED_ORIGINS: '*',
  };
}

interface MockResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

function createMockContext(
  env: AppEnv,
  body: unknown,
  headers: Record<string, string> = {}
): { c: Context<AppContext>; response: MockResponse; waitUntilPromises: Promise<unknown>[] } {
  const responseHeaders = new Headers();
  const waitUntilPromises: Promise<unknown>[] = [];

  const state = {
    status: 200,
    body: undefined as unknown,
  };

  const c = {
    env,
    req: {
      json: async () => body,
      header: (name: string) => {
        const key = name.toLowerCase();
        return headers[key] ?? undefined;
      },
    },
    json: (jsonBody: unknown, status?: number) => {
      state.body = jsonBody;
      state.status = status ?? 200;
      return new Response(JSON.stringify(jsonBody), { status: state.status });
    },
    header: (name: string, value: string) => {
      responseHeaders.set(name, value);
    },
    executionCtx: {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
    },
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
      headers: responseHeaders,
    },
    waitUntilPromises,
  };
}

// ---- Tests ----

describe('Admin login', () => {
  it('succeeds with a PBKDF2 password hash', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);
    const adminId = '00000000-0000-0000-0000-000000000001';
    const passwordHash = await hashPassword('admin123');
    db.setRows(
      'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?',
      [{ id: adminId, username: 'admin', password_hash: passwordHash }]
    );

    const { c, response, waitUntilPromises } = createMockContext(
      env,
      { username: 'admin', password: 'admin123' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );

    await handleLogin(c);
    await Promise.all(waitUntilPromises);

    expect(response.status).toBe(200);
    expect((response.body as any).success).toBe(true);
    expect((response.body as any).data.token).toMatch(/^[a-f0-9]{64}$/);
    expect((response.body as any).data.scope).toBe(ADMIN_SCOPE);
    expect((response.body as any).data.account_type).toBe('admin');
  });

  it('rehashes legacy SHA-256 passwords on success', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);
    const adminId = '00000000-0000-0000-0000-000000000001';
    const legacyHash =
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a2ef14f9f7885c301271f725421f990a8145cee015023edda62805ad205efb99';

    db.setRows(
      'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?',
      [{ id: adminId, username: 'admin', password_hash: legacyHash }]
    );

    const { c, response, waitUntilPromises } = createMockContext(
      env,
      { username: 'admin', password: 'admin123' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );

    await handleLogin(c);
    await Promise.all(waitUntilPromises);

    expect(response.status).toBe(200);
    expect((response.body as any).success).toBe(true);

    const update = db.getLastRun();
    expect(update?.sql).toContain('UPDATE admin_accounts SET password_hash = ?');
    expect(update?.bindings[1]).toBe(adminId);
    expect((update?.bindings[0] as string).startsWith('$pbkdf2-sha256$')).toBe(true);
  });

  it('returns 401 for invalid passwords and records failures', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);
    const adminId = '00000000-0000-0000-0000-000000000001';
    const passwordHash = await hashPassword('admin123');
    db.setRows(
      'SELECT id, username, password_hash FROM admin_accounts WHERE username = ?',
      [{ id: adminId, username: 'admin', password_hash: passwordHash }]
    );

    for (let i = 0; i < 5; i++) {
      const { c, response } = createMockContext(
        env,
        { username: 'admin', password: 'wrong' },
        { 'cf-connecting-ip': '1.2.3.4' }
      );
      await handleLogin(c);
      expect(response.status).toBe(401);
    }

    // 6th attempt should be rate limited
    const { c, response } = createMockContext(
      env,
      { username: 'admin', password: 'wrong' },
      { 'cf-connecting-ip': '1.2.3.4' }
    );
    await handleLogin(c);
    expect(response.status).toBe(429);
    expect((response.body as any).code).toBe('RATE_LIMITED');
    expect((response.body as any).retry_after).toBeGreaterThan(0);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('API key login', () => {
  it('succeeds with a valid API key', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);
    const apiKey = 'a'.repeat(32);
    const keyHash = await sha256(apiKey);
    await kv.put(
      `apikey:${keyHash}`,
      JSON.stringify({ scope: API_KEY_SCOPE, created_by: 'admin', created_at: new Date().toISOString() })
    );

    const { c, response } = createMockContext(
      env,
      { api_key: apiKey },
      { 'cf-connecting-ip': '2.3.4.5' }
    );
    await handleLogin(c);

    expect(response.status).toBe(200);
    expect((response.body as any).data.scope).toBe(API_KEY_SCOPE);
    expect((response.body as any).data.account_type).toBe('api_key');
  });

  it('returns 401 for an invalid API key', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const { c, response } = createMockContext(
      env,
      { api_key: 'b'.repeat(32) },
      { 'cf-connecting-ip': '2.3.4.5' }
    );
    await handleLogin(c);

    expect(response.status).toBe(401);
  });
});

describe('Temp credential login', () => {
  it('succeeds with a valid temp code', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);
    const code = 'ABCD1234';
    const codeHash = await sha256(code.toUpperCase());
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await kv.put(
      `tempcred:${codeHash}`,
      JSON.stringify({ scope: TEMP_CREDENTIAL_SCOPE, created_by: 'admin', expires_at: expiresAt })
    );

    const { c, response } = createMockContext(
      env,
      { temp_code: code },
      { 'cf-connecting-ip': '3.4.5.6' }
    );
    await handleLogin(c);

    expect(response.status).toBe(200);
    expect((response.body as any).data.scope).toBe(TEMP_CREDENTIAL_SCOPE);
    expect((response.body as any).data.account_type).toBe('temp_credential');
    expect(kv.has(`tempcred:${codeHash}`)).toBe(false);
  });

  it('rejects an expired temp code', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);
    const code = 'ABCD1234';
    const codeHash = await sha256(code.toUpperCase());
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    await kv.put(
      `tempcred:${codeHash}`,
      JSON.stringify({ scope: TEMP_CREDENTIAL_SCOPE, created_by: 'admin', expires_at: expiresAt })
    );

    const { c, response } = createMockContext(
      env,
      { temp_code: code },
      { 'cf-connecting-ip': '3.4.5.6' }
    );
    await handleLogin(c);

    expect(response.status).toBe(401);
  });
});
