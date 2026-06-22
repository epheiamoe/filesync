/**
 * Minimal operational audit logger.
 *
 * Writes structured events to the D1 `audit_log` table. Audit writes are
 * intentionally fire-and-forget: failures are logged but never block the
 * primary business flow.
 *
 * @module audit/logger
 */

import { generateId } from '../utils/id';

export interface AuditEntry {
  action: string;
  actor_type?: string;
  actor_id?: string;
  target_type?: string;
  target_id?: string;
  ip?: string;
  user_agent?: string;
  details?: Record<string, unknown>;
}

interface AuditEnv {
  DB: D1Database;
}

/**
 * Persist an audit entry to D1.
 *
 * @param env - Worker environment containing the D1 binding
 * @param entry - Audit event payload
 */
export async function logAudit(env: AuditEnv, entry: AuditEntry): Promise<void> {
  try {
    const id = generateId();
    const createdAt = new Date().toISOString();
    const details = entry.details ? JSON.stringify(entry.details) : null;

    await env.DB.prepare(
      `INSERT INTO audit_log (
        id, action, actor_type, actor_id, target_type, target_id,
        ip, user_agent, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        entry.action,
        entry.actor_type ?? null,
        entry.actor_id ?? null,
        entry.target_type ?? null,
        entry.target_id ?? null,
        entry.ip ?? null,
        entry.user_agent ?? null,
        details,
        createdAt
      )
      .run();
  } catch (err) {
    // Audit logging must never block the main request. In production this
    // should be replaced with a structured log sink or alerting integration.
    // [Debt: structured logging]
    console.error('[audit] failed to write audit entry:', err);
  }
}
