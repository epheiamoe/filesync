-- ============================================================
-- epheia-files D1 Seed Data
-- Creates default admin account.
-- ============================================================
-- IMPORTANT: This seed uses a one-time strong password.
-- The password will be rotated by the user after first login.
-- Generated: 2026-06-23
-- ============================================================

INSERT OR IGNORE INTO admin_accounts (id, username, password_hash)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin',
  '523aefacec4a251135ed822fa1a176a88d88f85efbc2c93efc8fe589dd7575de3a6ff3e15632bfbc261e075fe013275c'
);
