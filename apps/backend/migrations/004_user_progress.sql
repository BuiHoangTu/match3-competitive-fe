-- Migration 004: user_progress table
-- Tracks per-user XP and cosmetic preferences.
-- ON DELETE CASCADE ensures rows are automatically removed when the parent
-- users row is hard-deleted (GDPR account deletion). No separate anonymisation
-- step is required — the row carries no PII.

-- Up Migration

CREATE TABLE IF NOT EXISTS user_progress (
  -- Same app account identifier used throughout the system.
  user_id              TEXT        PRIMARY KEY
                                   REFERENCES users(user_id) ON DELETE CASCADE,
  -- Accumulated experience points. Never negative.
  xp                   INTEGER     NOT NULL DEFAULT 0
                                   CHECK (xp >= 0),
  -- ID of the character skin the user has selected (e.g. 'cat', 'dog').
  default_character_id TEXT        NOT NULL DEFAULT 'cat',
  -- Updated whenever xp or default_character_id changes.
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS user_progress;
