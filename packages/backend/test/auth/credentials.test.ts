/**
 * Credentials API tests — focused on API key revocation correctness.
 */
import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import {
  handleCreateApiKey,
  handleListApiKeys,
  handleRevokeApiKey,
} from '../../src/auth/credentials';
import { sha256 } from '../../src/crypto/hash';
import { ADMIN_SCOPE } from '../../src/auth/scopes';
import type { AppContext, AppEnv } from '../../src/types';

class MockD1 implements Pick<D1Database, 'prepare'> {
  private rows: Record<string, unknown>[] = [];
  private runs: { sql: string; bindings: unknown[] }[] = [];

  setApiKeyRows(rows: Record<string, unknown>[]): void {
    this.rows = rows;
  }

  getRuns(): { sql: string; bindings: unknown[] }[] {
    return this.runs;
  }

  private createStatement(normalizedSql: string, bindings: unknown[]) {
    return {
      first: async <T>() => {
        if (normalizedSql.includes('FROM credential_audit WHERE id = ?')) {
          return (this.rows.find((r) => r.id === bindings[0]) ?? null) as T | null;
        }
        if (normalizedSql.includes("WHERE type = 'api_key' AND code_hash = ?")) {
          return (this.rows.find((r) => r.code_hash === bindings[1] && !r.revoked_at) ?? null) as T | null;
        }
        return null as T | null;
      },
      all: async <T>() => {
        let filtered = this.rows;
        if (normalizedSql.includes("WHERE type = 'api_key'")) {
          filtered = filtered.filter((r) => r.type === 'api_key');
        } else if (normalizedSql.includes("WHERE type = 'temp_credential'")) {
          filtered = filtered.filter((r) => r.type === 'temp_credential');
        }
        return { results: filtered as T[] };
      },
      run: async () => {
        this.runs.push({ sql: normalizedSql, bindings });
        let changes = 0;
        if (normalizedSql.includes('DELETE FROM credential_audit')) {
          if (normalizedSql.includes('WHERE id = ?')) {
            const id = bindings[0];
            const idx = this.rows.findIndex((r) => r.id === id && r.type === 'api_key');
            if (idx >= 0) {
              this.rows.splice(idx, 1);
              changes++;
            }
          } else if (normalizedSql.includes('code_hash = ?')) {
            const codeHash = bindings[0];
            const idx = this.rows.findIndex((r) => r.code_hash === codeHash && r.type === 'api_key');
            if (idx >= 0) {
              this.rows.splice(idx, 1);
              changes++;
            }
          }
        } else if (normalizedSql.includes('UPDATE credential_audit SET revoked_at = ?')) {
          if (normalizedSql.includes('WHERE id = ?')) {
            const id = bindings[1];
            for (const row of this.rows) {
              if (row.id === id && row.type === 'api_key' && !row.revoked_at) {
                row.revoked_at = bindings[0];
                changes++;
                break;
              }
            }
          } else if (normalizedSql.includes('code_hash = ?')) {
            const codeHash = bindings[1];
            for (const row of this.rows) {
              if (row.code_hash === codeHash && row.type === 'api_key' && !row.revoked_at) {
                row.revoked_at = bindings[0];
                changes++;
                break;
              }
            }
          }
        }
        return { meta: { changes } };
      },
      bind: (...newBindings: unknown[]) => {
        return this.createStatement(normalizedSql, newBindings);
      },
    };
  }

  prepare(sql: string): {
    bind: (...values: unknown[]) => ReturnType<typeof this.createStatement>;
    first: <T>() => Promise<T | null>;
    all: <T>() => Promise<{ results?: T[] }>;
    run: () => Promise<{ meta?: { changes: number } }>;
  } {
    const normalizedSql = sql.trim();
    return this.createStatement(normalizedSql, []);
  }
}

class MockKV implements Pick<KVNamespace, 'get' | 'put' | 'delete'> {
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

  has(key: string): boolean {
    return this.store.has(key);
  }

