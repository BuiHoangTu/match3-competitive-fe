import { describe, it, expect } from "vitest";
import { extraTurnsFromMatches, type Match } from "../MatchEngine.js";

function match(cells: [number, number][]): Match {
  return { cells };
}

describe("extraTurnsFromMatches (CR-9)", () => {
  it("empty matches → 0", () => {
    expect(extraTurnsFromMatches([])).toBe(0);
  });

  it("single 3-line match → 0", () => {
    const m = match([
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(0);
  });

  it("single 4-line horizontal match → 1", () => {
    const m = match([
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(1);
  });

  it("single 5-line in one row → 1 (not 2)", () => {
    const m = match([
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
      [3, 4],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(1);
  });

  it("two parallel 4-lines (two separate Match objects) → 2", () => {
    const m1 = match([
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    const m2 = match([
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
    ]);
    expect(extraTurnsFromMatches([m1, m2])).toBe(2);
  });

  it("L of two 3-legs sharing one corner → 0", () => {
    // Row leg cells (2,2) (2,3) (2,4)  +  column leg (2,2) (3,2) (4,2)
    // Shared corner at (2,2). Row count: 3 cells in row 2 (col 2,3,4).
    // Column count: 3 cells in col 2 (row 2,3,4). Both shy of 4.
    const m = match([
      [2, 2],
      [2, 3],
      [2, 4],
      [3, 2],
      [4, 2],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(0);
  });

  it("L where row leg is 4 and column leg is 3 → 1", () => {
    // Row 2 cols 2,3,4,5 (4 cells in row 2). Column 2 rows 2,3,4 (3 cells in col 2).
    const m = match([
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [3, 2],
      [4, 2],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(1);
  });

  it("L where both legs are 4+ → 2", () => {
    // Row 2 cols 2,3,4,5 (4 in row). Column 2 rows 2,3,4,5 (4 in col).
    const m = match([
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [3, 2],
      [4, 2],
      [5, 2],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(2);
  });

  it("vertical-only 4-line → 1", () => {
    const m = match([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(extraTurnsFromMatches([m])).toBe(1);
  });

  it("3-line plus a separate 4-line → 1", () => {
    const three = match([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    const four = match([
      [5, 0],
      [5, 1],
      [5, 2],
      [5, 3],
    ]);
    expect(extraTurnsFromMatches([three, four])).toBe(1);
  });
});
