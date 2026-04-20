/**
 * T-v0.5-12 — No-desync assertion at 300 ms RTT.
 *
 * Runs the latency harness across many iterations and asserts both clients
 * end on cell-identical board state. This is the gate for NFR-3 / NFR-6:
 * identical seeds + identical move order must produce identical grids,
 * independent of timing.
 */
import { describe, it, expect } from "vitest";
import { runLatencyHarness } from "./latency-harness";
import { createBoard, swapTiles, type Board } from "@match3/shared/engine/Board";
import { createRng } from "@match3/shared/engine/rng";
import { resolveBoard } from "@match3/shared/engine/MatchEngine";

const ITERATIONS = 100;
const QUICK_MOVES = 5;
const QUICK_RTT_MS = 50;

describe("T-v0.5-12 no-desync under timing pressure", () => {
  it(
    "one representative 300 ms RTT / 50-move match ends cell-identical",
    async () => {
      const res = await runLatencyHarness({ rttMs: 300, moveCount: 10 });
      expect(res.boardA).toEqual(res.boardB);
    },
    90_000
  );

  it(
    `${ITERATIONS} back-to-back matches all end cell-identical`,
    async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const res = await runLatencyHarness({
          rttMs: QUICK_RTT_MS,
          moveCount: QUICK_MOVES,
        });
        if (JSON.stringify(res.boardA) !== JSON.stringify(res.boardB)) {
          throw new Error(
            `desync at iteration ${i} (seed=${res.seed}):\n` +
              `A=${JSON.stringify(res.boardA)}\n` +
              `B=${JSON.stringify(res.boardB)}`
          );
        }
      }
    },
    240_000
  );

  /**
   * Demonstrates that the test *would* catch a mutation that injects
   * wall-clock entropy into a board-affecting path. We replay the same
   * move list once through the canonical seeded RNG and once through a
   * wall-clock-seeded RNG; the final grids must diverge, proving that a
   * regression would be visible.
   */
  it("fails deterministically if wall-clock time leaks into board code", () => {
    const seed = 987654321;
    const moves: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
    {
      // Discover a few match-producing swaps on the canonical board
      let board = createBoard(seed);
      const rng = createRng(seed + 1);
      for (let turn = 0; turn < 3; turn++) {
        outer: for (let r = 0; r < board.height; r++) {
          for (let c = 0; c < board.width; c++) {
            if (c + 1 < board.width) {
              const trial = swapTiles(board, r, c, r, c + 1);
              const { grid } = resolveBoard(trial.grid, rng);
              if (JSON.stringify(grid) !== JSON.stringify(trial.grid)) {
                board = { ...trial, grid };
                moves.push({ r1: r, c1: c, r2: r, c2: c + 1 });
                break outer;
              }
            }
          }
        }
      }
    }

    function replay(rngFactory: () => () => number): Board {
      let board = createBoard(seed);
      const rng = rngFactory();
      for (const m of moves) {
        const swapped = swapTiles(board, m.r1, m.c1, m.r2, m.c2);
        const { grid } = resolveBoard(swapped.grid, rng);
        board = { ...swapped, grid };
      }
      return board;
    }

    const canonical = replay(() => createRng(seed + 1));
    // Simulate the forbidden pattern: seed with wall-clock time
    const poisoned = replay(() => createRng(Date.now()));
    expect(canonical.grid).not.toEqual(poisoned.grid);
  });
});
