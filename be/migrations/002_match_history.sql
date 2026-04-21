-- Migration 002: match_history table
-- Records every completed match. Player slots use TEXT (not FK) so that
-- GDPR tombstoning can replace user_id values with an opaque sentinel
-- ('TOMBSTONE_<hash>') without creating orphan-FK violations.

-- Up Migration

CREATE TABLE IF NOT EXISTS match_history (
  -- Server-generated UUID, created at match_start (RoomManager).
  match_id    TEXT        PRIMARY KEY,
  -- Firebase UIDs for each player slot. Set to a tombstone after account deletion.
  -- Nullable to allow anonymous / bot opponents (p2_user_id = NULL for a bot match
  -- where we do not persist the bot identity).
  p1_user_id  TEXT,
  p2_user_id  TEXT,
  -- Scores as accumulated during the match.
  p1_score    INTEGER     NOT NULL DEFAULT 0,
  p2_score    INTEGER     NOT NULL DEFAULT 0,
  -- Outcome must be one of the three defined values; enforced by CHECK.
  outcome     TEXT        NOT NULL CHECK (outcome IN ('P1_WIN', 'P2_WIN', 'DRAW')),
  -- Wall-clock duration of the match in milliseconds (ended_at - started_at on server).
  duration_ms INTEGER     NOT NULL DEFAULT 0,
  -- When the match finished (server time).
  ended_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the most common query: "give me all matches for this user".
-- Covers both player slots with two single-column indexes.
CREATE INDEX IF NOT EXISTS idx_match_history_p1 ON match_history (p1_user_id);
CREATE INDEX IF NOT EXISTS idx_match_history_p2 ON match_history (p2_user_id);

-- Index for ordering results by newest first (default sort for the history endpoint).
CREATE INDEX IF NOT EXISTS idx_match_history_ended_at ON match_history (ended_at DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_match_history_ended_at;
DROP INDEX IF EXISTS idx_match_history_p2;
DROP INDEX IF EXISTS idx_match_history_p1;
DROP TABLE IF EXISTS match_history;
