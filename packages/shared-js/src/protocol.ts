/**
 * Shared Socket.IO event types used by both the backend (be/) and the
 * frontend network layer (fe/src/net/). Keeping them here ensures the
 * wire format stays in sync across both packages.
 */

/**
 * A player's swap move.
 *
 * Client → server submissions use client-local timestamp values only for
 * diagnostics. Server → client relays set `timestamp` to the server receipt
 * time, so clients can reconcile the chess clock against when the move
 * actually reached the authoritative process.
 */
export interface Move {
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  timestamp: number;
}

// ─── v0.9 Flutter-native board-delta protocol ───────────────────────────────

/** Flat row-major board table. Index = row * agreedBoardWidth + col. */
export interface FlatBoardWire {
  boardVersion: number;
  board: number[];
}

/** A generated tile consumed after gravity in deterministic refill order. */
export interface GeneratedTileWire {
  row: number;
  col: number;
  tile: number;
}

/** Hot-path move-resolution packet for the Flutter-native online client. */
export interface BoardDeltaMoveResolvedPayload {
  boardVersion: number;
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  serverReceivedAt?: number;
  steps: ResolvedStepWire[];
  generatedTiles: GeneratedTileWire[];
  playerStates?: Record<string, PlayerState>;
  boardHash?: string;
}

/** Start/rejoin snapshot for the Flutter-native online client. */
export interface BoardDeltaMatchFoundPayload extends FlatBoardWire {
  roomId: string;
  opponentId: string;
  myPlayerId: string;
  activePlayerId: string | null;
  mode: "turn_based";
  playerStates: Record<string, PlayerState>;
}

/** Full-board replacement when the settled board has no legal moves. */
export interface BoardReplacedPayload extends FlatBoardWire {
  reason: "no_legal_moves";
  playerStates?: Record<string, PlayerState>;
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
  /**
   * Per-player stats AFTER this cascade step's effects (heal/exp/attack/...)
   * have been applied. Lets the client animate HUD bars in lockstep with each
   * cascade flash rather than waiting for the whole chain to settle. Optional
   * during the migration window — older servers / clients don't emit this.
   */
  playerStatesAfter?: Record<string, PlayerState>;
}

/**
 * Internal/server-authoritative resolve payload. During the Flutter-native
 * migration, SocketBridge projects this into a score-free board-delta
 * `move_resolved` hot-path packet for online clients.
 */
export interface MoveResolvedPayload {
  /** The player who made the move. */
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  /** Server wall-clock ms when the move event reached the backend. */
  serverReceivedAt?: number;
  /** Monotonic flat-board version after this resolution. */
  boardVersion?: number;
  /** Cascade-by-cascade animation data. Non-empty — 0-match swaps are rejected. */
  steps: ResolvedStepWire[];
  /** Generated replacement tiles in deterministic refill order. */
  generatedTiles?: GeneratedTileWire[];
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
  /** pve only: legacy seed for local replay. Not sent for turn_based rooms. */
  seed?: number;
  opponentId: string;
  myPlayerId: string;
  firstPlayerId: string;
  activePlayerId?: string | null;
  mode: string;
  /** HMAC-signed token; store in sessionStorage for reconnect after network drop. */
  rejoinToken: string;
  /** turn_based v0.9: flat row-major board snapshot using the agreed board size. */
  boardVersion?: number;
  board?: number[];
  /**
   * pve only: the move log so the client can replay on reconnect. Empty on
   * first connect. Not present for turn_based (server validates privately;
   * clients animate accepted moves locally).
   */
  moves?: Move[];
  /**
   * Initial per-player stats so the HUD can render full HP/Stamina/Mana/Lv
   * bars at match start without waiting for the first turn_changed.
   */
  playerStates?: Record<string, PlayerState>;
}

// ─── Per-player state (replaces the flat `times` field) ─────────────────────

/**
 * Rich per-player state broadcast on every turn change and game-over event.
 *
 * Mirrors `PlayerStats` in `engine/PlayerStats.ts` (the canonical engine
 * shape). All fields travel on the wire so clients can render full HP /
 * stamina / mana / level / exp bars without inferring from deltas.
 *
 * - `stamina` — remaining turn time in ms. Ticks down while the player is
 *   active; match ends when it reaches 0.
 * - `health` — current HP. Match also ends when it reaches 0.
 * - `mana` — current mana (gated abilities, future use).
 * - `lv`, `exp`, `expToNext` — leveling progression. `expToNext = 100 * lv`.
 * - `atk` — current per-attack-tile damage.
 * - `maxHealth` / `maxMana` / `maxStamina` — current caps (maxHealth grows
 *   on level-up; the others are static today but exposed for symmetry).
 */
export interface PlayerState {
  stamina: number;
  maxStamina: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  lv: number;
  exp: number;
  expToNext: number;
  atk: number;
}

/** Payload of the server → client "turn_changed" event. */
export interface TurnChangedPayload {
  activePlayerId: string;
  /** Server wall-clock ms for the move that caused this turn change. */
  serverReceivedAt?: number;
  /**
   * Per-player state after this turn change. The judge (turn_based) emits the
   * full shape; the legacy pve relay path emits only the stamina-bearing
   * `times` field below — clients must guard for undefined.
   */
  playerStates?: Record<string, PlayerState>;
  /**
   * Legacy stamina-only map used by the pve relay path (`{ [socketId]: ms }`).
   * Kept for backward compatibility; new code should prefer `playerStates`.
   */
  times?: Record<string, number>;
}

/** Why the losing player lost the match. */
export type LoseReason = "time" | "hp";

/** Payload of the server → client "game_over" event. */
export interface GameOverPayload {
  /**
   * Socket ID of the losing player (covers both stamina-out and HP-out
   * cases). Pair with `loserReason` to know which condition triggered.
   * Optional during the migration window — once all emitters set it, drop
   * the `?`.
   */
  loserId?: string;
  /**
   * Why the loser lost. `"time"` ↔ stamina hit zero, `"hp"` ↔ health hit
   * zero (player-stats system).
   */
  loserReason?: LoseReason;
  /** Per-player state at game end. Replaces the old `times` field. */
  playerStates?: Record<string, PlayerState>;
}

/**
 * Payload of the server → client "rejoin_ok" event.
 *
 * For turn_based rooms: contains a one-shot flat board snapshot so the client
 * can restore state instantly without replaying move history.
 *
 * For pve rooms: retains the legacy seed + moves[] shape (unchanged).
 */
export interface RejoinOkPayload {
  roomId: string;
  /**
   * Kept for pve rooms and backward-compat. Not sent for turn_based rooms.
   */
  seed?: number;
  /**
   * pve rooms only: full move history with playerIds remapped to current socket
   * IDs. Not present for turn_based rooms (use board snapshot instead).
   */
  moves?: Move[];
  myPlayerId: string;
  activePlayerId: string | null;
  /** Per-player state at the moment of rejoin. Replaces the old `times` field. */
  playerStates: Record<string, PlayerState>;
  opponentId: string | null;
  /** Fresh token to replace the one stored in sessionStorage. */
  rejoinToken: string;
  /** turn_based v0.9: flat row-major board snapshot using the agreed board size. */
  boardVersion?: number;
  board?: number[];
  /**
   * turn_based only: per-player score totals at the moment of rejoin.
   */
  scores?: { [playerId: string]: number };
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
