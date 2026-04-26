/**
 * GameBridge — game-side singleton for the shell↔game message transport.
 *
 * Direction: this module handles both incoming (shell → game) and outgoing
 * (game → shell) messages. It is transport-agnostic: the actual delivery
 * mechanism (window.postMessage for web/iframe, or window.Match3Bridge for
 * Flutter JavaScriptChannel) is detected and abstracted at init time.
 *
 * Usage:
 *   import { GameBridge } from './bridge/GameBridge.js';
 *   GameBridge.onStartMatch(({ roomToken, expiresAt }) => { ... });
 *   GameBridge.emitMatchEnded('W', { self: 120, opponent: 80 });
 *
 * Transport selection (in priority order):
 *   1. window.Match3Bridge (Flutter WebView JavaScriptChannel)
 *   2. window.parent.postMessage (iframe / Flutter Web)
 *
 * @see specification/system-design.md § 2.2, § 2.3
 * @see shared/src/bridge.d.ts  — message type contracts
 * @see shared/src/bridge.ts    — BridgeMessageType constants
 */

import {
  BridgeMessageType,
  type StartMatchMessage,
  type AppLifecycleMessage,
  type MatchEndedMessage,
  type ShellToGameMessage,
} from "@match3/shared-js/bridge.js";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type StartMatchHandler = (payload: StartMatchMessage["payload"]) => void;
type AppLifecycleHandler = (payload: AppLifecycleMessage["payload"]) => void;
type RequestLeaveMatchHandler = () => void;

let _startMatchHandlers: StartMatchHandler[] = [];
let _appLifecycleHandlers: AppLifecycleHandler[] = [];
let _requestLeaveMatchHandlers: RequestLeaveMatchHandler[] = [];

/** Whether the bridge has been initialised (init() called). */
let _initialised = false;

// ---------------------------------------------------------------------------
// Transport detection helpers
// ---------------------------------------------------------------------------

/** Cast window to an index-accessible record without TS overlap errors. */
function _win(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

/**
 * Returns true if the Flutter JavaScriptChannel "Match3Bridge" is present.
 * Channel name is "Match3Bridge" as agreed in T-v0.6-A08b.
 */
function _hasFlutterChannel(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof _win()["Match3Bridge"] === "object" &&
    _win()["Match3Bridge"] !== null
  );
}

// ---------------------------------------------------------------------------
// Message dispatch (shell → game)
// ---------------------------------------------------------------------------

