import { findMatches } from "../engine/MatchEngine.js";

export class BotPlayer {
  findBestMove(
    grid: number[][]
  ): { r1: number; c1: number; r2: number; c2: number } | null {
    const rows = grid.length;
    const cols = rows > 0 ? (grid[0]?.length ?? 0) : 0;

    let bestMove: { r1: number; c1: number; r2: number; c2: number } | null =
      null;
    let bestScore = 0;
    let firstValidMove: {
      r1: number;
      c1: number;
      r2: number;
      c2: number;
    } | null = null;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const neighbors: [number, number][] = [];
        if (c + 1 < cols) neighbors.push([r, c + 1]);
        if (r + 1 < rows) neighbors.push([r + 1, c]);

        for (const [r2, c2] of neighbors) {
          if (!firstValidMove) firstValidMove = { r1: r, c1: c, r2, c2 };

          const copy = grid.map((row) => [...row]);
          const tmp = copy[r][c];
          copy[r][c] = copy[r2][c2];
          copy[r2][c2] = tmp;

          const matches = findMatches(copy);
          if (matches.length === 0) continue;

          const score = matches.reduce((s, m) => s + m.cells.length, 0);
          if (score > bestScore) {
            bestScore = score;
            bestMove = { r1: r, c1: c, r2, c2 };
          }
        }
      }
    }

    return bestMove ?? firstValidMove;
  }
}
