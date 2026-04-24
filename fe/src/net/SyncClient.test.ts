import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock socket.io-client — use vi.hoisted so vars are available before hoisting
// ---------------------------------------------------------------------------

const { mockEmit, mockOn, mockConnect, mockDisconnect, mockIo, getListeners, resetListeners } =
  vi.hoisted(() => {
    const listeners: Record<string, ((...args: unknown[]) => void) | undefined> = {};
    const mockEmit = vi.fn();
    const mockOn = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = cb;
    });
    const mockConnect = vi.fn();
    const mockDisconnect = vi.fn();
    const mockIo = vi.fn(() => ({
      emit: mockEmit,
      on: mockOn,
      connect: mockConnect,
      disconnect: mockDisconnect,
    }));
    return {
      mockEmit,
      mockOn,
      mockConnect,
      mockDisconnect,
      mockIo,
      getListeners: () => listeners,
      resetListeners: () => { for (const k of Object.keys(listeners)) delete listeners[k]; },
    };
  });

vi.mock("socket.io-client", () => ({
  io: mockIo,
}));

// Helper: trigger a registered socket event
function trigger(event: string, ...args: unknown[]) {
  const handler = getListeners()[event];
  if (!handler) throw new Error(`No handler registered for "${event}"`);
  handler(...args);
}

// ---------------------------------------------------------------------------
// Import after mock is in place
// ---------------------------------------------------------------------------
import { SyncClient } from "./SyncClient.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncClient", () => {
  let client: SyncClient;

  beforeEach(() => {
    resetListeners();
    mockEmit?.mockClear();
    mockOn?.mockClear();
    mockConnect?.mockClear();
    mockDisconnect?.mockClear();
    mockIo?.mockClear();

    client = new SyncClient("http://localhost:3001");
  });

  // 1. connect() resolves when the socket emits "connect"
  it("connect() resolves when socket emits connect", async () => {
    client.setAuthToken("test-token");
    const connectPromise = client.connect();

    // Simulate the socket firing "connect"
    trigger("connect");

    await expect(connectPromise).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
  });

  // 2. connect() rejects on connect_error
  it("connect() rejects on connect_error", async () => {
    client.setAuthToken("test-token");
    const connectPromise = client.connect();

    trigger("connect_error", new Error("refused"));

    await expect(connectPromise).rejects.toThrow("refused");
    expect(client.connected).toBe(false);
  });

  // 3. matchmake() emits the "matchmake" event
  it("matchmake() emits matchmake event", async () => {
    client.setAuthToken("test-token");
    const p = client.connect();
    trigger("connect");
    await p;

    client.matchmake();

    expect(mockEmit).toHaveBeenCalledWith("matchmake");
  });

  // 4. sendMove() emits "move" with the correct payload
  it("sendMove() emits move with correct payload", async () => {
    client.setAuthToken("test-token");
    const p = client.connect();
    trigger("connect");
    await p;

    client.sendMove("room-1", 2, 3, 2, 4);

    expect(mockEmit).toHaveBeenCalledWith("move", {
      roomId: "room-1",
      r1: 2,
      c1: 3,
      r2: 2,
      c2: 4,
    });
  });

  // 5. onMatchFound callback fires with correct args and sets roomId/seed
  it("onMatchFound fires callback and sets roomId/seed", async () => {
    client.setAuthToken("test-token");
    const p = client.connect();
    trigger("connect");
    await p;

    const cb = vi.fn();
    client.onMatchFound(cb);

    trigger("match_found", {
      roomId: "room-42",
      seed: 123456,
      opponentId: "opponent-xyz",
    });

    expect(cb).toHaveBeenCalledWith("room-42", 123456, "opponent-xyz");
    expect(client.roomId).toBe("room-42");
    expect(client.seed).toBe(123456);
  });

  // 6. onMoveRejected callback fires with the reason string
  it("onMoveRejected fires callback with reason", async () => {
    client.setAuthToken("test-token");
    const p = client.connect();
    trigger("connect");
    await p;

    const cb = vi.fn();
    client.onMoveRejected(cb);

    trigger("move_rejected", { reason: "invalid move", move: {} });

    expect(cb).toHaveBeenCalledWith("invalid move");
  });

  // 7. disconnect() marks connected false
  it("disconnect() marks client as disconnected", async () => {
    client.setAuthToken("test-token");
    const p = client.connect();
    trigger("connect");
    await p;

    client.disconnect();

    expect(client.connected).toBe(false);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T-v0.6-B07: auth token + deferred connect
  // -------------------------------------------------------------------------

  // 8. connect() is deferred when no token has been set
  it("connect() is deferred until setAuthToken() fires", async () => {
    // No token set — io() should NOT be called yet.
    const connectPromise = client.connect();

    expect(mockIo).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();

    // Now deliver the token.
    client.setAuthToken("test-jwt-token");

    // io() should have been called now.
    expect(mockIo).toHaveBeenCalledOnce();

    // Simulate the socket emitting "connect".
    trigger("connect");
    await expect(connectPromise).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
  });

  // 9. connect() fires immediately when token was pre-set
  it("connect() fires immediately when token is already set", async () => {
    client.setAuthToken("pre-set-token");

    const connectPromise = client.connect();

    // io() should be called synchronously.
    expect(mockIo).toHaveBeenCalledOnce();

    trigger("connect");
    await expect(connectPromise).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
  });

  // 10. io() receives auth: { token } in handshake options
  it("io() receives auth: { token } in handshake options", async () => {
    client.setAuthToken("firebase-jwt-abc");
    const connectPromise = client.connect();

    expect(mockIo).toHaveBeenCalledWith(
      "http://localhost:3001",
      expect.objectContaining({ auth: { token: "firebase-jwt-abc" } })
    );

    trigger("connect");
    await connectPromise;
  });

  // 11. setAuthToken() called after connect() pending — resolves the promise
  it("setAuthToken() after connect() pending resolves the connect promise", async () => {
    const connectPromise = client.connect();

    // Token arrives later (simulating shell delivering it asynchronously).
    client.setAuthToken("late-token");

    trigger("connect");
    await expect(connectPromise).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
  });
});
