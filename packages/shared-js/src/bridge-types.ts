/**
 * Shell↔game bridge message contract.
 *
 * This file is the single source of truth for the typed message protocol that
 * flows between the Flutter shell (Dart) and the Phaser game client
 * (TypeScript). The Dart mirror lives at shell/lib/bridge/bridge_messages.dart.
 *
 * Naming convention:
 *   - Shell-initiated messages use the prefix pattern (shell → game).
 *   - Game-initiated messages use the prefix pattern (game → shell).
 *
 * Every message carries a `version` field (currently "1") so receivers can
 * detect forward-incompatible changes and drop or adapt gracefully.
 *
 * Explicitly NOT on the bridge: moves, clock ticks, opponent state, cascade
 * events, scores during play, seed, room id. All of that stays inside the game
 * view's Socket.IO channel.
 *
 * @see specification/system-design.md § 2.2
 */

// ---------------------------------------------------------------------------
// Type definitions only. Runtime BridgeMessageType const lives in bridge.ts.
// Keep in sync with apps/frontend/lib/bridge/bridge_messages.dart
// and packages/shared-js/src/__tests__/bridge-messages.txt
// ---------------------------------------------------------------------------

import type { BridgeMessageType } from "./bridge.js";

// ---------------------------------------------------------------------------
// Shell → game message interfaces
// ---------------------------------------------------------------------------

/**
 * shell → game
 * Sent by the shell after receiving a room-scoped JWT from the matchmaking
 * endpoint. The game view stores the token and uses it as the Socket.IO
 * handshake auth credential. Called exactly once per match; re-sent on token
 * refresh (authTokenRejected → shell re-requests → startMatch again).
 * Never logs the roomToken value (log only expiresAt for correlation).
 */
export interface StartMatchMessage {
  type: typeof BridgeMessageType.START_MATCH;
  version: "1";
  payload: {
    /**
     * Server-issued room-scoped JWT. Carries {roomId, userId, slot, seed, exp}
     * as claims. The game view treats it as opaque and attaches it verbatim to
     * the Socket.IO handshake auth object.
     */
    roomToken: string;
    /** Token expiry as a Unix timestamp in seconds. */
    expiresAt: number;
  };
}

/**
 * Wire-format snapshot of solo-mode game state, persisted client-side in
 * localStorage and replayed back into the game view via [StartLocalMatchMessage]
 * on auto-resume.
 *
 * Mirrors `SoloSnapshot` in
 * packages/game-view/src/game/GameLoopController.ts. The `version` field guards
 * against forward-incompatible layout changes — receivers discard mismatched
 * snapshots and start fresh.
 */
export interface SoloSnapshotPayload {
  version: 1;
  /** Symbol grid: rows × cols of integers in the engine's symbol range. */
  board: number[][];
  /** Mulberry32 RNG state at the moment of save. */
  rngState: number;
  /** Local player's accumulated score at the moment of save. */
  score: number;
  /** Tile-ID counter at save time. Restored to avoid sprite-id collisions. */
  nextTileId: number;
}

/**
 * shell → game
 * Sent by the shell to start a pure client-side solo match. Solo no longer
 * goes through the matchmaking server — the shell generates the seed locally
 * and the game view persists state in localStorage for reload-resume.
 *
 * If [savedState] is non-null the game view restores the controller from the
 * snapshot rather than seeding fresh; the [seed] is then unused. If null, the
 * game view starts a new match from [seed].
 */
export interface StartLocalMatchMessage {
  type: typeof BridgeMessageType.START_LOCAL_MATCH;
  version: "1";
  payload: {
    /** CSPRNG-generated seed for a fresh solo match. Ignored if [savedState] is non-null. */
    seed: number;
    /** Previously-persisted controller state, or null to start fresh. */
    savedState: SoloSnapshotPayload | null;
    /** Owning user's ID — used to key the localStorage save slot. */
    userId: string;
    /** Character selected for this solo match. */
    characterId: string;
  };
}

/**
 * shell → game
 * Signals a platform lifecycle transition so the game view can pause animations
 * and timers during background, and trigger a reconnect probe on resume.
 */
export interface AppLifecycleMessage {
  type: typeof BridgeMessageType.APP_LIFECYCLE;
  version: "1";
  payload: {
    state: "foreground" | "background" | "pause" | "resume";
  };
}

/**
 * shell → game
 * The user tapped "leave match" in the shell UI.
 * The game view must gracefully end the current match before the shell
 * navigates away.
 */
export interface RequestLeaveMatchMessage {
  type: typeof BridgeMessageType.REQUEST_LEAVE_MATCH;
  version: "1";
  payload: Record<string, never>;
}

// ---------------------------------------------------------------------------
// Game → shell message interfaces
// ---------------------------------------------------------------------------

/**
 * game → shell
 * The game view has loaded Phaser and is ready to receive the first
 * `startMatch` call. The shell must not send `startMatch` before this
 * event is received.
 */
export interface ReadyMessage {
  type: typeof BridgeMessageType.READY;
  version: "1";
  payload: Record<string, never>;
}

/**
 * game → shell
 * The Socket.IO server rejected the room token (e.g. expired mid-match).
 * The shell must request a fresh room token from the matchmaking endpoint's
 * rejoin path and call `startMatch` again with the new token.
 */
export interface AuthTokenRejectedMessage {
  type: typeof BridgeMessageType.AUTH_TOKEN_REJECTED;
  version: "1";
  payload: Record<string, never>;
}

/**
 * game → shell
 * A match has concluded. The shell should show the result screen using the
 * native Widget layer and offer a "play again" button.
 */
export interface MatchEndedMessage {
  type: typeof BridgeMessageType.MATCH_ENDED;
  version: "1";
  payload: {
    /** Match outcome from the local player's perspective. */
    outcome: "W" | "L" | "D";
    scores: {
      /** Local player's final score. */
      self: number;
      /** Opponent's final score. */
      opponent: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Discriminated union of all bridge messages
// ---------------------------------------------------------------------------

/** All shell → game messages. */
export type ShellToGameMessage =
  | StartMatchMessage
  | StartLocalMatchMessage
  | AppLifecycleMessage
  | RequestLeaveMatchMessage;

/** All game → shell messages. */
export type GameToShellMessage =
  | ReadyMessage
  | AuthTokenRejectedMessage
  | MatchEndedMessage;

/** Full closed union of every bridge message in both directions. */
export type BridgeMessage = ShellToGameMessage | GameToShellMessage;
