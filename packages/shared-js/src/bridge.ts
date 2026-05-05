/**
 * Shell↔game bridge message runtime exports.
 *
 * This file exports the runtime constant BridgeMessageType. Type declarations
 * live in bridge-types.ts (was bridge.d.ts before Phase C).
 *
 * Both are exported from this module at runtime.
 */

/** All bridge message type names as a const object. */
export const BridgeMessageType = {
  // shell → game
  START_MATCH: "startMatch",
  START_LOCAL_MATCH: "startLocalMatch",
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

// Re-export all types from bridge-types
export type {
  StartMatchMessage,
  StartLocalMatchMessage,
  SoloSnapshotPayload,
  AppLifecycleMessage,
  RequestLeaveMatchMessage,
  ReadyMessage,
  AuthTokenRejectedMessage,
  MatchEndedMessage,
  ShellToGameMessage,
  GameToShellMessage,
  BridgeMessage,
} from "./bridge-types.js";
