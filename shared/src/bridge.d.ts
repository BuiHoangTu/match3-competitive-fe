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
// Message-name constants — keep in sync with shell/lib/bridge/bridge_messages.dart
// and shared/src/__tests__/bridge-messages.txt
// ---------------------------------------------------------------------------

/** All bridge message type names as a const object. */
export const BridgeMessageType = {
  // shell → game
  SET_AUTH_TOKEN: "setAuthToken",
  APP_LIFECYCLE: "appLifecycle",
  REQUEST_LEAVE_MATCH: "requestLeaveMatch",
  // game → shell
  READY: "ready",
  AUTH_TOKEN_REJECTED: "authTokenRejected",
  MATCH_ENDED: "matchEnded",
} as const;

/** Union of all valid bridge message type name strings. */
export type BridgeMessageTypeName =
  (typeof BridgeMessageType)[keyof typeof BridgeMessageType];

// ---------------------------------------------------------------------------
// Shell → game message interfaces
// ---------------------------------------------------------------------------

/**
 * shell → game
 * Called on init and on each token refresh.
 * The game view stores the token and attaches it to the next Socket.IO
 * handshake. Never logs the token value.
 */
export interface SetAuthTokenMessage {
  type: typeof BridgeMessageType.SET_AUTH_TOKEN;
  version: "1";
  payload: {
    /** Firebase Auth JWT. */
    token: string;
    /** Stable user identifier from the identity provider. */
    userId: string;
    /** Token expiry as a Unix timestamp in seconds. */
    expiresAt: number;
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
 * `setAuthToken` call. The shell must not send `setAuthToken` before this
 * event is received.
 */
export interface ReadyMessage {
  type: typeof BridgeMessageType.READY;
  version: "1";
  payload: Record<string, never>;
}

/**
 * game → shell
 * The Socket.IO server rejected the auth token (e.g. expired between
 * refreshes). The shell must trigger a token refresh and call `setAuthToken`
 * again with the new token.
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
  | SetAuthTokenMessage
  | AppLifecycleMessage
  | RequestLeaveMatchMessage;

/** All game → shell messages. */
export type GameToShellMessage =
  | ReadyMessage
  | AuthTokenRejectedMessage
  | MatchEndedMessage;

/** Full closed union of every bridge message in both directions. */
export type BridgeMessage = ShellToGameMessage | GameToShellMessage;
