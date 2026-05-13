import { describe, it, expect } from "vitest";
import {
  findMatches,
  removeMatches,
  applyGravity,
  refill,
  resolveBoard,
} from "../engine/MatchEngine.js";
import { createRng } from "../engine/rng.js";

// Helper to build a grid from a flat row-major array
function makeGrid(rows: number, cols: number, values: number[]): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(values.slice(r * cols, r * cols + cols));
  }
  return grid;
}

describe("findMatches", () => {
  it("detects a horizontal run of 3", () => {
    // Row 0: [0,0,0,1,2,3,4,1]
    const grid = makeGrid(8, 8, [
      0, 0, 0, 1, 2, 3, 4, 1,
      1, 2, 3, 4, 1, 2, 3, 4,
      1, 2, 3, 4, 1, 2, 3, 4,
      1, 2, 3, 4, 1, 2, 3, 4,
      1, 2, 3, 4, 1, 2, 3, 4,
      1, 2, 3, 4, 1, 2, 3, 4,
      1, 2, 3, 4, 1, 2, 3, 4,
      1, 2, 3, 4, 1, 2, 3, 4,
    ]);
    const matches = findMatches(grid);
    expect(matches.length).toBeGreaterThan(0);
    const allCells = matches.flatMap((m) => m.cells);
    // All three cells of the horizontal run should be captured
    expect(allCells).toContainEqual([0, 0]);
    expect(allCells).toContainEqual([0, 1]);
    expect(allCells).toContainEqual([0, 2]);
  });

  it("detects a vertical run of 3", () => {
    // Col 0: rows 0,1,2 = symbol 2
    const grid = makeGrid(8, 8, [
      2, 1, 3, 4, 0, 1, 2, 3,
      2, 3, 1, 0, 4, 2, 3, 1,
      2, 4, 0, 1, 3, 4, 1, 2,
      1, 2, 4, 3, 1, 0, 4, 3,
      3, 1, 2, 0, 4, 3, 0, 4,
      4, 0, 3, 2, 0, 1, 4, 0,
      0, 3, 1, 4, 2, 3, 0, 1,
      1, 4, 2, 1, 3, 4, 1, 2,
    ]);
    const matches = findMatches(grid);
    expect(matches.length).toBeGreaterThan(0);
    const allCells = matches.flatMap((m) => m.cells);
    expect(allCells).toContainEqual([0, 0]);
    expect(allCells).toContainEqual([1, 0]);
    expect(allCells).toContainEqual([2, 0]);
  });

  it("returns no matches for a clean board", () => {
    // Checkerboard-like pattern — no 3-in-a-row
    const grid = makeGrid(4, 4, [
      0, 1, 0, 1,
      2, 3, 2, 3,
      0, 1, 0, 1,
      2, 3, 2, 3,
    ]);
    expect(findMatches(grid)).toHaveLength(0);
  });

  it("merges overlapping horizontal and vertical runs into one match", () => {
    // Cross pattern at (1,1): row 1 = [0,0,0,0,...], col 1 = [0,0,0,0,...]
    const grid = makeGrid(5, 5, [
      1, 0, 1, 2, 3,
      0, 0, 0, 2, 1,
      1, 0, 2, 1, 3,
      2, 1, 3, 0, 2,
      3, 2, 1, 3, 0,
    ]);
    const matches = findMatches(grid);
    // The cross cells should be in a single merged match group
    const allCells = matches.flatMap((m) => m.cells);
    // H run: (1,0),(1,1),(1,2) and V run: (0,1),(1,1),(2,1) share (1,1)
    expect(allCells).toContainEqual([1, 0]);
    expect(allCells).toContainEqual([1, 1]);
    expect(allCells).toContainEqual([1, 2]);
    expect(allCells).toContainEqual([0, 1]);
    expect(allCells).toContainEqual([2, 1]);
    // They should all be in the same match group
    const crossCells: Array<[number, number]> = [
      [1, 0], [1, 1], [1, 2], [0, 1], [2, 1],
    ];
    const matchContainingAll = matches.find((m) =>
      crossCells.every((cc) =>
        m.cells.some(([r, c]) => r === cc[0] && c === cc[1])
      )
    );
    expect(matchContainingAll).toBeDefined();
  });
});

describe("removeMatches", () => {
  it("sets matched cells to -1", () => {
    const grid = makeGrid(3, 3, [
      0, 0, 0,
      1, 2, 1,
      2, 1, 2,
    ]);
    const matches = findMatches(grid);
    expect(matches.length).toBeGreaterThan(0);
    const removed = removeMatches(grid, matches);
    expect(removed[0][0]).toBe(-1);
    expect(removed[0][1]).toBe(-1);
    expect(removed[0][2]).toBe(-1);
    // Non-matched cells untouched
    expect(removed[1][0]).toBe(1);
  });

  it("does not mutate the input grid", () => {
    const grid = makeGrid(3, 3, [
      0, 0, 0,
      1, 2, 1,
      2, 1, 2,
    ]);
    const matches = findMatches(grid);
    removeMatches(grid, matches);
    expect(grid[0][0]).toBe(0);
  });
});

