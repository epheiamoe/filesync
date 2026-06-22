/**
 * Cron cleanup handler unit tests.
 */
import { describe, it, expect } from 'vitest';
import { handleScheduled } from '../../src/cron/cleanup';
import type { AppEnv } from '../../src/types';

class MockD1 implements Pick<D1Database, 'prepare'> {
  private responses: Map<
    string,
    {
      first?: Record<string, unknown> | null;
      all?: Record<string, unknown>[];
      runMeta?: { changes: number };
    }
  > = new Map();

  setResponse(
    sql: string,
    response: {
      first?: Record<string, unknown> | null;
      all?: Record<string, unknown>[];
      runMeta?: { changes: number };
    }
  ): void {
    this.responses.set(sql.trim(), response);
  }

  prepare(sql: string): {
    bind: (...values: unknown[]) => {
      first: <T>() => Promise<T | null>;
      all: <T>() => Promise<{ results?: T[] }>;
      run: () => Promise<{ meta?: { changes: number } }>;
    };
  } {
    return {
      bind: () => {
        const normalizedSql = sql.trim();
        const response = this.responses.get(normalizedSql);
        return {
          first: async <T>() => (response?.first ?? null) as T | null,
          all: async <T>() => ({ results: (response?.all ?? []) as T[] }),
          run: async () => ({ meta: response?.runMeta ?? { changes: 0 } }),
        };
      },
    };
  }
}

class MockR2 implements Pick<R2Bucket, 'list' | 'delete'> {
  private objects: { key: string; size: number }[];
  private cursorValue: string | undefined;
  deleted: string[] = [];

  constructor(objects: { key: string; size: number }[], cursor?: string) {
    this.objects = objects;
    this.cursorValue = cursor;
  }

  async list(): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }> {
    return {
      objects: this.objects.map((o) => ({ key: o.key, size: o.size }) as R2Object),
      truncated: this.cursorValue !== undefined,
      cursor: this.cursorValue,
    };
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
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
}

function makeEnv(db: MockD1, files: MockR2, kv: MockKV): AppEnv {
  return {
    DB: db as unknown as D1Database,
    KV: kv as unknown as KVNamespace,
    FILES: files as unknown as R2Bucket,
    RoomDO: {} as DurableObjectNamespace,
  };
}

describe('Orphan R2 cleanup', () => {
  it('deletes R2 objects not referenced by active file_metadata rows', async () => {
    const db = new MockD1();
    const r2 = new MockR2([
      { key: 'rooms/1234/file-active', size: 100 },
      { key: 'rooms/1234/file-orphan', size: 200 },
    ]);
    const kv = new MockKV();
    const env = makeEnv(db, r2, kv);

    db.setResponse(
      `SELECT fm.r2_key
       FROM file_metadata fm
       JOIN rooms r ON r.id = fm.room_id
       WHERE fm.recalled_at IS NULL
         AND r.deleted_at IS NULL
       LIMIT ? OFFSET ?`,
      { all: [{ r2_key: 'rooms/1234/file-active' }] }
    );

    db.setResponse('SELECT 1 as one FROM file_metadata WHERE r2_key = ? LIMIT 1', {
      first: null,
    });

    const result = await handleScheduled(env);

    expect(result.orphanedObjects).toBe(1);
    expect(r2.deleted).toContain('rooms/1234/file-orphan');
    expect(r2.deleted).not.toContain('rooms/1234/file-active');
  });

  it('does not delete objects whose r2_key appears in D1 on double-check', async () => {
    const db = new MockD1();
    const r2 = new MockR2([{ key: 'rooms/1234/racing-upload', size: 50 }]);
    const kv = new MockKV();
    const env = makeEnv(db, r2, kv);

    db.setResponse(
      `SELECT fm.r2_key
       FROM file_metadata fm
       JOIN rooms r ON r.id = fm.room_id
       WHERE fm.recalled_at IS NULL
         AND r.deleted_at IS NULL
       LIMIT ? OFFSET ?`,
      { all: [] }
    );

    db.setResponse('SELECT 1 as one FROM file_metadata WHERE r2_key = ? LIMIT 1', {
      first: { one: 1 },
    });

    const result = await handleScheduled(env);

    expect(result.orphanedObjects).toBe(0);
    expect(r2.deleted).toHaveLength(0);
  });

  it('persists R2 cursor when R2 list is truncated', async () => {
    const db = new MockD1();
    const r2 = new MockR2([{ key: 'rooms/1234/file-1', size: 10 }], 'next-page-token');
    const kv = new MockKV();
    const env = makeEnv(db, r2, kv);

    db.setResponse(
      `SELECT fm.r2_key
       FROM file_metadata fm
       JOIN rooms r ON r.id = fm.room_id
       WHERE fm.recalled_at IS NULL
         AND r.deleted_at IS NULL
       LIMIT ? OFFSET ?`,
      { all: [] }
    );

    db.setResponse('SELECT 1 as one FROM file_metadata WHERE r2_key = ? LIMIT 1', {
      first: null,
    });

    await handleScheduled(env);

    expect(await kv.get('cleanup:orphan_cursor')).toBe('next-page-token');
    expect(await kv.get('cleanup:orphan_d1_offset')).toBe('0');
  });

  it('advances D1 offset and clears R2 cursor when R2 list completes but D1 batch is full', async () => {
    const db = new MockD1();
    const r2 = new MockR2([{ key: 'rooms/1234/file-1', size: 10 }]);
    const kv = new MockKV();
    const env = makeEnv(db, r2, kv);

    // Simulate a full D1 batch (1000 keys) so the handler knows there may be more D1 rows.
    const keys = Array.from({ length: 1000 }, (_, i) => ({ r2_key: `rooms/1234/active-${i}` }));
    db.setResponse(
      `SELECT fm.r2_key
       FROM file_metadata fm
       JOIN rooms r ON r.id = fm.room_id
       WHERE fm.recalled_at IS NULL
         AND r.deleted_at IS NULL
       LIMIT ? OFFSET ?`,
      { all: keys }
    );

    db.setResponse('SELECT 1 as one FROM file_metadata WHERE r2_key = ? LIMIT 1', {
      first: null,
    });

    await handleScheduled(env);

    expect(await kv.get('cleanup:orphan_cursor')).toBeNull();
    expect(await kv.get('cleanup:orphan_d1_offset')).toBe('1000');
  });
});
