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

// ─── Server-authoritative PvP types ──────────────────────────────────────────

/**
 * Wire-safe form of a single cascade step from resolveBoardAnimated.
 * All fields are plain numbers/arrays — safe to JSON-serialise over Socket.IO.
 */
export interface ResolvedStepWire {
  /** Cells cleared in this cascade step: [[row, col], ...] */
  matchedCells: [number, number][];
  /** Tiles that fell due to gravity: { col, fromRow, toRow } */
  movements: Array<{ col: number; fromRow: number; toRow: number }>;
  /** Positions that received new tiles: { row, col } */
  newTilePositions: Array<{ row: number; col: number }>;
  /** Grid state after gravity (before refill). */
  afterGravity: number[][];
  /** Grid state after refill — the authoritative snapshot for this cascade. */
  afterRefill: number[][];
}

/**
 * Emitted to BOTH sockets in a turn_based room after a valid move resolves.
 * Clients use `steps` to drive animations and `finalGrid` to sync board truth.
 */
export interface MoveResolvedPayload {
  /** The player who made the move. */
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  /** Cascade-by-cascade animation data. Non-empty — 0-match swaps are rejected. */
  steps: ResolvedStepWire[];
  /** Final board after all cascades have settled. Authoritative truth. */
  finalGrid: number[][];
  /** RNG state after the resolution — used for snapshot rejoin. */
  rngState: number;
  /** Score delta for this move (added to playerId's running total). */
  pointsEarned: number;
  /** Updated per-player running totals after this move. */
  scores: { [playerId: string]: number };
}

/**
 * Emitted ONLY to the offending socket when a move is rejected.
 */
export interface MoveRejectedPayload {
  reason: "no_match" | "not_your_turn" | "out_of_bounds" | "non_adjacent" | string;
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
  /**
   * turn_based only: authoritative initial board grid.
   * Clients should initialise GameLoopController from this snapshot rather than
   * seeding locally, for symmetry with the rejoin path.
   */
  boardGrid?: number[][];
  /**
   * turn_based only: RNG state at match start (equals originalSeed initially).
   * Used by the client to stash for diagnostics; server drives all resolutions.
   */
  rngState?: number;
  /**
   * turn_based only: the immutable seed used to generate the initial board.
   * Included for debug/replay purposes.
   */
  originalSeed?: number;
  /**
   * pve only: the move log so the client can replay on reconnect. Empty on
   * first connect. Not present for turn_based (server drives resolution
   * authoritatively via move_resolved events).
   */
  moves?: Move[];
}

// ─── Per-player state (replaces the flat `times` field) ─────────────────────

/**
 * Rich per-player state broadcast on every turn change and game-over event.
 *
 * - `stamina` — remaining turn time in ms (was `times[playerId]`). Ticks down
 *   while the player is active; match ends when it reaches 0.
 * - `health` / `mana` — placeholder fields, defaulted to 100. The server seeds
 *   them but does not mutate them; clients may display them for future use.
 */
export interface PlayerState {
  stamina: number;
  health: number;
  mana: number;
}

/** Payload of the server → client "turn_changed" event. */
export interface TurnChangedPayload {
  activePlayerId: string;
  /** Per-player state after this turn change. Replaces the old `times` field. */
  playerStates: Record<string, PlayerState>;
}

/** Payload of the server → client "game_over" event. */
export interface GameOverPayload {
  /** Socket ID of the player whose clock ran out, if applicable. */
  loserTimeUp?: string;
  /** Per-player state at game end. Replaces the old `times` field. */
  playerStates?: Record<string, PlayerState>;
}

/**
 * Payload of the server → client "rejoin_ok" event.
 *
 * For turn_based rooms: contains a one-shot snapshot (boardGrid + rngState)
 * so the client can restore state instantly without replaying move history.
 *
 * For pve rooms: retains the legacy seed + moves[] shape (unchanged).
 */
export interface RejoinOkPayload {
  roomId: string;
  /**
   * Kept for pve rooms and backward-compat. For turn_based, use boardGrid +
   * rngState from the snapshot fields instead.
   */
  seed: number;
  /**
   * pve rooms only: full move history with playerIds remapped to current socket
   * IDs. Not present for turn_based rooms (use boardGrid snapshot instead).
   */
  moves?: Move[];
  myPlayerId: string;
  activePlayerId: string | null;
  /** Per-player state at the moment of rejoin. Replaces the old `times` field. */
  playerStates: Record<string, PlayerState>;
  opponentId: string | null;
  /** Fresh token to replace the one stored in sessionStorage. */
  rejoinToken: string;
  /**
   * turn_based only: authoritative board state at the moment of rejoin.
   * Client renders from this snapshot; no move-replay needed.
   */
  boardGrid?: number[][];
  /**
   * turn_based only: RNG state at the moment of rejoin.
   * The next move's resolution will advance from this state.
   */
  rngState?: number;
  /**
   * turn_based only: per-player score totals at the moment of rejoin.
   */
  scores?: { [playerId: string]: number };
  /**
   * turn_based only: the original seed used to generate the board.
   * Included for diagnostics/replay — not needed for state reconstruction.
   */
  originalSeed?: number;
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
