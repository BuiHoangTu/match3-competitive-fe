import { describe, it, expect, beforeEach, vi } from "vitest";
import { RoomManager } from "../RoomManager";
import { IdleSweeper } from "../IdleSweeper";
import {
  IDLE_MATCH_TIMEOUT_MS,
  IDLE_SWEEP_INTERVAL_MS,
} from "../constants";

function makeMockIo() {
  const emit = vi.fn();
  return {
    emit,
    to: vi.fn(() => ({ emit })),
  };
}

function makeMockTimerManager() {
  return {
    stopTimer: vi.fn(),
    scheduleRoomClose: vi.fn(),
  };
}

describe("IdleSweeper", () => {
  let rm: RoomManager;
  let io: ReturnType<typeof makeMockIo>;
  let timerManager: ReturnType<typeof makeMockTimerManager>;
  let sweeper: IdleSweeper;

  beforeEach(() => {
    rm = new RoomManager();
    io = makeMockIo();
    timerManager = makeMockTimerManager();
    sweeper = new IdleSweeper(io as never, rm, timerManager);
  });

  it("closes a room that has received no moves for the timeout duration and emits game_over", () => {
    const room = rm.createRoom("p1");
    rm.joinRoom(room.id, "p2");

    const startedAt = room.lastActivityAt;
    const closed = sweeper.sweep(IDLE_MATCH_TIMEOUT_MS, startedAt + IDLE_MATCH_TIMEOUT_MS);

    expect(closed).toEqual([room.id]);
    expect(room.status).toBe("over");
    expect(io.to).toHaveBeenCalledWith(room.id);
    expect(io.emit).toHaveBeenCalledWith("game_over", {});
    expect(timerManager.stopTimer).toHaveBeenCalledWith(room.id);
  });

  it("does not close a room whose last activity is recent", () => {
    const room = rm.createRoom("p1");
    rm.joinRoom(room.id, "p2");

    const startedAt = room.lastActivityAt;
    const closed = sweeper.sweep(
      IDLE_MATCH_TIMEOUT_MS,
      startedAt + IDLE_MATCH_TIMEOUT_MS - 1_000
    );

    expect(closed).toEqual([]);
    expect(room.status).toBe("active");
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("a move resets the idle counter so the room is not swept", () => {
    const room = rm.createRoom("p1");
    rm.joinRoom(room.id, "p2");

    const startedAt = room.lastActivityAt;

    // Just before the deadline, a move arrives
    const nowDuringMove = startedAt + IDLE_MATCH_TIMEOUT_MS - 5_000;
    vi.setSystemTime(new Date(nowDuringMove));
    rm.addMove(room.id, {
      playerId: "p1",
      r1: 0,
      c1: 0,
      r2: 0,
      c2: 1,
      timestamp: nowDuringMove,
    });

    // At the original deadline, the room should NOT be closed
    const closed = sweeper.sweep(
      IDLE_MATCH_TIMEOUT_MS,
      startedAt + IDLE_MATCH_TIMEOUT_MS
    );
    expect(closed).toEqual([]);
    expect(room.status).toBe("active");

    // And only closes once the deadline is reached relative to the new activity
    const closedLater = sweeper.sweep(
      IDLE_MATCH_TIMEOUT_MS,
      nowDuringMove + IDLE_MATCH_TIMEOUT_MS
    );
    expect(closedLater).toEqual([room.id]);

    vi.useRealTimers();
  });

  it("sweep interval is at least 10x smaller than the timeout", () => {
    expect(IDLE_SWEEP_INTERVAL_MS * 10).toBeLessThanOrEqual(IDLE_MATCH_TIMEOUT_MS);
  });

  it("skips rooms whose status is already 'over'", () => {
    const room = rm.createRoom("p1");
    rm.joinRoom(room.id, "p2");
    room.status = "over";

    const closed = sweeper.sweep(
      IDLE_MATCH_TIMEOUT_MS,
      room.lastActivityAt + IDLE_MATCH_TIMEOUT_MS
    );
    expect(closed).toEqual([]);
    expect(io.emit).not.toHaveBeenCalled();
  });
});
