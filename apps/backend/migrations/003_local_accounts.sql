-- T-Local-01 · local_accounts table for username/password auth.
--
-- Coexists with the existing users table. local_accounts.user_id is the same
-- string used everywhere else (matchmaking, match_history, rejoin). Unique on
-- username; email is NOT unique (we don't verify it — see auth-design.md).

CREATE TABLE IF NOT EXISTS local_accounts (
    user_id        TEXT PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    email          TEXT,
    password_hash  BYTEA NOT NULL,
    salt           BYTEA NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_accounts_username_idx
    ON local_accounts (username);
