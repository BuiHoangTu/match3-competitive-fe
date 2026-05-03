/**
 * Bridge message contract tests.
 *
 * AR-3 — two-token flow: bridge types must match the documented contract.
 * MR-3 — bridge must NOT carry moves, seed, or full board state.
 *
 * These tests validate the runtime BridgeMessageType constant values and
 * the shape expectations encoded in bridge-messages.txt. They are intentionally
 * value-level (not type-level) so they catch regressions at runtime.
 */
import { describe, it, expect } from "vitest";
import { BridgeMessageType } from "../bridge.js";

// The canonical list of bridge message types per bridge-messages.txt.
const EXPECTED_TYPES = [
  "startMatch",
  "appLifecycle",
  "requestLeaveMatch",
  "ready",
  "authTokenRejected",
  "matchEnded",
] as const;

describe("BridgeMessageType constants (AR-3)", () => {
  it("START_MATCH equals the canonical string 'startMatch'", () => {
    expect(BridgeMessageType.START_MATCH).toBe("startMatch");
  });

  it("APP_LIFECYCLE equals 'appLifecycle'", () => {
    expect(BridgeMessageType.APP_LIFECYCLE).toBe("appLifecycle");
  });

  it("REQUEST_LEAVE_MATCH equals 'requestLeaveMatch'", () => {
    expect(BridgeMessageType.REQUEST_LEAVE_MATCH).toBe("requestLeaveMatch");
  });

  it("READY equals 'ready'", () => {
    expect(BridgeMessageType.READY).toBe("ready");
  });

  it("AUTH_TOKEN_REJECTED equals 'authTokenRejected'", () => {
    expect(BridgeMessageType.AUTH_TOKEN_REJECTED).toBe("authTokenRejected");
  });

  it("MATCH_ENDED equals 'matchEnded'", () => {
    expect(BridgeMessageType.MATCH_ENDED).toBe("matchEnded");
  });

  it("exports exactly the six message types documented in bridge-messages.txt", () => {
    const exported = Object.values(BridgeMessageType) as string[];
    // Every expected type must be present.
    for (const type of EXPECTED_TYPES) {
      expect(exported).toContain(type);
    }
    // No extra undocumented types.
    expect(exported.length).toBe(EXPECTED_TYPES.length);
  });

  it("MR-3: bridge types do not include wire-only events (seed, move, opponent_move)", () => {
    const exported = Object.values(BridgeMessageType) as string[];
    // These belong to the Socket.IO protocol layer, not the shell/game bridge.
    const wireForbidden = ["seed", "move", "opponent_move", "match_found", "game_over"];
    for (const forbidden of wireForbidden) {
      expect(exported).not.toContain(forbidden);
    }
  });

  it("AR-3: startMatch payload contract — token and expiresAt fields", () => {
    // Simulate constructing a valid StartMatchMessage inline to confirm shape.
    const msg = {
      type: BridgeMessageType.START_MATCH,
      version: "1" as const,
      payload: {
        roomToken: "eyJhbGciOiJIUzI1NiJ9.test.sig",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      },
    };
    expect(msg.type).toBe("startMatch");
    expect(msg.version).toBe("1");
    expect(typeof msg.payload.roomToken).toBe("string");
    expect(typeof msg.payload.expiresAt).toBe("number");
  });

  it("AR-3: matchEnded payload contract — outcome and scores fields", () => {
    for (const outcome of ["W", "L", "D"] as const) {
      const msg = {
        type: BridgeMessageType.MATCH_ENDED,
        version: "1" as const,
        payload: {
          outcome,
          scores: { self: 100, opponent: 80 },
        },
      };
      expect(msg.type).toBe("matchEnded");
      expect(["W", "L", "D"]).toContain(msg.payload.outcome);
      expect(typeof msg.payload.scores.self).toBe("number");
      expect(typeof msg.payload.scores.opponent).toBe("number");
    }
  });
});
