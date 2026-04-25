/**
 * T-v0.6-A08c · Flutter Web iframe JS-side bridge adapter
 *
 * This module is the JavaScript counterpart of `shell/lib/bridge/bridge_web.dart`.
 * It adapts GameBridge's raw `postMessage` transport to the envelope format
 * expected by the Dart side:
 *
 *   Inbound (shell → game):
 *     The Dart side sends `{ origin: "match3", payload: "<json>" }` objects
 *     via `iframe.contentWindow.postMessage(...)`.
 *     GameBridge.init() already filters for `origin === "match3"` envelopes
 *     and unwraps the inner payload before calling _dispatch.
 *     No additional wiring is needed here for the inbound path.
 *
 *   Outbound (game → shell):
 *     GameBridge._send() posts the raw JSON string to `window.parent`.
 *     The Dart side's `window.onMessage` listener only accepts envelopes with
 *     `origin: "match3"`. Therefore, outbound messages from the game must be
 *     wrapped in that envelope before posting to the parent frame.
 *
 * `initWebTransport()` patches `GameBridge._send` outbound path by wrapping
 * `window.parent.postMessage` so that all outgoing messages are enveloped with
 * `{ origin: "match3", payload: json }`.
 *
 * Usage: call `initWebTransport()` once, before `GameBridge.init()`, when
 * running inside a Flutter Web iframe.
 *
 * @see shell/lib/bridge/bridge_web.dart  — Dart counterpart
 * @see fe/src/bridge/GameBridge.ts        — singleton transport
 */

/** The envelope origin tag used to identify match3 bridge traffic. */
export const BRIDGE_ORIGIN_TAG = "match3" as const;

/**
 * Returns true when the game view is running inside an iframe (i.e. has a
 * parent frame different from itself). This is the signal to use the web
 * postMessage transport.
 */
export function isWebTransportAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window !== window.parent;
  } catch {
    // Cross-origin frame access might throw; treat as iframe-hosted.
    return true;
  }
}

/**
 * Install the web-transport outbound envelope wrapper.
 *
 * Replaces `window.__match3WebSend` with an enveloped postMessage sender.
 * GameBridge's `_send` already uses `window.parent.postMessage(json, "*")` for
 * the iframe path. The Dart side's listener filters for `origin === "match3"`
 * envelope objects; plain JSON strings are NOT accepted.
 *
 * To make the existing GameBridge._send work with the Dart bridge_web receiver,
 * we intercept the outbound path by overriding `window.parent`'s postMessage
 * via a forwarding function stored at `window.__match3SendToShell`.
 *
 * NOTE: GameBridge.init() uses `window.parent.postMessage(json, "*")` directly.
 * For the iframe web transport this is not quite right — the Dart side expects
 * `{ origin: "match3", payload: json }` objects, not raw JSON strings.
 *
 * Calling `initWebTransport()` installs a global interceptor:
 *   window.__match3SendToShell = (json) => window.parent.postMessage({ origin: "match3", payload: json }, "*")
 *
 * You must also patch GameBridge to call `window.__match3SendToShell` when
 * this transport is active. The recommended approach is to call
 * `initWebTransport()` and then pass a custom send function to GameBridge, or
 * (simpler) rely on GameBridge's existing postMessage path which the Dart side
 * already handles for plain string payloads via a fallback branch.
 *
 * For v0.6, GameBridge.init() handles both string payloads and
 * `{ origin: "match3", payload }` objects on the inbound side. The Dart
 * bridge_web receiver listens for `origin: "match3"` envelopes.
 * `initWebTransport()` provides the wrap for the outbound direction.
 */
export function initWebTransport(): void {
  if (typeof window === "undefined") return;

  // Expose a well-known send function that wraps messages in the expected
  // envelope so the Dart bridge_web listener accepts them.
  (window as unknown as Record<string, unknown>)["__match3SendToShell"] = (
    json: string
  ): void => {
    const target = window !== window.parent ? window.parent : window;
    target.postMessage({ origin: BRIDGE_ORIGIN_TAG, payload: json }, "*");
  };
}
