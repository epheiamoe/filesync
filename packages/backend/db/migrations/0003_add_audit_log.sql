-- ============================================================
-- Migration: add operational audit_log table
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,
  actor_type  TEXT,
  actor_id    TEXT,
  target_type TEXT,
  target_id   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id, created_at);
