/**
 * Unit tests for GameBridge (T-v0.6-B07, T-v0.6-B09).
 *
 * These tests run in Node (no real window), using the _testInjectMessage /
 * _testReset helpers and a spy on window.parent.postMessage for outgoing
 * messages. The transport layer is not exercised — only the dispatch logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeMessageType } from "@match3/shared-js/bridge.js";

// ---------------------------------------------------------------------------
// Set up a minimal window stub so GameBridge.init() doesn't crash in Node.
// We do this before importing GameBridge.
// ---------------------------------------------------------------------------

const postMessageSpy = vi.fn();

// Provide a minimal window shim.
// GameBridge checks typeof window !== "undefined" and typeof window.Match3Bridge.
// We want the postMessage (iframe) path.
Object.defineProperty(globalThis, "window", {
  value: {
    parent: {
      postMessage: postMessageSpy,
    },
    addEventListener: vi.fn(),
    Match3Bridge: undefined, // no Flutter channel
  },
  writable: true,
  configurable: true,
});

// Also make window === window.parent return false so we hit window.parent.postMessage.
// We need window !== window.parent, which is already true above since they're
// different object references.

// ---------------------------------------------------------------------------
// Import after window stub is in place
// ---------------------------------------------------------------------------
import { GameBridge } from "./GameBridge.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GameBridge", () => {
  beforeEach(() => {
    GameBridge._testReset();
    postMessageSpy.mockClear();
  });

  // -------------------------------------------------------------------------
  // Incoming message dispatch (shell → game)
  // -------------------------------------------------------------------------

  it("dispatches startMatch payload to registered handler", () => {
    const handler = vi.fn();
    GameBridge.onStartMatch(handler);

    const msg = JSON.stringify({
      type: BridgeMessageType.START_MATCH,
      version: "1",
      payload: {
        roomToken: "room.jwt.xyz",
        expiresAt: 9999999999,
      },
    });

    GameBridge._testInjectMessage(msg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      roomToken: "room.jwt.xyz",
      expiresAt: 9999999999,
    });
  });

  it("dispatches appLifecycle payload to registered handler", () => {
    const handler = vi.fn();
    GameBridge.onAppLifecycle(handler);

    const msg = JSON.stringify({
      type: BridgeMessageType.APP_LIFECYCLE,
      version: "1",
      payload: { state: "background" },
    });

    GameBridge._testInjectMessage(msg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ state: "background" });
  });

  it("dispatches startLocalMatch payload to registered handler", () => {
    const handler = vi.fn();
    GameBridge.onStartLocalMatch(handler);

    const msg = JSON.stringify({
      type: BridgeMessageType.START_LOCAL_MATCH,
      version: "1",
      payload: {
        seed: 1234567,
        savedState: null,
        userId: "user-alice",
        characterId: "cat",
      },
    });

    GameBridge._testInjectMessage(msg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      seed: 1234567,
      savedState: null,
      userId: "user-alice",
      characterId: "cat",
    });
  });

  it("dispatches startLocalMatch with a saved snapshot payload", () => {
    const handler = vi.fn();
    GameBridge.onStartLocalMatch(handler);

    const savedState = {
      version: 1 as const,
      board: [
        [0, 1, 2],
        [3, 4, 0],
      ],
      rngState: 42,
      score: 250,
      nextTileId: 96,
    };

    GameBridge._testInjectMessage(
      JSON.stringify({
        type: BridgeMessageType.START_LOCAL_MATCH,
        version: "1",
        payload: { seed: 999, savedState, userId: "user-bob", characterId: "cat" },
      })
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].savedState).toEqual(savedState);
  });

  it("startLocalMatch with a malformed payload does not crash dispatch", () => {
    const handler = vi.fn();
    GameBridge.onStartLocalMatch(handler);

    // Missing `payload` field entirely. The dispatcher just hands whatever
    // payload is on the JSON to the handler; we assert no throw.
    expect(() =>
      GameBridge._testInjectMessage(
        JSON.stringify({
          type: BridgeMessageType.START_LOCAL_MATCH,
          version: "1",
        })
      )
    ).not.toThrow();
  });

  it("dispatches requestLeaveMatch to registered handler", () => {
    const handler = vi.fn();
    GameBridge.onRequestLeaveMatch(handler);

    const msg = JSON.stringify({
      type: BridgeMessageType.REQUEST_LEAVE_MATCH,
      version: "1",
      payload: {},
    });

    GameBridge._testInjectMessage(msg);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("calls all registered handlers for the same message type", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    GameBridge.onStartMatch(h1);
    GameBridge.onStartMatch(h2);

    GameBridge._testInjectMessage(
      JSON.stringify({
        type: BridgeMessageType.START_MATCH,
        version: "1",
        payload: { roomToken: "room.jwt.t", expiresAt: 1 },
      })
    );

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("silently ignores malformed (non-JSON) messages", () => {
    const handler = vi.fn();
    GameBridge.onStartMatch(handler);

    // Should not throw
    expect(() => GameBridge._testInjectMessage("not-json")).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("silently ignores messages with unknown type", () => {
    const handler = vi.fn();
    GameBridge.onStartMatch(handler);

    GameBridge._testInjectMessage(
      JSON.stringify({ type: "unknownMessageType", version: "1", payload: {} })
    );

    expect(handler).not.toHaveBeenCalled();
  });

  it("silently ignores non-object JSON input", () => {
    // _testInjectMessage only accepts strings, so we test that null-ish input
    // to _dispatch (via the string path) is handled gracefully.
    expect(() =>
      GameBridge._testInjectMessage(JSON.stringify(null))
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Outgoing messages (game → shell)
  // -------------------------------------------------------------------------

  it("emitMatchEnded posts a correctly shaped matchEnded message", () => {
    GameBridge.emitMatchEnded("W", { self: 300, opponent: 200 });

    expect(postMessageSpy).toHaveBeenCalledOnce();
    const arg = JSON.parse(
      (postMessageSpy.mock.calls[0][0] as { payload: string }).payload
    ) as unknown;
    expect(arg).toMatchObject({
      type: BridgeMessageType.MATCH_ENDED,
      version: "1",
      payload: {
        outcome: "W",
        scores: { self: 300, opponent: 200 },
      },
    });
  });

  it("emitMatchEnded sends correct outcome for loss", () => {
    GameBridge.emitMatchEnded("L", { self: 100, opponent: 250 });

    const arg = JSON.parse(
      (postMessageSpy.mock.calls[0][0] as { payload: string }).payload
    ) as unknown;
    expect((arg as { payload: { outcome: string } }).payload.outcome).toBe("L");
  });

  it("emitMatchEnded sends correct outcome for draw", () => {
    GameBridge.emitMatchEnded("D", { self: 150, opponent: 150 });

    const arg = JSON.parse(
      (postMessageSpy.mock.calls[0][0] as { payload: string }).payload
    ) as unknown;
    expect((arg as { payload: { outcome: string } }).payload.outcome).toBe("D");
  });

  it("emitReady posts a correctly shaped ready message", () => {
    GameBridge.emitReady();

    expect(postMessageSpy).toHaveBeenCalledOnce();
    const arg = JSON.parse(
      (postMessageSpy.mock.calls[0][0] as { payload: string }).payload
    ) as unknown;
    expect(arg).toMatchObject({
      type: BridgeMessageType.READY,
      version: "1",
      payload: {},
    });
  });

  it("emitAuthTokenRejected posts a correctly shaped message", () => {
    GameBridge.emitAuthTokenRejected();

    expect(postMessageSpy).toHaveBeenCalledOnce();
    const arg = JSON.parse(
      (postMessageSpy.mock.calls[0][0] as { payload: string }).payload
    ) as unknown;
    expect(arg).toMatchObject({
      type: BridgeMessageType.AUTH_TOKEN_REJECTED,
      version: "1",
      payload: {},
    });
  });

  // -------------------------------------------------------------------------
  // T-v0.6-B01b / B07: startMatch → SyncClient integration (logic level)
  // -------------------------------------------------------------------------

  it("startMatch handler receives roomToken and expiresAt fields", () => {
    const captured: { roomToken: string; expiresAt: number }[] = [];
    GameBridge.onStartMatch((p) => {
      captured.push(p);
    });

    GameBridge._testInjectMessage(
      JSON.stringify({
        type: BridgeMessageType.START_MATCH,
        version: "1",
        payload: { roomToken: "room.jwt.xxx", expiresAt: 1700000000 },
      })
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      roomToken: "room.jwt.xxx",
      expiresAt: 1700000000,
    });
  });

  // -------------------------------------------------------------------------
  // T-v0.6-B09: matchEnded fires exactly once per match
  // -------------------------------------------------------------------------

  it("emitMatchEnded called twice sends two messages (guard is caller's responsibility)", () => {
    // GameBridge itself does not guard against double-emission; that guard lives
    // in GameScene.endGame() via the game_over state check. This test documents
    // the expected behaviour of the bridge primitive.
    GameBridge.emitMatchEnded("W", { self: 10, opponent: 5 });
    GameBridge.emitMatchEnded("W", { self: 10, opponent: 5 });

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // T-v0.6-B11: emitReady sends correctly shaped message
  // -------------------------------------------------------------------------

  it("emitReady posts exactly one correctly shaped ready message", () => {
    GameBridge.emitReady();

    expect(postMessageSpy).toHaveBeenCalledOnce();
    const arg = JSON.parse(
      (postMessageSpy.mock.calls[0][0] as { payload: string }).payload
    ) as unknown;
    expect(arg).toMatchObject({
      type: "ready",
      version: "1",
      payload: {},
    });
  });

  it("emitReady called twice sends two messages (the once-only guard is in GameScene)", () => {
    // GameBridge.emitReady() is a raw emitter; the once-only guard is the
    // _readyEmitted module-level flag in GameScene.ts. That flag cannot be
    // tested here without Phaser. This test documents the primitive behaviour.
    GameBridge.emitReady();
    GameBridge.emitReady();

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
  });
});