  getData(key: string): Record<string, unknown> | null {
    const raw = this.store.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function makeEnv(db: MockD1, kv: MockKV): AppEnv {
  return {
    DB: db as unknown as D1Database,
    KV: kv as unknown as KVNamespace,
    FILES: {} as R2Bucket,
    RoomDO: {} as DurableObjectNamespace,
  };
}

function createMockContext(
  env: AppEnv,
  body: unknown,
  params: Record<string, string> = {},
  headers: Record<string, string> = {}
): { c: Context<AppContext>; response: { status: number; body: unknown } } {
  const state = { status: 200, body: undefined as unknown };

  const c = {
    env,
    get: (key: 'session') =>
      key === 'session'
        ? { account_type: 'admin', scope: ADMIN_SCOPE, admin_id: 'admin-id' }
        : undefined,
    req: {
      json: async () => body,
      header: (name: string) => headers[name.toLowerCase()] ?? undefined,
      param: (name: string) => params[name] ?? undefined,
      query: () => ({}),
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

describe('handleRevokeApiKey', () => {
  it('deletes only the target API key audit record when multiple keys exist', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    // Create two API keys with stored audit rows
    const key1 = 'a'.repeat(32);
    const key2 = 'b'.repeat(32);
    const hash1 = await sha256(key1);
    const hash2 = await sha256(key2);

    db.setApiKeyRows([
      { id: 'audit-1', type: 'api_key', api_key_prefix: key1.slice(0, 8), code_hash: hash1, revoked_at: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'audit-2', type: 'api_key', api_key_prefix: key2.slice(0, 8), code_hash: hash2, revoked_at: null, created_at: '2026-01-02T00:00:00Z' },
    ]);

    await kv.put(
      `apikey:${hash1}`,
      JSON.stringify({ scope: 'create_rooms join_room', created_by: 'admin', created_at: new Date().toISOString(), label: 'Key 1', audit_id: 'audit-1' })
    );
    await kv.put(
      `apikey:${hash2}`,
      JSON.stringify({ scope: 'create_rooms join_room', created_by: 'admin', created_at: new Date().toISOString(), label: 'Key 2', audit_id: 'audit-2' })
    );

    // Delete the first key
    const { c, response } = createMockContext(env, {}, { keyHash: hash1 }, { 'cf-connecting-ip': '1.2.3.4' });
    await handleRevokeApiKey(c);

    expect(response.status).toBe(200);

    const rows = (db as unknown as { rows: Record<string, unknown>[] }).rows;
    const remainingIds = rows.map((r) => r.id);
    expect(remainingIds).toEqual(['audit-2']);

    expect(kv.has(`apikey:${hash1}`)).toBe(false);
    expect(kv.has(`apikey:${hash2}`)).toBe(true);

    // Verify the D1 DELETE was scoped by id
    const deleteRuns = db.getRuns().filter((r) =>
      r.sql.includes('DELETE FROM credential_audit')
    );
    expect(deleteRuns.length).toBeGreaterThan(0);
    const targetRun = deleteRuns[0];
    expect(targetRun.sql).toContain('WHERE id = ?');
  });

  it('falls back to code_hash matching for legacy KV entries without audit_id', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const key = 'c'.repeat(32);
    const hash = await sha256(key);

    db.setApiKeyRows([
      { id: 'audit-legacy', type: 'api_key', api_key_prefix: key.slice(0, 8), code_hash: hash, revoked_at: null, created_at: '2026-01-01T00:00:00Z' },
    ]);

    // Legacy KV entry without audit_id
    await kv.put(
      `apikey:${hash}`,
      JSON.stringify({ scope: 'create_rooms join_room', created_by: 'admin', created_at: new Date().toISOString(), label: 'Legacy Key' })
    );

    const { c, response } = createMockContext(env, {}, { keyHash: hash }, { 'cf-connecting-ip': '1.2.3.4' });
    await handleRevokeApiKey(c);

    expect(response.status).toBe(200);

    const rows = (db as any).rows as Record<string, unknown>[];
    expect(rows).toHaveLength(0);
  });
});

describe('handleListApiKeys', () => {
  it('returns API keys for admin', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const key = 'a'.repeat(32);
    const hash = await sha256(key);

    db.setApiKeyRows([
      {
        id: 'audit-1',
        type: 'api_key',
        label: 'Test Key',
        api_key_prefix: key.slice(0, 8),
        code_hash: hash,
        created_by: 'admin',
        used_at: null,
        expires_at: '2027-07-13T00:00:00Z',
        revoked_at: null,
        created_at: '2026-07-13T00:00:00Z',
      },
    ]);

    const { c, response } = createMockContext(env, {}, {}, { 'cf-connecting-ip': '1.2.3.4' });
    await handleListApiKeys(c);

    expect(response.status).toBe(200);
    const data = (response.body as any).data;
    expect(data.api_keys).toHaveLength(1);
    expect(data.api_keys[0].id).toBe('audit-1');
    expect(data.api_keys[0].label).toBe('Test Key');
    expect(data.api_keys[0].api_key_prefix).toBe(key.slice(0, 8));
    expect(data.api_keys[0].key_hash).toBe(hash);
    expect(data.api_keys[0].revoked_at).toBeNull();
  });

  it('rejects non-admin with 403', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const c = {
      env,
      get: (key: 'session') =>
        key === 'session'
          ? { account_type: 'api_key', scope: 'create_rooms', admin_id: undefined }
          : undefined,
      req: {
        json: async () => ({}),
        header: () => undefined,
        param: () => undefined,
        query: () => ({}),
      },
      json: (jsonBody: unknown, status?: number) => new Response(JSON.stringify(jsonBody), { status: status ?? 200 }),
      header: () => undefined,
    } as unknown as Context<AppContext>;

    const res = await handleListApiKeys(c);
    expect(res.status).toBe(403);
  });

  it('does not include temp_credential records', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    db.setApiKeyRows([
      {
        id: 'audit-api',
        type: 'api_key',
        label: 'API Key',
        api_key_prefix: 'aaaaaaaa',
        code_hash: 'hash1',
        created_by: 'admin',
        used_at: null,
        expires_at: '2027-07-13T00:00:00Z',
        revoked_at: null,
        created_at: '2026-07-13T00:00:00Z',
      },
      {
        id: 'audit-temp',
        type: 'temp_credential',
        label: null,
        api_key_prefix: null,
        code_hash: 'hash2',
        created_by: 'admin',
        used_at: null,
        expires_at: '2027-07-13T00:00:00Z',
        revoked_at: null,
        created_at: '2026-07-13T00:00:00Z',
      },
    ]);

    const { c, response } = createMockContext(env, {}, {}, { 'cf-connecting-ip': '1.2.3.4' });
    await handleListApiKeys(c);

    const data = (response.body as any).data;
    expect(data.api_keys).toHaveLength(1);
    expect(data.api_keys[0].id).toBe('audit-api');
  });

  it('returns the label stored in D1', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const key = 'b'.repeat(32);
    const hash = await sha256(key);

    db.setApiKeyRows([
      {
        id: 'audit-labeled',
        type: 'api_key',
        label: 'CI deploy',
        api_key_prefix: key.slice(0, 8),
        code_hash: hash,
        created_by: 'admin',
        used_at: null,
        expires_at: '2027-07-13T00:00:00Z',
        revoked_at: null,
        created_at: '2026-07-13T00:00:00Z',
      },
    ]);

    const { c, response } = createMockContext(env, {}, {}, { 'cf-connecting-ip': '1.2.3.4' });
    await handleListApiKeys(c);

    const data = (response.body as any).data;
    expect(data.api_keys[0].label).toBe('CI deploy');
  });
});

