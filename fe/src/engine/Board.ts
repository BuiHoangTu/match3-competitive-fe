import { createRng, randInt } from "./rng.js";

export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;
export const NUM_SYMBOLS = 5;

export interface Board {
  grid: number[][];
  width: number;
  height: number;
}

/**
 * Deep-copies a 2D grid.
 */
function copyGrid(grid: number[][]): number[][] {
  return grid.map((row) => [...row]);
}

/**
 * Fills the grid using seeded RNG so that there are no initial matches.
 */
function fillNoMatches(
  grid: number[][],
  rng: () => number,
  width: number,
  height: number
): void {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let symbol = 0;
      let attempts = 0;
      do {
        symbol = randInt(rng, 0, NUM_SYMBOLS - 1);
        grid[r][c] = symbol;
        attempts++;
        // Safety: if we can't find a non-matching symbol, just accept it
        if (attempts > NUM_SYMBOLS * 2) break;
      } while (
        (c >= 2 && grid[r][c - 1] === symbol && grid[r][c - 2] === symbol) ||
        (r >= 2 && grid[r - 1][c] === symbol && grid[r - 2][c] === symbol)
      );
    }
  }
}

/**
 * Creates a new Board with a seeded random fill that has no initial matches.
 */
export function createBoard(seed: number): Board {
  const rng = createRng(seed);
  const grid: number[][] = Array.from({ length: BOARD_HEIGHT }, () =>
    new Array(BOARD_WIDTH).fill(0)
  );
  fillNoMatches(grid, rng, BOARD_WIDTH, BOARD_HEIGHT);
  return { grid, width: BOARD_WIDTH, height: BOARD_HEIGHT };
}

/**
 * Swaps two adjacent tiles and returns a new immutable Board.
 * Throws if the positions are not adjacent.
 */
export function swapTiles(
  board: Board,
  r1: number,
  c1: number,
  r2: number,
  c2: number
): Board {
  const dr = Math.abs(r1 - r2);
  const dc = Math.abs(c1 - c2);
  const isAdjacent = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
  if (!isAdjacent) {
    throw new Error(
      `Tiles at (${r1},${c1}) and (${r2},${c2}) are not adjacent`
    );
  }
  const newGrid = copyGrid(board.grid);
  const tmp = newGrid[r1][c1];
  newGrid[r1][c1] = newGrid[r2][c2];
  newGrid[r2][c2] = tmp;
  return { grid: newGrid, width: board.width, height: board.height };
}
