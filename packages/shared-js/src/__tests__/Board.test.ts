import { describe, it, expect } from "vitest";
import { createBoard, swapTiles } from "../engine/Board.js";
import { findMatches } from "../engine/MatchEngine.js";

describe("createBoard", () => {
  it("produces an 8x8 grid", () => {
    const board = createBoard(1);
    expect(board.height).toBe(8);
    expect(board.width).toBe(8);
    expect(board.grid.length).toBe(8);
    expect(board.grid[0].length).toBe(8);
  });

  it("all cells are valid symbol indices (0–4)", () => {
    const board = createBoard(42);
    for (const row of board.grid) {
      for (const cell of row) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThanOrEqual(4);
      }
    }
  });

  it("has no initial matches", () => {
    for (const seed of [1, 2, 3, 42, 100, 999]) {
      const board = createBoard(seed);
      const matches = findMatches(board.grid);
      expect(matches.length).toBe(0);
    }
  });

  it("same seed produces same board", () => {
    const b1 = createBoard(55);
    const b2 = createBoard(55);
    expect(b1.grid).toEqual(b2.grid);
  });

  it("different seeds produce different boards", () => {
    const b1 = createBoard(1);
    const b2 = createBoard(2);
    expect(b1.grid).not.toEqual(b2.grid);
  });
});

describe("swapTiles", () => {
  it("swaps two horizontally adjacent tiles", () => {
    const board = createBoard(1);
    const valA = board.grid[0][0];
    const valB = board.grid[0][1];
    const swapped = swapTiles(board, 0, 0, 0, 1);
    expect(swapped.grid[0][0]).toBe(valB);
    expect(swapped.grid[0][1]).toBe(valA);
  });

  it("swaps two vertically adjacent tiles", () => {
    const board = createBoard(1);
    const valA = board.grid[3][3];
    const valB = board.grid[4][3];
    const swapped = swapTiles(board, 3, 3, 4, 3);
    expect(swapped.grid[3][3]).toBe(valB);
    expect(swapped.grid[4][3]).toBe(valA);
  });

  it("does not mutate the original board", () => {
    const board = createBoard(1);
    const originalVal = board.grid[0][0];
    swapTiles(board, 0, 0, 0, 1);
    expect(board.grid[0][0]).toBe(originalVal);
  });

  it("throws for non-adjacent tiles (diagonal)", () => {
    const board = createBoard(1);
    expect(() => swapTiles(board, 0, 0, 1, 1)).toThrow();
  });

  it("throws for non-adjacent tiles (same row, gap)", () => {
    const board = createBoard(1);
    expect(() => swapTiles(board, 0, 0, 0, 2)).toThrow();
  });

  it("throws for non-adjacent tiles (same col, gap)", () => {
    const board = createBoard(1);
    expect(() => swapTiles(board, 0, 0, 2, 0)).toThrow();
  });
});
