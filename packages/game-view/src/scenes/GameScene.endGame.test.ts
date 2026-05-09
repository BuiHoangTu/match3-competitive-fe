/**
 * Focused unit tests for GameScene.endGame's "fromServer" guard.
 *
 * The endGame method is private but its guard is the source of truth for
 * "who is allowed to declare a match over locally" — solo can; pve and
 * turn_based cannot (the server's game_over signal must come first). This
 * test reaches into the prototype directly, stubbing out all Phaser-level
 * dependencies, so we can exercise the guard without instantiating Phaser.
 *
 * Also covers signalPveMatchComplete: it must call emitMatchComplete with
 * the right loserId/scores and detach the pointer so no late move slips in.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// All vi.mock factories are hoisted to the top of the file before any imports
// run, so the mocked modules are in place when GameScene.ts is loaded. Use
// vi.hoisted to share spy refs between the factory and the test bodies.
const { mockEmitMatchEnded } = vi.hoisted(() => ({
  mockEmitMatchEnded: vi.fn(),
}));

// Phaser refuses to load in node (it touches navigator + WebGL at import-time).
// We don't need any real Phaser code in this test — endGame lives on the
// GameScene prototype; once the import succeeds we can call it via .call().
vi.mock("phaser", () => {
  class FakeScene {}
  return {
    default: {
      Scene: FakeScene,
      GameObjects: {
        Text: class {},
        Rectangle: class {},
        Graphics: class {},
      },
    },
    Scene: FakeScene,
  };
});

vi.mock("../bridge/GameBridge.js", () => ({
  GameBridge: {
    emitMatchEnded: mockEmitMatchEnded,
    emitReady: vi.fn(),
    emitAuthTokenRejected: vi.fn(),
    onAppLifecycle: vi.fn(),
    onStartMatch: vi.fn(),
    onStartLocalMatch: vi.fn(),
    onRequestLeaveMatch: vi.fn(),
    init: vi.fn(),
  },
}));

// Stub SyncClient.clearRejoinToken (static) so the guard test doesn't touch
// sessionStorage. The full SyncClient surface isn't needed here.
vi.mock("../net/SyncClient.js", () => ({
  SyncClient: {
    clearRejoinToken: vi.fn(),
  },
}));

import { GameScene } from "./GameScene.js";

interface StubScene {
  state: "idle" | "animating" | "game_over";
  mode: "solo" | "pve" | "turn_based";
  myScore: number;
  opponentScore: number;
  myPlayerId: string | null;
  opponentId: string | null;
  syncClient: { emitMatchComplete: ReturnType<typeof vi.fn> } | null;
  stopTurnTimer: ReturnType<typeof vi.fn>;
  inputController: { detachPointer: ReturnType<typeof vi.fn> };
  wipeSoloSave: ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal `this` object with all the fields endGame and
 * signalPveMatchComplete touch. We then `.call()` the prototype methods on
 * it — Phaser stays out of the way entirely.
 */
function makeStub(overrides: Partial<StubScene> = {}): StubScene {
  return {
    state: "idle",
    mode: "solo",
    myScore: 0,
    opponentScore: 0,
    myPlayerId: null,
    opponentId: null,
    syncClient: null,
    stopTurnTimer: vi.fn(),
    inputController: { detachPointer: vi.fn() },
    wipeSoloSave: vi.fn(),
    ...overrides,
  };
}

// Convenient handles to the private methods (private in TS but real on the
// prototype). Cast to any so we can `.call()` with our stub.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const endGame = (GameScene.prototype as any).endGame as (
  this: unknown,
  timeBonus?: number,
  fromServer?: boolean
) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const signalPveMatchComplete = (GameScene.prototype as any)
  .signalPveMatchComplete as (
  this: unknown,
  loser: "self" | "opponent"
) => void;

