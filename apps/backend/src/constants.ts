export const BOT_ID = "BOT";
export const BOT_USER_ID = "bot:default";
export const PLAYER_TIME_MS = 5 * 60 * 1000;
export const BOT_WAIT_MS = 5_000;
export const BOT_THINK_MS = 700;
// AR-3 / MR-6: identity-based rejoin (via verified userId) allows a longer
// reconnection window than the old 60 s HMAC token window. Clients can now
// call /matchmaking/resume at any point within 5 minutes of disconnect.
export const REJOIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const IDLE_MATCH_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_SWEEP_INTERVAL_MS = 60_000;
export const ROOM_TOKEN_TTL_MS = 5 * 60 * 1000;

// ─── Auth error codes (T-v0.6-D07) ───────────────────────────────────────────
// Machine-readable codes sent to clients so they can map to UX messages.
// Also re-exported via shared/src/protocol.d.ts for the frontend.

export const AUTH_MISSING_TOKEN = "AUTH_MISSING_TOKEN" as const;
export const AUTH_INVALID_TOKEN = "AUTH_INVALID_TOKEN" as const;
export const AUTH_EXPIRED = "AUTH_EXPIRED" as const;

export type AuthErrorCode =
  | typeof AUTH_MISSING_TOKEN
  | typeof AUTH_INVALID_TOKEN
  | typeof AUTH_EXPIRED;
