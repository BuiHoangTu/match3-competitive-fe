export const BOT_ID = "BOT";
export const PLAYER_TIME_MS = 5 * 60 * 1000;
export const BOT_WAIT_MS = 5_000;
export const BOT_THINK_MS = 700;
export const REJOIN_WINDOW_MS = 60_000;
export const IDLE_MATCH_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_SWEEP_INTERVAL_MS = 60_000;

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