describe("GameScene.endGame — fromServer guard", () => {
  beforeEach(() => {
    mockEmitMatchEnded.mockClear();
  });

  it("turn_based + fromServer=false is a no-op (state unchanged, no bridge emit)", () => {
    const stub = makeStub({ mode: "turn_based", state: "idle" });
    endGame.call(stub, 0, false);
    expect(stub.state).toBe("idle");
    expect(mockEmitMatchEnded).not.toHaveBeenCalled();
    expect(stub.stopTurnTimer).not.toHaveBeenCalled();
    expect(stub.inputController.detachPointer).not.toHaveBeenCalled();
  });

  it("turn_based + fromServer=true ends the match (state=game_over, bridge emitted)", () => {
    const stub = makeStub({
      mode: "turn_based",
      state: "idle",
      myScore: 200,
      opponentScore: 100,
    });
    endGame.call(stub, 50, true);
    expect(stub.state).toBe("game_over");
    expect(mockEmitMatchEnded).toHaveBeenCalledOnce();
    // Outcome computed from (myScore + bonus) vs opponentScore.
    expect(mockEmitMatchEnded).toHaveBeenCalledWith("W", {
      self: 250,
      opponent: 100,
    });
    expect(stub.stopTurnTimer).toHaveBeenCalled();
    expect(stub.inputController.detachPointer).toHaveBeenCalled();
  });

  it("pve + fromServer=false is a no-op (server is authoritative)", () => {
    const stub = makeStub({ mode: "pve", state: "idle" });
    endGame.call(stub, 0, false);
    expect(stub.state).toBe("idle");
    expect(mockEmitMatchEnded).not.toHaveBeenCalled();
  });

  it("solo + fromServer=false ends the match locally (only mode allowed to)", () => {
    const stub = makeStub({
      mode: "solo",
      state: "idle",
      myScore: 80,
      opponentScore: 0,
    });
    endGame.call(stub, 0, false);
    expect(stub.state).toBe("game_over");
    expect(mockEmitMatchEnded).toHaveBeenCalledOnce();
    // Solo always wins / is "W" when myScore > 0; here outcome is W.
    expect(mockEmitMatchEnded).toHaveBeenCalledWith("W", {
      self: 80,
      opponent: 0,
    });
  });

  it("re-entrancy: a second call when state===game_over is a no-op", () => {
    const stub = makeStub({ mode: "solo", state: "game_over" });
    endGame.call(stub, 0, false);
    expect(mockEmitMatchEnded).not.toHaveBeenCalled();
  });

  it("draw outcome when scores equal", () => {
    const stub = makeStub({
      mode: "solo",
      myScore: 100,
      opponentScore: 100,
    });
    endGame.call(stub, 0, false);
    expect(mockEmitMatchEnded).toHaveBeenCalledWith("D", {
      self: 100,
      opponent: 100,
    });
  });

  it("loss outcome when myScore < opponentScore", () => {
    const stub = makeStub({
      mode: "turn_based",
      myScore: 50,
      opponentScore: 200,
    });
    endGame.call(stub, 0, true);
    expect(mockEmitMatchEnded).toHaveBeenCalledWith("L", {
      self: 50,
      opponent: 200,
    });
  });
});

describe("GameScene.signalPveMatchComplete", () => {
  it("emits match_complete with self as loserId and detaches pointer", () => {
    const emitMatchComplete = vi.fn();
    const stub = makeStub({
      mode: "pve",
      state: "idle",
      myPlayerId: "me",
      opponentId: "BOT",
      myScore: 30,
      opponentScore: 70,
      syncClient: { emitMatchComplete },
    });
    signalPveMatchComplete.call(stub, "self");
    expect(emitMatchComplete).toHaveBeenCalledOnce();
    expect(emitMatchComplete).toHaveBeenCalledWith({
      loserId: "me",
      loserReason: "hp",
      scores: { me: 30, BOT: 70 },
    });
    expect(stub.inputController.detachPointer).toHaveBeenCalled();
  });

  it("emits match_complete with opponent as loserId when loser='opponent'", () => {
    const emitMatchComplete = vi.fn();
    const stub = makeStub({
      mode: "pve",
      myPlayerId: "me",
      opponentId: "BOT",
      myScore: 100,
      opponentScore: 50,
      syncClient: { emitMatchComplete },
    });
    signalPveMatchComplete.call(stub, "opponent");
    expect(emitMatchComplete).toHaveBeenCalledWith({
      loserId: "BOT",
      loserReason: "hp",
      scores: { me: 100, BOT: 50 },
    });
  });

  it("falls back to 'BOT' when opponentId is null", () => {
    const emitMatchComplete = vi.fn();
    const stub = makeStub({
      mode: "pve",
      myPlayerId: "me",
      opponentId: null,
      myScore: 10,
      opponentScore: 0,
      syncClient: { emitMatchComplete },
    });
    signalPveMatchComplete.call(stub, "opponent");
    expect(emitMatchComplete).toHaveBeenCalledWith({
      loserId: "BOT",
      loserReason: "hp",
      scores: { me: 10, BOT: 0 },
    });
  });

  it("is a no-op when state is already game_over", () => {
    const emitMatchComplete = vi.fn();
    const stub = makeStub({
      mode: "pve",
      state: "game_over",
      myPlayerId: "me",
      opponentId: "BOT",
      syncClient: { emitMatchComplete },
    });
    signalPveMatchComplete.call(stub, "self");
    expect(emitMatchComplete).not.toHaveBeenCalled();
  });

  it("is a no-op when syncClient or myPlayerId is missing", () => {
    const stub = makeStub({
      mode: "pve",
      myPlayerId: null,
      syncClient: null,
    });
    // Should not throw.
    signalPveMatchComplete.call(stub, "self");
    expect(stub.inputController.detachPointer).not.toHaveBeenCalled();
  });
});
