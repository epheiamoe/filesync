-- ============================================================
-- epheia-files D1 Seed Data
-- Creates default admin account.
-- ============================================================
-- IMPORTANT: Change this password immediately after first login!
-- Username: admin
-- Password: admin123
-- Salt:     a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 (16 random bytes → 32 hex chars)
-- Hash:     SHA-256(salt + password) → stored as salt+hash (96 hex chars)
-- ============================================================

INSERT OR IGNORE INTO admin_accounts (id, username, password_hash)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin',
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a2ef14f9f7885c301271f725421f990a8145cee015023edda62805ad205efb99'
);
