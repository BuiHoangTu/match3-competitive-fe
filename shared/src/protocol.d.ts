/**
 * Shared Socket.IO event types used by both the backend (be/) and the
 * frontend network layer (fe/src/net/). Keeping them here ensures the
 * wire format stays in sync across both packages.
 */

/** A player's swap move — sent by client and relayed by server. */
export interface Move {
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  timestamp: number;
}

/** Payload of the server → client "match_found" event. */
export interface MatchFoundPayload {
  roomId: string;
  seed: number;
  opponentId: string;
  myPlayerId: string;
  firstPlayerId: string;
  mode: string;
  /** HMAC-signed token; store in sessionStorage for reconnect after network drop. */
  rejoinToken: string;
}

/** Payload of the server → client "turn_changed" event. */
export interface TurnChangedPayload {
  activePlayerId: string;
  /** Remaining time in ms, keyed by socket ID. */
  times: Record<string, number>;
}

/** Payload of the server → client "game_over" event. */
export interface GameOverPayload {
  /** Socket ID of the player whose clock ran out, if applicable. */
  loserTimeUp?: string;
  /** Final remaining times in ms at game end, keyed by socket ID. */
  times?: Record<string, number>;
}

/**
 * Payload of the server → client "rejoin_ok" event.
 * Sent after a successful reconnection — the client replays moves to rebuild
 * board state and resumes the game from where it left off.
 */
export interface RejoinOkPayload {
  roomId: string;
  seed: number;
  /** Full move history with playerIds remapped to current socket IDs. */
  moves: Move[];
  myPlayerId: string;
  activePlayerId: string | null;
  times: Record<string, number>;
  opponentId: string | null;
  /** Fresh token to replace the one stored in sessionStorage. */
  rejoinToken: string;
}

/** Emitted to the remaining player while their opponent is reconnecting. */
export interface OpponentReconnectingPayload {
  /** How long the server will wait before ending the game (ms). */
  timeoutMs: number;
}

// ─── Auth error codes (T-v0.6-D07) ───────────────────────────────────────────
// Machine-readable codes the client maps to UX messages.
// "AUTH_MISSING_TOKEN" — handshake carried no token at all.
// "AUTH_INVALID_TOKEN" — token present but signature / claims failed verification.
// "AUTH_EXPIRED"       — token signature valid but exp claim has passed.

export type AuthErrorCode =
  | "AUTH_MISSING_TOKEN"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_EXPIRED";

/**
 * Emitted by the server when a socket's token is rejected mid-session.
 * The socket is disconnected immediately after emission.
 * Clients should request a fresh token and reconnect.
 */
export interface AuthTokenRejectedPayload {
  code: AuthErrorCode;
  reason: string;
}
