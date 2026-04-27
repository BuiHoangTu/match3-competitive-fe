import { describe, it, expect } from "vitest";
import {
  applyGravityWithMovements,
  resolveBoardAnimated,
  resolveBoard,
} from "../engine/MatchEngine.js";
import { createRng } from "../engine/rng.js";

describe("applyGravityWithMovements", () => {
  it("reports no movements when board is already settled", () => {
    const grid = [
      [1, 2],
      [3, 4],
    ];
    const { newGrid, movements } = applyGravityWithMovements(grid);
    expect(movements).toHaveLength(0);
    expect(newGrid).toEqual(grid);
  });

  it("records a tile falling one row", () => {
    const grid = [
      [1, -1],
      [-1, 2],
    ];
    const { newGrid, movements } = applyGravityWithMovements(grid);
    expect(newGrid[0][0]).toBe(-1);
    expect(newGrid[1][0]).toBe(1);
    expect(movements).toContainEqual({ col: 0, fromRow: 0, toRow: 1 });
  });

  it("fromRow is always less than toRow (tiles only fall down)", () => {
    const grid = [
      [0, -1, 2],
      [-1, 1, -1],
      [3, -1, 4],
    ];
    const { movements } = applyGravityWithMovements(grid);
    for (const m of movements) {
      expect(m.fromRow).toBeLessThan(m.toRow);
    }
  });

  it("does not emit a movement for a tile that stays in place", () => {
    const grid = [
      [-1, 0],
      [1, 2],
    ];
    const { movements } = applyGravityWithMovements(grid);
    // Only col 0, row 1 tile (sym=1) stays. col 0, row 0 tile is empty.
    // No tile in col 0 moves. col 1 has no -1 cells, so no movements.
    expect(movements).toHaveLength(0);
  });

  it("handles multiple tiles falling in the same column", () => {
    // col 0: [A, -1, B, -1] → [-1, -1, A, B]
    const grid = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [-1, 0],
    ];
    const { newGrid, movements } = applyGravityWithMovements(grid);
    // col 0: A(row0)→row2, B(row2)→row3
    expect(newGrid[2][0]).toBe(0); // A lands at row 2
    expect(newGrid[3][0]).toBe(1); // B lands at row 3
    const col0Moves = movements.filter((m) => m.col === 0);
    expect(col0Moves).toHaveLength(2);
    const moveA = col0Moves.find((m) => m.fromRow === 0);
    expect(moveA).toEqual({ col: 0, fromRow: 0, toRow: 2 });
    const moveB = col0Moves.find((m) => m.fromRow === 2);
    expect(moveB).toEqual({ col: 0, fromRow: 2, toRow: 3 });
  });
});

describe("resolveBoardAnimated", () => {
  it("produces the same final grid as resolveBoard", () => {
    const seed = 99999;
    const rng1 = createRng(seed);
    const rng2 = createRng(seed);

    // A grid with a horizontal match
    const grid = [
      [0, 0, 0, 1, 2, 3, 4, 1],
      [1, 2, 3, 4, 1, 2, 3, 4],
      [2, 3, 4, 1, 2, 3, 4, 1],
      [3, 4, 1, 2, 3, 4, 1, 2],
      [4, 1, 2, 3, 4, 1, 2, 3],
      [1, 2, 3, 4, 1, 2, 3, 4],
      [2, 3, 4, 1, 2, 3, 4, 1],
      [3, 4, 1, 2, 3, 4, 1, 2],
    ];

    const { grid: finalA } = resolveBoard(grid, rng1);
    const { grid: finalB } = resolveBoardAnimated(grid, rng2);

    expect(finalA).toEqual(finalB);
  });

  it("each step's movements all have fromRow < toRow", () => {
    const rng = createRng(42);
    const grid = [
      [0, 0, 0, 1, 2, 3, 4, 1],
      [1, 2, 3, 4, 1, 2, 3, 4],
      [2, 3, 4, 1, 2, 3, 4, 1],
      [3, 4, 1, 2, 3, 4, 1, 2],
      [4, 1, 2, 3, 4, 1, 2, 3],
      [1, 2, 3, 4, 1, 2, 3, 4],
      [2, 3, 4, 1, 2, 3, 4, 1],
      [3, 4, 1, 2, 3, 4, 1, 2],
    ];

    const { steps } = resolveBoardAnimated(grid, rng);
    for (const step of steps) {
      for (const m of step.movements) {
        expect(m.fromRow).toBeLessThan(m.toRow);
      }
    }
  });

  it("newTilePositions matches cells that were -1 in afterGravity", () => {
    const rng = createRng(7);
    const grid = [
      [0, 0, 0, 1, 2, 3, 4, 1],
      [1, 2, 3, 4, 1, 2, 3, 4],
      [2, 3, 4, 1, 2, 3, 4, 1],
      [3, 4, 1, 2, 3, 4, 1, 2],
      [4, 1, 2, 3, 4, 1, 2, 3],
      [1, 2, 3, 4, 1, 2, 3, 4],
      [2, 3, 4, 1, 2, 3, 4, 1],
      [3, 4, 1, 2, 3, 4, 1, 2],
    ];

    const { steps } = resolveBoardAnimated(grid, rng);
    for (const step of steps) {
      const emptyInGravity: string[] = [];
      for (let r = 0; r < step.afterGravity.length; r++) {
        for (let c = 0; c < (step.afterGravity[r]?.length ?? 0); c++) {
          if (step.afterGravity[r][c] === -1) {
            emptyInGravity.push(`${r},${c}`);
          }
        }
      }
      const newPositionKeys = step.newTilePositions.map(
        (p) => `${p.row},${p.col}`
      );
      expect(newPositionKeys.sort()).toEqual(emptyInGravity.sort());
    }
  });
});
