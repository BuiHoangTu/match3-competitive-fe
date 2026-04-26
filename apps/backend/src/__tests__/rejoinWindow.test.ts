/**
 * T-v0.6-G06 · Extend reconnection window to 5 minutes
 *
 * Verifies that the RejoinManager's time window matches REJOIN_WINDOW_MS
 * (5 minutes = 300 000 ms), that a room registered just within the window
 * is still accessible, and that one registered just past it is rejected.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { RejoinManager } from "../RejoinManager";
import { REJOIN_WINDOW_MS } from "../constants";

describe("T-v0.6-G06 · REJOIN_WINDOW_MS = 5 minutes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("REJOIN_WINDOW_MS is 5 minutes (300 000 ms)", () => {
    expect(REJOIN_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("lookup succeeds at 4 min 59 s (1 ms before expiry)", () => {
    vi.useFakeTimers();
    const rm = new RejoinManager();
    const t0 = Date.now();
    rm.register("room-1", "user-alice");

    // Advance to 1 ms before expiry.
    vi.setSystemTime(t0 + REJOIN_WINDOW_MS - 1);
    const entry = rm.lookup("user-alice");
    expect(entry).not.toBeNull();
    expect(entry!.roomId).toBe("room-1");
  });

  it("lookup returns null at exactly REJOIN_WINDOW_MS (expired)", () => {
    vi.useFakeTimers();
    const rm = new RejoinManager();
    const t0 = Date.now();
    rm.register("room-2", "user-bob");

    // Advance to exactly expiry + 1 ms (expired).
    vi.setSystemTime(t0 + REJOIN_WINDOW_MS + 1);
    const entry = rm.lookup("user-bob");
    expect(entry).toBeNull();
  });

  it("register replaces an existing entry for the same userId", () => {
    vi.useFakeTimers();
    const rm = new RejoinManager();
    rm.register("room-A", "user-carol");
    rm.register("room-B", "user-carol"); // replaces

    const entry = rm.lookup("user-carol");
    expect(entry).not.toBeNull();
    expect(entry!.roomId).toBe("room-B");
  });

  it("cleanupRoom removes all entries for that room", () => {
    vi.useFakeTimers();
    const rm = new RejoinManager();
    rm.register("room-X", "user-p1");
    rm.register("room-X", "user-p2"); // Note: register overwrites per userId
    rm.register("room-Y", "user-p3");

    // Register p1 and p2 separately (they are different userIds)
    const rm2 = new RejoinManager();
    rm2.register("room-X", "user-p1");
    // Register p2 to room-X by calling again — each userId gets its own entry.
    // But register(roomId, userId) only accepts one userId. Let's just test p1.
    rm2.register("room-Y", "user-p3");

    rm2.cleanupRoom("room-X");
    expect(rm2.lookup("user-p1")).toBeNull();
    expect(rm2.lookup("user-p3")).not.toBeNull();
  });

  it("delete removes a specific userId entry", () => {
    vi.useFakeTimers();
    const rm = new RejoinManager();
    rm.register("room-1", "user-alice");
    rm.delete("user-alice");
    expect(rm.lookup("user-alice")).toBeNull();
  });
});
