/**
 * Audit logger tests.
 */
import { describe, it, expect } from 'vitest';
import { logAudit, type AuditEntry } from '../../src/audit/logger';
import type { AppEnv } from '../../src/types';

class MockD1 implements Pick<D1Database, 'prepare'> {
  private shouldFail = false;
  private lastSql: string | null = null;
  private lastBindings: unknown[] = [];

  failNext(): void {
    this.shouldFail = true;
  }

  getLastSql(): string | null {
    return this.lastSql;
  }

  getLastBindings(): unknown[] {
    return this.lastBindings;
  }

  prepare(sql: string): { bind: (...values: unknown[]) => { run: () => Promise<unknown> } } {
    this.lastSql = sql;
    return {
      bind: (...values: unknown[]) => {
        this.lastBindings = values;
        return {
          run: async () => {
            if (this.shouldFail) {
              this.shouldFail = false;
              throw new Error('D1 simulated failure');
            }
            return { success: true };
          },
        };
      },
    };
  }
}

function makeEnv(db: MockD1): AppEnv {
  return { DB: db as unknown as D1Database } as AppEnv;
}

describe('logAudit', () => {
  it('writes an audit entry to D1', async () => {
    const db = new MockD1();
    const env = makeEnv(db);

    const entry: AuditEntry = {
      action: 'login_success',
      actor_type: 'admin',
      actor_id: 'admin-id',
      target_type: 'admin_account',
      target_id: 'admin-id',
      ip: '1.2.3.4',
      details: { method: 'admin' },
    };

    await logAudit(env, entry);

    expect(db.getLastSql()).toContain('INSERT INTO audit_log');
    const bindings = db.getLastBindings();
    expect(bindings[1]).toBe('login_success');
    expect(bindings[2]).toBe('admin');
    expect(bindings[6]).toBe('1.2.3.4');
  });

  it('does not throw when D1 fails', async () => {
    const db = new MockD1();
    db.failNext();
    const env = makeEnv(db);

    await expect(
      logAudit(env, {
        action: 'login_failed',
        actor_type: 'anonymous',
      })
    ).resolves.toBeUndefined();
  });

  it('serializes details as JSON', async () => {
    const db = new MockD1();
    const env = makeEnv(db);

    await logAudit(env, {
      action: 'credential_created',
      details: { label: 'test-key', prefix: 'abcd1234' },
    });

    const bindings = db.getLastBindings();
    expect(bindings[8]).toBe('{"label":"test-key","prefix":"abcd1234"}');
  });
});
