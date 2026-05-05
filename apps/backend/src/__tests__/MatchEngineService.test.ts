/**
 * Unit tests for MatchEngineService (the judge).
 *
 * No Socket.IO — pure service-level event assertions.
 *
 * Covers:
 * - startMatch emits match_started with correct snapshot
 * - submitMove valid move → move_resolved + turn_changed
 * - submitMove no-match swap → move_rejected { no_match }
 * - submitMove out-of-turn → move_rejected { not_your_turn }
 * - submitMove out-of-bounds → move_rejected { out_of_bounds }
 * - forfeit → match_ended { loserId }
 * - stamina ticks down and fires match_ended when zero
 * - getSnapshot returns correct shape including health/mana defaults
 * - cleanup removes state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MatchEngineService, defaultPlayerState, type PlayerState } from "../services/MatchEngineService";
import { createBoard } from "@match3/shared-js/engine/Board";
import { findMatches } from "@match3/shared-js/engine/MatchEngine";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROOM_ID = "test-room";
const P1 = "player-1";
const P2 = "player-2";
const SEED = 42;

/** Find the first adjacent swap that produces a match. */
function findMatchingSwap(grid: number[][]): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r][c + 1]] = [cand[r][c + 1], cand[r][c]];
        if (findMatches(cand).length > 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r + 1][c]] = [cand[r + 1][c], cand[r][c]];
        if (findMatches(cand).length > 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

/** Find the first adjacent swap that produces NO match. */
function findNonMatchingSwap(grid: number[][]): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r][c + 1]] = [cand[r][c + 1], cand[r][c]];
        if (findMatches(cand).length === 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r + 1][c]] = [cand[r + 1][c], cand[r][c]];
        if (findMatches(cand).length === 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MatchEngineService", () => {
  let service: MatchEngineService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new MatchEngineService();
  });

  afterEach(() => {
    service.cleanup(ROOM_ID);
    vi.useRealTimers();
  });

  // ── startMatch ─────────────────────────────────────────────────────────────

  it("startMatch emits match_started with correct snapshot shape", () => {
    const payloads: unknown[] = [];
    service.on("match_started", (p) => payloads.push(p));

    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as ReturnType<typeof service.getSnapshot> & { roomId: string; playerIds: string[]; gameMode: string };
    expect((payload as { roomId: string }).roomId).toBe(ROOM_ID);
    expect((payload as { gameMode: string }).gameMode).toBe("turn_based");
  });

  it("startMatch is idempotent — calling twice does not double-emit", () => {
    const payloads: unknown[] = [];
    service.on("match_started", (p) => payloads.push(p));

    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    expect(payloads).toHaveLength(1);
  });

  // ── getSnapshot ────────────────────────────────────────────────────────────

  it("getSnapshot returns null before startMatch", () => {
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
  });

  it("getSnapshot returns correct defaults: health=100, mana=100, stamina=PLAYER_TIME_MS", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;

    expect(snap).not.toBeNull();
    expect(snap.activePlayer).toBe(P1);
    expect(snap.playerStates[P1]).toEqual({ health: 100, mana: 100, stamina: 5 * 60 * 1000 });
    expect(snap.playerStates[P2]).toEqual({ health: 100, mana: 100, stamina: 5 * 60 * 1000 });
    expect(snap.originalSeed).toBe(SEED);
    expect(Array.isArray(snap.boardGrid)).toBe(true);
    expect(snap.boardGrid.length).toBe(8);
    expect(snap.scores[P1]).toBe(0);
    expect(snap.scores[P2]).toBe(0);
  });

  // ── submitMove — valid ──────────────────────────────────────────────────────

  it("valid move emits move_resolved with correct fields", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(snap.boardGrid);
    if (!swap) throw new Error("No matching swap on initial board");

    const resolved: unknown[] = [];
    const changed: unknown[] = [];
    service.on("move_resolved", (p) => resolved.push(p));
    service.on("turn_changed", (p) => changed.push(p));

    service.submitMove(ROOM_ID, P1, swap.r1, swap.c1, swap.r2, swap.c2);

    expect(resolved).toHaveLength(1);
    const r = resolved[0] as { playerId: string; roomId: string; steps: unknown[]; finalGrid: number[][]; rngState: number; pointsEarned: number; scores: Record<string, number>; playerStates: Record<string, PlayerState> };
    expect(r.roomId).toBe(ROOM_ID);
    expect(r.playerId).toBe(P1);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.pointsEarned).toBeGreaterThan(0);
    expect(r.scores[P1]).toBe(r.pointsEarned);
    expect(r.finalGrid.length).toBe(8);
    expect(r.playerStates[P1]).toBeDefined();
    expect(r.playerStates[P1]!.health).toBe(100);
    expect(r.playerStates[P1]!.mana).toBe(100);

    expect(changed).toHaveLength(1);
    const c = changed[0] as { activePlayer: string; playerStates: Record<string, PlayerState> };
    expect(c.activePlayer).toBe(P2);
  });

  it("valid move advances rngState and boardGrid", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const before = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(before.boardGrid);
    if (!swap) throw new Error("No matching swap");

    service.submitMove(ROOM_ID, P1, swap.r1, swap.c1, swap.r2, swap.c2);
    const after = service.getSnapshot(ROOM_ID)!;

    expect(after.rngState).not.toBe(before.rngState);
    expect(JSON.stringify(after.boardGrid)).not.toBe(JSON.stringify(before.boardGrid));
  });

  // ── submitMove — rejected ──────────────────────────────────────────────────

  it("no-match swap emits move_rejected { no_match }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const badSwap = findNonMatchingSwap(snap.boardGrid);
    if (!badSwap) {
      console.warn("All swaps produce matches — test vacuous");
      return;
    }

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    service.submitMove(ROOM_ID, P1, badSwap.r1, badSwap.c1, badSwap.r2, badSwap.c2);

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("no_match");
  });

  it("out-of-turn move emits move_rejected { not_your_turn }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(snap.boardGrid);
    if (!swap) throw new Error("No matching swap");

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    // P2 tries to move but it's P1's turn
    service.submitMove(ROOM_ID, P2, swap.r1, swap.c1, swap.r2, swap.c2);

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("not_your_turn");
  });

  it("out-of-bounds move emits move_rejected { out_of_bounds }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    service.submitMove(ROOM_ID, P1, 9, 0, 9, 1); // row 9 is out of bounds

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("out_of_bounds");
  });

  it("non-adjacent move emits move_rejected { non_adjacent }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    service.submitMove(ROOM_ID, P1, 0, 0, 0, 3); // 3 apart, not adjacent

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("non_adjacent");
  });

  // ── forfeit ────────────────────────────────────────────────────────────────

  it("forfeit emits match_ended with correct loserId and outcome", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    service.forfeit(ROOM_ID, P1);

    expect(ended).toHaveLength(1);
    const e = ended[0] as { roomId: string; loserId: string; outcome: string; scores: Record<string, number>; durationMs: number };
    expect(e.roomId).toBe(ROOM_ID);
    expect(e.loserId).toBe(P1);
    expect(e.outcome).toBe("P2_WIN");
    expect(typeof e.durationMs).toBe("number");
  });

  it("forfeit clears room state", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.forfeit(ROOM_ID, P1);
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
    expect(service.hasRoom(ROOM_ID)).toBe(false);
  });

  // ── stamina tick ───────────────────────────────────────────────────────────

  it("stamina decrements by 1000 ms per second", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const before = service.getSnapshot(ROOM_ID)!.playerStates[P1]!.stamina;

    vi.advanceTimersByTime(3000);

    const after = service.getSnapshot(ROOM_ID)!.playerStates[P1]!.stamina;
    expect(after).toBe(before - 3000);
  });

  it("stamina reaching zero fires match_ended { loserId = activePlayer }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    // Advance past the full 5-minute stamina
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    expect(ended).toHaveLength(1);
    const e = ended[0] as { loserId: string; outcome: string };
    expect(e.loserId).toBe(P1); // P1 is active at match start
    expect(e.outcome).toBe("P2_WIN");
  });

  it("stamina only ticks for the active player", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    vi.advanceTimersByTime(5000);
    const snap = service.getSnapshot(ROOM_ID)!;
    // P2 stamina should be unchanged (P1 is active)
    expect(snap.playerStates[P2]!.stamina).toBe(5 * 60 * 1000);
    expect(snap.playerStates[P1]!.stamina).toBe(5 * 60 * 1000 - 5000);
  });

  // ── cleanup ────────────────────────────────────────────────────────────────

  it("cleanup removes state and is idempotent", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.cleanup(ROOM_ID);
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
    service.cleanup(ROOM_ID); // should not throw
  });

  // ── defaultPlayerState ────────────────────────────────────────────────────

  it("defaultPlayerState has expected values", () => {
    const ps = defaultPlayerState();
    expect(ps.health).toBe(100);
    expect(ps.mana).toBe(100);
    expect(ps.stamina).toBe(5 * 60 * 1000);
  });
});