describe("applyGravity", () => {
  it("tiles fall down, -1 floats to top", () => {
    const grid = [
      [-1, -1],
      [3,  -1],
      [1,   2],
    ];
    const result = applyGravity(grid);
    // Col 0: [3, 1] should be at bottom; top row = -1
    expect(result[2][0]).toBe(1);
    expect(result[1][0]).toBe(3);
    expect(result[0][0]).toBe(-1);
    // Col 1: only 2 is real
    expect(result[2][1]).toBe(2);
    expect(result[1][1]).toBe(-1);
    expect(result[0][1]).toBe(-1);
  });

  it("does not mutate the input grid", () => {
    const grid = [[-1], [5]];
    applyGravity(grid);
    expect(grid[0][0]).toBe(-1);
    expect(grid[1][0]).toBe(5);
  });
});

describe("refill", () => {
  it("fills all -1 cells with valid symbols", () => {
    const grid = [
      [-1, 1, -1],
      [2, -1, 3],
      [-1, 4, -1],
    ];
    const rng = createRng(7);
    const result = refill(grid, rng);
    for (const row of result) {
      for (const cell of row) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThanOrEqual(4);
      }
    }
    // Non-empty cells are unchanged
    expect(result[0][1]).toBe(1);
    expect(result[1][0]).toBe(2);
    expect(result[1][2]).toBe(3);
    expect(result[2][1]).toBe(4);
  });

  it("does not mutate the input grid", () => {
    const grid = [[-1, -1], [-1, -1]];
    const rng = createRng(1);
    refill(grid, rng);
    expect(grid[0][0]).toBe(-1);
  });

  it("consumes generated tiles column-left, then bottom-to-top", () => {
    const grid = [
      [-1, -1, 9],
      [-1, 8, -1],
    ];
    let next = 0;
    const result = refill(grid, () => (next++ + 0.01) / 5);

    expect(result).toEqual([
      [1, 2, 9],
      [0, 8, 3],
    ]);
  });
});

describe("resolveBoard", () => {
  it("terminates with no matches remaining", () => {
    // Board with an obvious match
    const grid = makeGrid(4, 4, [
      0, 0, 0, 1,
      1, 2, 3, 2,
      2, 3, 1, 3,
      3, 1, 2, 0,
    ]);
    const rng = createRng(42);
    const { grid: final } = resolveBoard(grid, rng);
    expect(findMatches(final)).toHaveLength(0);
  });

  it("records at least one step when there are matches", () => {
    const grid = makeGrid(4, 4, [
      0, 0, 0, 1,
      1, 2, 3, 2,
      2, 3, 1, 3,
      3, 1, 2, 0,
    ]);
    const rng = createRng(42);
    const { steps } = resolveBoard(grid, rng);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("each step has afterGravity and afterRefill grids", () => {
    const grid = makeGrid(4, 4, [
      0, 0, 0, 1,
      1, 2, 3, 2,
      2, 3, 1, 3,
      3, 1, 2, 0,
    ]);
    const rng = createRng(42);
    const { steps } = resolveBoard(grid, rng);
    for (const step of steps) {
      expect(step.matches.length).toBeGreaterThan(0);
      expect(step.afterGravity).toBeDefined();
      expect(step.afterRefill).toBeDefined();
    }
  });

  it("returns empty steps for a board with no matches", () => {
    const grid = makeGrid(4, 4, [
      0, 1, 0, 1,
      2, 3, 2, 3,
      0, 1, 0, 1,
      2, 3, 2, 3,
    ]);
    const rng = createRng(1);
    const { steps } = resolveBoard(grid, rng);
    expect(steps).toHaveLength(0);
  });

  it("cascade: second step can also produce matches", () => {
    // Craft a board where clearing row 0 causes row 1 to cascade
    // Row 0: [0,0,0,0] — horizontal match
    // After gravity, row 1 tiles fall, potentially creating new matches
    // We test that resolveBoard handles multiple steps
    const grid = makeGrid(5, 5, [
      0, 0, 0, 0, 0,
      1, 2, 3, 4, 1,
      2, 3, 4, 1, 2,
      3, 4, 1, 2, 3,
      4, 1, 2, 3, 4,
    ]);
    const rng = createRng(99);
    const { grid: final, steps } = resolveBoard(grid, rng);
    // Should have resolved at least one step
    expect(steps.length).toBeGreaterThanOrEqual(1);
    // Final board should have no matches
    expect(findMatches(final)).toHaveLength(0);
  });
});
