-- ============================================================
-- epheia-files D1 Database Schema
-- Task 1: Backend Foundation
-- ============================================================

-- ============================================================
-- Table: admin_accounts
-- 管理员账户，仅通过 seed 脚本创建，无公开注册
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_accounts (
  id            TEXT PRIMARY KEY,                          -- UUID v4
  username      TEXT NOT NULL UNIQUE,                      -- 登录名
  password_hash TEXT NOT NULL,                             -- SHA-256(salt + password)，salt 为 16 字节 hex 前缀（32 chars）
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Table: rooms
-- 房间主表。deleted_at 非空表示软删除
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,                          -- UUID v4
  room_code     TEXT NOT NULL UNIQUE,                      -- 4 位字符码 (如 "4821")
  key_hash      TEXT NOT NULL,                             -- SHA-256(room_key_raw_bytes) hex
  admin_id      TEXT REFERENCES admin_accounts(id),        -- 创建者，可为 null（非 admin 创建）
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT                                       -- 软删除时间戳
);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_admin ON rooms(admin_id);

-- Migration: Add last_active_at for room activity tracking (Feature #12)
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS, so check manually or run once
-- ALTER TABLE rooms ADD COLUMN last_active_at TEXT;
-- ALTER TABLE works idempotently in D1 — if column exists, it errors but is safe to retry.

-- ============================================================
-- Table: room_members
-- 记录谁加入了哪个房间。session_id 是客户端生成的匿名标识
-- ============================================================
CREATE TABLE IF NOT EXISTS room_members (
  id            TEXT PRIMARY KEY,                          -- UUID v4
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  session_id    TEXT NOT NULL,                             -- 客户端随机生成的 session 标识
  device_label  TEXT,                                      -- 解析自 User-Agent，如 "iPhone Safari"
  joined_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_members_session ON room_members(session_id);

-- Migration: Add client_fingerprint for cross-session room tracking (Fix #3)
-- ALTER TABLE room_members ADD COLUMN client_fingerprint TEXT;
-- CREATE INDEX IF NOT EXISTS idx_members_fingerprint ON room_members(client_fingerprint);

-- ============================================================
-- Table: messages
-- 聊天消息。recalled_at 非空表示已撤回；MVP 硬删除（从 D1 物理删除行）
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,                    -- UUID v4
  room_id             TEXT NOT NULL REFERENCES rooms(id),
  sender_session_id   TEXT NOT NULL,
  encrypted_content   TEXT NOT NULL,                       -- base64(AES-256-GCM(iv+ciphertext+tag))
  message_type        TEXT NOT NULL DEFAULT 'text'
                      CHECK(message_type IN ('text','file_notification','system')),
  device_label        TEXT,
  recalled_at         TEXT,                                -- 撤回时间戳 (MVP: 硬删除，此字段为过渡标记)
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at DESC);

-- Migration: Add TTL and expiry for burn-after-reading messages (Feature #10)
-- ALTER TABLE messages ADD COLUMN ttl_seconds INTEGER DEFAULT NULL;
-- ALTER TABLE messages ADD COLUMN expires_at TEXT;
-- CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);

-- ============================================================
-- Table: file_metadata
-- 文件元数据。实际文件 blob 存在 R2
-- ============================================================
CREATE TABLE IF NOT EXISTS file_metadata (
  id                  TEXT PRIMARY KEY,                    -- UUID v4
  room_id             TEXT NOT NULL REFERENCES rooms(id),
  uploader_session_id TEXT NOT NULL,
  r2_key              TEXT NOT NULL,                       -- R2 对象键 (格式: rooms/{room_code}/{uuid}_{enc_name})
  encrypted_filename  TEXT NOT NULL,                       -- base64(AES-256-GCM(原始文件名))
  encrypted_meta      TEXT,                                -- base64(AES-256-GCM(额外元数据 JSON))，可选
  file_size           INTEGER NOT NULL,                    -- 字节数
  mime_type           TEXT NOT NULL,                       -- MIME 类型
  visibility          TEXT NOT NULL DEFAULT 'private'
                      CHECK(visibility IN ('private','public')),
  expires_at          TEXT NOT NULL,                       -- ISO 8601 过期时间
  recalled_at         TEXT,                                -- 撤回时间戳 (撤回时删除 R2 对象 + 标记)
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_room ON file_metadata(room_id);
CREATE INDEX IF NOT EXISTS idx_files_expires ON file_metadata(expires_at);
CREATE INDEX IF NOT EXISTS idx_files_r2key ON file_metadata(r2_key);

-- Migration: Add file_hash for integrity verification (Feature #8)
-- ALTER TABLE file_metadata ADD COLUMN file_hash TEXT;

-- ============================================================
-- Table: usage_stats
-- 房间 R2 使用量计数器，用于 5GB 限制。在 D1 事务中与上传操作原子更新
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_stats (
  id            TEXT PRIMARY KEY,                          -- UUID v4
  room_id       TEXT NOT NULL UNIQUE REFERENCES rooms(id),
  total_bytes   INTEGER NOT NULL DEFAULT 0,               -- 当前房间在 R2 的总字节数
  file_count    INTEGER NOT NULL DEFAULT 0,               -- 当前活跃文件数
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Table: credential_audit
-- 凭证审计日志：临时凭证和 API Key 的生命周期追踪
-- ============================================================
CREATE TABLE IF NOT EXISTS credential_audit (
  id              TEXT PRIMARY KEY,                        -- UUID v4
  type            TEXT NOT NULL CHECK(type IN ('temp_credential','api_key')),
  code_hash       TEXT,                                    -- SHA-256(temp_code)，仅 temp 类型
  api_key_prefix  TEXT,                                    -- API key 前 8 字符，仅 api_key 类型（用于列表展示）
  created_by      TEXT,                                    -- 创建者 admin username
  used_at         TEXT,                                    -- 使用时间 (temp cred one-time use)
  expires_at      TEXT NOT NULL,                           -- 过期时间
  revoked_at      TEXT,                                    -- 撤销时间
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cred_type ON credential_audit(type);
CREATE INDEX IF NOT EXISTS idx_cred_expires ON credential_audit(expires_at);

-- ============================================================
-- Migration Scripts (idempotent — safe to run multiple times)
-- Run these via `npx wrangler d1 execute filesync-db --file=db/schema.sql`
-- ============================================================

-- Feature #12: Room activity tracking for auto-destroy
-- ALTER TABLE rooms ADD COLUMN last_active_at TEXT;
-- CREATE INDEX IF NOT EXISTS idx_rooms_last_active ON rooms(last_active_at);

-- Fix #3: Client fingerprint for cross-session room membership
-- ALTER TABLE room_members ADD COLUMN client_fingerprint TEXT;
-- CREATE INDEX IF NOT EXISTS idx_members_fingerprint ON room_members(client_fingerprint);

-- Feature #10: Burn-after-reading message TTL
-- ALTER TABLE messages ADD COLUMN ttl_seconds INTEGER DEFAULT NULL;
-- ALTER TABLE messages ADD COLUMN expires_at TEXT;
-- CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);

-- Feature #8: File integrity hash
-- ALTER TABLE file_metadata ADD COLUMN file_hash TEXT;
