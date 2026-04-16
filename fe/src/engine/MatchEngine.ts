import { randInt } from "./rng.js";

// Number of distinct symbol types on the board (must match Board.ts)
const NUM_SYMBOLS = 5;

export interface Match {
  cells: [number, number][];
}

export interface ResolveStep {
  matches: Match[];
  afterGravity: number[][];
  afterRefill: number[][];
}

// ---------------------------------------------------------------------------
// A4 — Match detection
// ---------------------------------------------------------------------------

/**
 * Finds all horizontal and vertical runs of 3+ matching (non-negative) tiles.
 * Overlapping cells are merged into a single Match group.
 */
export function findMatches(grid: number[][]): Match[] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  // Collect individual runs as sets of cell keys
  const runs: Set<string>[] = [];

  function cellKey(r: number, c: number): string {
    return `${r},${c}`;
  }

  // Horizontal runs
  for (let r = 0; r < height; r++) {
    let c = 0;
    while (c < width) {
      const sym = grid[r][c];
      if (sym < 0) {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < width && grid[r][end] === sym) end++;
      if (end - c >= 3) {
        const cells = new Set<string>();
        for (let k = c; k < end; k++) cells.add(cellKey(r, k));
        runs.push(cells);
      }
      c = end;
    }
  }

  // Vertical runs
  for (let c = 0; c < width; c++) {
    let r = 0;
    while (r < height) {
      const sym = grid[r][c];
      if (sym < 0) {
        r++;
        continue;
      }
      let end = r + 1;
      while (end < height && grid[end][c] === sym) end++;
      if (end - r >= 3) {
        const cells = new Set<string>();
        for (let k = r; k < end; k++) cells.add(cellKey(k, c));
        runs.push(cells);
      }
      r = end;
    }
  }

  if (runs.length === 0) return [];

  // Merge overlapping runs using union-find on the runs array
  const parent = runs.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Build a map from cell key → run indices that contain it
  const cellToRuns = new Map<string, number[]>();
  for (let i = 0; i < runs.length; i++) {
    for (const key of runs[i]) {
      const arr = cellToRuns.get(key);
      if (arr) {
        arr.push(i);
      } else {
        cellToRuns.set(key, [i]);
      }
    }
  }

  // Union any runs sharing a cell
  for (const indices of cellToRuns.values()) {
    for (let k = 1; k < indices.length; k++) {
      union(indices[0], indices[k]);
    }
  }

  // Aggregate merged groups
  const groups = new Map<number, Set<string>>();
  for (let i = 0; i < runs.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      for (const key of runs[i]) group.add(key);
    } else {
      groups.set(root, new Set(runs[i]));
    }
  }

  return Array.from(groups.values()).map((cellSet) => ({
    cells: Array.from(cellSet).map((key) => {
      const [r, c] = key.split(",").map(Number);
      return [r, c] as [number, number];
    }),
  }));
}

// ---------------------------------------------------------------------------
// A5 — Gravity + refill
// ---------------------------------------------------------------------------

/**
 * Sets matched cells to -1 (empty). Returns a new grid.
 */
export function removeMatches(
  grid: number[][],
  matches: Match[]
): number[][] {
  const newGrid = grid.map((row) => [...row]);
  for (const match of matches) {
    for (const [r, c] of match.cells) {
      newGrid[r][c] = -1;
    }
  }
  return newGrid;
}

/**
 * Applies gravity: in each column, tiles fall down so -1 cells float to the top.
 * Returns a new grid.
 */
export function applyGravity(grid: number[][]): number[][] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const newGrid = grid.map((row) => [...row]);

  for (let c = 0; c < width; c++) {
    // Collect non-empty tiles from bottom to top
    const tiles: number[] = [];
    for (let r = height - 1; r >= 0; r--) {
      if (newGrid[r][c] >= 0) tiles.push(newGrid[r][c]);
    }
    // Fill column from bottom: real tiles first, then -1 at top
    for (let r = height - 1; r >= 0; r--) {
      const idx = height - 1 - r;
      newGrid[r][c] = idx < tiles.length ? tiles[idx] : -1;
    }
  }
  return newGrid;
}

/**
 * Replaces all -1 cells with new random tiles using the provided RNG.
 * Returns a new grid.
 */
export function refill(grid: number[][], rng: () => number): number[][] {
  const newGrid = grid.map((row) =>
    row.map((cell) => (cell === -1 ? randInt(rng, 0, NUM_SYMBOLS - 1) : cell))
  );
  return newGrid;
}

// ---------------------------------------------------------------------------
// A6 — Cascade resolver
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 20;

/**
 * Resolves cascades on the board until no matches remain.
 * Returns the final grid and a log of each resolution step.
 */
export function resolveBoard(
  grid: number[][],
  rng: () => number
): { grid: number[][]; steps: ResolveStep[] } {
  const steps: ResolveStep[] = [];
  let current = grid.map((row) => [...row]);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const removed = removeMatches(current, matches);
    const afterGravity = applyGravity(removed);
    const afterRefill = refill(afterGravity, rng);

    steps.push({ matches, afterGravity, afterRefill });
    current = afterRefill;
  }

  return { grid: current, steps };
}
