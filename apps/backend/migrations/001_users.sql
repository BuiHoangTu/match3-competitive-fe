-- Migration 001: users table
-- Stores authenticated user profiles. user_id is the app account id (string).
-- No email stored — data-minimisation principle (AR-6).
-- deleted_at supports soft-delete for GDPR flows (F-track, T-v0.6-F03).

-- Up Migration

CREATE TABLE IF NOT EXISTS users (
  -- App account id — authoritative identity from the auth layer.
  user_id      TEXT        PRIMARY KEY,
  -- Display name from OAuth provider (e.g. "Jane D."). Not unique.
  display_name TEXT        NOT NULL DEFAULT '',
  -- Avatar URL from OAuth provider. May be empty string if provider does not supply one.
  avatar_url   TEXT        NOT NULL DEFAULT '',
  -- Which OAuth provider authenticated this user (e.g. 'google.com', 'apple.com').
  provider     TEXT        NOT NULL DEFAULT '',
  -- When the row was first created.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set during GDPR account deletion; NULL means the account is active.
  -- Once set, the row is logically deleted and PII fields should be cleared
  -- before this column is populated (F-track handles this).
  deleted_at   TIMESTAMPTZ          DEFAULT NULL
);

-- Index on provider for analytics / admin queries (e.g. "how many Apple sign-ins").
CREATE INDEX IF NOT EXISTS idx_users_provider ON users (provider);

-- Down Migration

DROP INDEX IF EXISTS idx_users_provider;
DROP TABLE IF EXISTS users;