function _dispatch(raw: unknown): void {
  if (typeof raw !== "string") return;

  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.error("[GameBridge] malformed message — not valid JSON:", raw);
    return;
  }

  if (
    typeof msg !== "object" ||
    msg === null ||
    typeof (msg as Record<string, unknown>)["type"] !== "string"
  ) {
    console.error("[GameBridge] malformed message — missing .type:", msg);
    return;
  }

  const typed = msg as ShellToGameMessage;

  switch (typed.type) {
    case BridgeMessageType.START_MATCH: {
      // After this case, TypeScript narrows typed to StartMatchMessage.
      const startMsg = typed as StartMatchMessage;
      for (const h of _startMatchHandlers) h(startMsg.payload);
      break;
    }
    case BridgeMessageType.APP_LIFECYCLE: {
      const lcMsg = typed as AppLifecycleMessage;
      for (const h of _appLifecycleHandlers) h(lcMsg.payload);
      break;
    }
    case BridgeMessageType.REQUEST_LEAVE_MATCH: {
      for (const h of _requestLeaveMatchHandlers) h();
      break;
    }
    default: {
      console.warn(
        "[GameBridge] unknown message type:",
        (typed as unknown as { type: string }).type
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Outgoing (game → shell)
// ---------------------------------------------------------------------------

/**
 * Sends a JSON-serialised message to the shell via the active transport.
 * No-ops silently if running outside a shell context (standalone web dev mode
 * without a parent frame or Flutter channel).
 */
function _send(msg: object): void {
  const json = JSON.stringify(msg);

  if (typeof window === "undefined") {
    // Node / test environment without a window stub — skip.
    return;
  }

  if (_hasFlutterChannel()) {
    // Flutter WebView JavaScriptChannel — postMessage on the channel object.
    (_win()["Match3Bridge"] as { postMessage: (s: string) => void }).postMessage(
      json
    );
    return;
  }

  // iframe / Flutter Web — use window.parent.postMessage.
  // Falls back to window.postMessage if there is no parent (standalone mode).
  // The Dart side filters incoming messages by `origin: "match3"`, so wrap
  // outbound traffic in that envelope (matches the inbound filter at line ~184).
  const target = window !== window.parent ? window.parent : window;
  if (target !== window) {
    target.postMessage({ origin: "match3", payload: json }, "*");
  } else {
    target.postMessage(json, "*");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const GameBridge = {
  /**
   * Initialise the bridge transport listener. Must be called once, early in
   * the game bootstrap (before SyncClient.connect() is called). Subsequent
   * calls are no-ops.
   */
  init(): void {
    if (_initialised) return;
    _initialised = true;

    if (typeof window === "undefined") {
      // Node / test environment — transport is not wired; handlers still work
      // when called via _testInjectMessage in tests.
      return;
    }

    if (_hasFlutterChannel()) {
      // Flutter WebView: the Dart side delivers inbound messages by calling
      //   controller.runJavaScript('window.Match3BridgeIncoming.onMessage("…")');
      // We expose a global hook so Dart can drive _dispatch directly.
      _win()["Match3BridgeIncoming"] = { onMessage: _dispatch };
    } else {
      // iframe / Flutter Web transport — listen for postMessage events.
      window.addEventListener("message", (evt: MessageEvent) => {
        // Filter: accept plain JSON strings OR envelope objects tagged
        // origin="match3" to avoid swallowing unrelated postMessage traffic.
        if (typeof evt.data === "string") {
          _dispatch(evt.data);
        } else if (
          typeof evt.data === "object" &&
          evt.data !== null &&
          (evt.data as Record<string, unknown>)["origin"] === "match3"
        ) {
          const inner = (evt.data as Record<string, unknown>)["payload"];
          if (typeof inner === "string") _dispatch(inner);
        }
      });
    }
  },

  // -------------------------------------------------------------------------
  // Shell → game: register handlers
  // -------------------------------------------------------------------------

  /**
   * Register a handler that fires when the shell sends startMatch.
   * Multiple handlers may be registered; all are called in registration order.
   */
  onStartMatch(handler: StartMatchHandler): void {
    _startMatchHandlers.push(handler);
  },

  /** Register a handler for appLifecycle messages. */
  onAppLifecycle(handler: AppLifecycleHandler): void {
    _appLifecycleHandlers.push(handler);
  },

  /** Register a handler for requestLeaveMatch messages. */
  onRequestLeaveMatch(handler: RequestLeaveMatchHandler): void {
    _requestLeaveMatchHandlers.push(handler);
  },

  // -------------------------------------------------------------------------
  // Game → shell: emit helpers
  // -------------------------------------------------------------------------

  /**
   * game → shell
   * Emits the `ready` signal. Call exactly once after Phaser finishes its
   * initial scene setup. The shell will not send startMatch before this.
   */
  emitReady(): void {
    _send({
      type: BridgeMessageType.READY,
      version: "1",
      payload: {},
    });
  },

  /**
   * game → shell
   * Emits `matchEnded` with the local player's outcome and final scores.
   * Call exactly once per match when the match concludes. The caller (GameScene)
   * is responsible for preventing double emission via the game_over state guard.
   */
  emitMatchEnded(
    outcome: MatchEndedMessage["payload"]["outcome"],
    scores: MatchEndedMessage["payload"]["scores"]
  ): void {
    _send({
      type: BridgeMessageType.MATCH_ENDED,
      version: "1",
      payload: { outcome, scores },
    });
  },

  /**
   * game → shell
   * Emits `authTokenRejected`. Call when the server returns an auth rejection.
   * Disconnect the socket before calling this; do not auto-retry.
   * The shell is responsible for refresh + re-call to startMatch.
   */
  emitAuthTokenRejected(): void {
    _send({
      type: BridgeMessageType.AUTH_TOKEN_REJECTED,
      version: "1",
      payload: {},
    });
  },

  // -------------------------------------------------------------------------
  // Test helpers — not for production use
  // -------------------------------------------------------------------------

  /**
   * Inject an incoming shell→game message directly, bypassing the transport.
   * Intended for Vitest unit tests only.
   * @internal
   */
  _testInjectMessage(raw: string): void {
    _dispatch(raw);
  },

  /** Reset all handler lists and initialised flag. For use in tests only. */
  _testReset(): void {
    _startMatchHandlers = [];
    _appLifecycleHandlers = [];
    _requestLeaveMatchHandlers = [];
    _initialised = false;
  },
} as const;