describe('handleCreateApiKey', () => {
  it('stores audit_id in KV key data for precise revocation', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const { c, response } = createMockContext(
      env,
      { label: 'Test Key' },
      {},
      { 'cf-connecting-ip': '1.2.3.4' }
    );
    await handleCreateApiKey(c);

    expect(response.status).toBe(201);
    const key = ((response.body as any).data.key as string);
    const hash = await sha256(key);
    const stored = kv.getData(`apikey:${hash}`);
    expect(stored).not.toBeNull();
    expect(stored?.audit_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('persists label and code_hash in D1 audit record', async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const env = makeEnv(db, kv);

    const { c, response } = createMockContext(
      env,
      { label: 'Test Key' },
      {},
      { 'cf-connecting-ip': '1.2.3.4' }
    );
    await handleCreateApiKey(c);

    expect(response.status).toBe(201);
    const key = ((response.body as any).data.key as string);
    const hash = await sha256(key);

    const insertRuns = db.getRuns().filter((r) => r.sql.includes('INSERT INTO credential_audit'));
    expect(insertRuns).toHaveLength(1);
    const insert = insertRuns[0];
    expect(insert.bindings).toContain('Test Key');
    expect(insert.bindings).toContain(hash);
    expect(insert.bindings).toContain(key.slice(0, 8));
  });
});
