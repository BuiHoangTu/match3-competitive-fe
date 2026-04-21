/**
 * Shell↔game bridge message runtime exports.
 *
 * This file exports the runtime constant BridgeMessageType. Type declarations
 * live in bridge.d.ts so that .d.ts files can declare types without runtime code.
 *
 * Both are exported from this module at runtime.
 */

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

// Re-export all types from bridge.d.ts
export type {
  SetAuthTokenMessage,
  AppLifecycleMessage,
  RequestLeaveMatchMessage,
  ReadyMessage,
  AuthTokenRejectedMessage,
  MatchEndedMessage,
  ShellToGameMessage,
  GameToShellMessage,
  BridgeMessage,
} from "./bridge.d.js";
