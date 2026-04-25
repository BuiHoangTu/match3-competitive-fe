/**
 * T-v0.6-G03 · Retire HMAC rejoin code
 * T-v0.6-G02 · RejoinManager by verified token (userId-keyed)
 *
 * Rejoin authority now comes from room-token verification (RoomTokenSigner /
 * D02 handshake middleware). This manager only tracks the reconnection window:
 * a time-limited mapping of userId → roomId so the server knows whether a
 * disconnected player is still within their grace period.
 *
 * No HMAC, no separate rejoin token. Reconnection is driven by:
 *   1. Client calls POST /matchmaking/resume → receives a fresh room token.
 *   2. Client connects to Socket.IO with that room token.
 *   3. D02 middleware verifies the room token and places the socket in the room.
 *
 * The legacy `rejoin` socket event (v0.5) still works for backward-compat
 * during the v0.6 transition; it now authenticates via socket.data.userId
 * (set by the D02 handshake middleware) rather than an HMAC token.
 */

import { REJOIN_WINDOW_MS } from "./constants";

interface RejoinEntry {
  roomId: string;
  userId: string;
  expiresAt: number;
}

export class RejoinManager {
  /** userId → entry. Only one active entry per userId at a time. */
  private byUserId = new Map<string, RejoinEntry>();

  /**
   * Record that a userId is allowed to rejoin roomId within REJOIN_WINDOW_MS.
   * Replaces any previous entry for the same userId.
   * Returns the expiry timestamp for callers that need it.
   */
  register(roomId: string, userId: string): number {
    const expiresAt = Date.now() + REJOIN_WINDOW_MS;
    this.byUserId.set(userId, { roomId, userId, expiresAt });
    return expiresAt;
  }

  /**
   * Look up the room for a userId if still within the window.
   * Returns the entry or null if not found / expired.
   */
  lookup(userId: string): RejoinEntry | null {
    const entry = this.byUserId.get(userId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.byUserId.delete(userId);
      return null;
    }
    return entry;
  }

  /**
   * Remove a userId's rejoin entry (called after successful rejoin or game
   * end so stale entries don't accumulate).
   */
  delete(userId: string): void {
    this.byUserId.delete(userId);
  }

  /**
   * Remove all entries for a given roomId (called on room teardown).
   */
  cleanupRoom(roomId: string): void {
    for (const [userId, entry] of this.byUserId) {
      if (entry.roomId === roomId) this.byUserId.delete(userId);
    }
  }

  // ── Legacy shims ─────────────────────────────────────────────────────────
  // The v0.5 rejoin event path passes a `token` string. We no longer generate
  // or verify HMAC tokens; these shims exist only to allow the legacy socket
  // event handler in server.ts to keep functioning during v0.6 transition.
  // They will be removed when the `rejoin` socket event is retired (A09).

  /**
   * @deprecated v0.5 legacy — use `register(roomId, userId)` instead.
   * Kept so existing callers in server.ts compile; always returns an empty
   * string (the caller must switch to userId-keyed rejoin).
   */
  generate(roomId: string, _playerId: string): string {
    void roomId;
    return ""; // no longer generates HMAC tokens
  }

  /**
   * @deprecated v0.5 legacy — use `lookup(userId)` instead.
   * Always returns null; the v0.5 HMAC token format is no longer supported.
   */
  verify(_token: string): null {
    return null;
  }
}
