/**
 * T-v0.6-A08b · Mobile JS-side bridge adapter
 *
 * This module is the JavaScript counterpart of `shell/lib/bridge/bridge_mobile.dart`.
 * It wires the Flutter `JavaScriptChannel` named `Match3Bridge` into the
 * `GameBridge` singleton so messages flow correctly in both directions under
 * Flutter WebView (iOS / Android).
 *
 * Direction:
 *   shell → game:
 *     Dart calls `window.Match3BridgeIncoming.onMessage(json)` via
 *     `WebViewController.runJavaScript(...)`. GameBridge.init() exposes this
 *     hook automatically when it detects `window.Match3Bridge` is present.
 *     No additional wiring is needed here for the inbound path.
 *
 *   game → shell:
 *     `GameBridge._send()` already dispatches via `window.Match3Bridge.postMessage(json)`
 *     when the channel is detected. No additional wiring needed for outbound.
 *
 * Usage: import this module once, early in the game bootstrap (e.g. main.ts),
 * before calling `GameBridge.init()`. It is a no-op when the Flutter channel
 * is absent (e.g. running standalone in a browser).
 *
 * @see shell/lib/bridge/bridge_mobile.dart  — Dart counterpart
 * @see fe/src/bridge/GameBridge.ts           — singleton transport
 */

// This module intentionally has no imports from GameBridge to avoid circular
// dependencies. The Flutter channel detection and dispatch hook are both
// set up inside GameBridge.init() when `window.Match3Bridge` is detected.
//
// This file exists primarily to:
//   1. Document the mobile transport contract for clarity.
//   2. Provide a future extension point if mobile-specific init logic is needed.
//   3. Be importable as a concrete adapter module per the bridge file layout spec.

export const MOBILE_CHANNEL_NAME = "Match3Bridge" as const;

/**
 * Returns true if the Flutter WebView JavaScriptChannel `Match3Bridge` is
 * available on the current window. This is the same check used by GameBridge
 * internally.
 */
export function isMobileTransportAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w[MOBILE_CHANNEL_NAME] === "object" && w[MOBILE_CHANNEL_NAME] !== null;
}
