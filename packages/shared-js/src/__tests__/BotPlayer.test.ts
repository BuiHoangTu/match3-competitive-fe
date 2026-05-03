/**
 * BotPlayer unit tests.
 *
 * FR-6 — Bot opponent must only submit legal swaps, prefer swaps that clear
 * more tiles, and always return within a bounded time.
 * NFR-5 — No Math.random; BotPlayer operates on a given grid deterministically.
 */
import { describe, it, expect } from "vitest";
import { BotPlayer } from "../bot/BotPlayer.js";
import { createBoard } from "../engine/Board.js";
import { findMatches } from "../engine/MatchEngine.js";

function applySwap(
  grid: number[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number
): number[][] {
  const copy = grid.map((row) => [...row]);
  const tmp = copy[r1][c1];
  copy[r1][c1] = copy[r2][c2];
  copy[r2][c2] = tmp;
  return copy;
}

describe("BotPlayer.findBestMove (FR-6)", () => {
  const bot = new BotPlayer();

  it("returns a non-null move on a fresh 8×8 board (boards always have valid swaps)", () => {
    const board = createBoard(42);
    const move = bot.findBestMove(board.grid);
    expect(move).not.toBeNull();
  });

  it("FR-6: returned move is a legal adjacent swap (not diagonal, not same-cell)", () => {
    for (const seed of [1, 42, 100, 999, 12345]) {
      const board = createBoard(seed);
      const move = bot.findBestMove(board.grid);
      expect(move).not.toBeNull();
      if (!move) continue;
      const dr = Math.abs(move.r2 - move.r1);
      const dc = Math.abs(move.c2 - move.c1);
      expect((dr === 1 && dc === 0) || (dr === 0 && dc === 1)).toBe(true);
    }
  });

  it("FR-6: returned move produces at least one match when applied", () => {
    for (const seed of [1, 42, 100, 999, 12345]) {
      const board = createBoard(seed);
      const move = bot.findBestMove(board.grid);
      expect(move).not.toBeNull();
      if (!move) continue;
      const after = applySwap(board.grid, move.r1, move.c1, move.r2, move.c2);
      expect(findMatches(after).length).toBeGreaterThan(0);
    }
  });

  it("FR-6: move coordinates are within board bounds (0–7)", () => {
    for (const seed of [7, 77, 777]) {
      const board = createBoard(seed);
      const move = bot.findBestMove(board.grid);
      expect(move).not.toBeNull();
      if (!move) continue;
      expect(move.r1).toBeGreaterThanOrEqual(0);
      expect(move.r1).toBeLessThanOrEqual(7);
      expect(move.c1).toBeGreaterThanOrEqual(0);
      expect(move.c1).toBeLessThanOrEqual(7);
      expect(move.r2).toBeGreaterThanOrEqual(0);
      expect(move.r2).toBeLessThanOrEqual(7);
      expect(move.c2).toBeGreaterThanOrEqual(0);
      expect(move.c2).toBeLessThanOrEqual(7);
    }
  });

  it("FR-6: bot prefers a move that clears more cells over one that clears fewer", () => {
    // Hand-crafted 3×5 grid (no pre-existing matches) with two distinct matching
    // swaps of different scores:
    //
    //   row 0: [1, 1, 0, 1, 1]
    //   row 1: [0, 0, 4, 0, 0]
    //   row 2: [2, 3, 2, 3, 2]
    //
    // Swap A — (0,1)↔(0,2): row 0 becomes [1,0,1,1,1] → 3-run of 1 at cols 2–4.
    //   Score = 3 cells cleared.
    //
    // Swap B — (0,2)↔(1,2): row 1 becomes [0,0,0,0,0] → 5-run of 0.
    //   Score = 5 cells cleared.
    //
    // Bot must pick swap B (FR-6: SHOULD prefer more cells cleared).
    const grid = [
      [1, 1, 0, 1, 1],
      [0, 0, 4, 0, 0],
      [2, 3, 2, 3, 2],
    ];

    // Guard: no pre-existing matches (would invalidate the grid design).
    expect(findMatches(grid).length).toBe(0);

    // Confirm swap A yields exactly 3.
    const afterSwapA = applySwap(grid, 0, 1, 0, 2);
    const scoreA = findMatches(afterSwapA).reduce((acc, m) => acc + m.cells.length, 0);
    expect(scoreA).toBe(3);

    // Confirm swap B yields exactly 5.
    const afterSwapB = applySwap(grid, 0, 2, 1, 2);
    const scoreB = findMatches(afterSwapB).reduce((acc, m) => acc + m.cells.length, 0);
    expect(scoreB).toBe(5);

    // Bot must return the higher-scoring swap.
    const move = bot.findBestMove(grid);
    expect(move).not.toBeNull();
    if (!move) return;
    const botScore = findMatches(
      applySwap(grid, move.r1, move.c1, move.r2, move.c2)
    ).reduce((acc, m) => acc + m.cells.length, 0);
    expect(botScore).toBe(scoreB); // must pick the 5-cell option, not the 3-cell one
  });

  it("returns null only when there are no adjacent cell pairs to swap", () => {
    // A 1×1 grid has no adjacent pairs at all, so both bestMove and
    // firstValidMove remain null — the only case the bot returns null.
    const singleCell: number[][] = [[0]];
    const result = bot.findBestMove(singleCell);
    expect(result).toBeNull();
  });

  it("NFR-5: findBestMove is deterministic — same grid always returns same move", () => {
    const board = createBoard(123);
    const m1 = bot.findBestMove(board.grid);
    const m2 = bot.findBestMove(board.grid);
    expect(m1).toEqual(m2);
  });

  it("does not mutate the input grid", () => {
    const board = createBoard(7);
    const gridCopy = board.grid.map((row) => [...row]);
    bot.findBestMove(board.grid);
    expect(board.grid).toEqual(gridCopy);
  });
});
