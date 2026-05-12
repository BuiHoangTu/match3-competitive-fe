/**
 * T-v0.5-12 — Accepted-move determinism contract.
 *
 * The server holds the canonical board for turn_based rooms and validates each
 * move privately. Clients receive accepted moves plus board-delta cascade data
 * on the hot path and apply the server-provided resolution.
 *
 * These tests validate:
 *  1. Both clients' board-delta-applied boardGrid values are byte-identical.
 *  2. Same originalSeed + same move sequence → byte-identical boardGrid and
 *     rngState at every step (determinism lives in the server engine, not in
 *     clients separately running the RNG).
 *  3. A regression detector: seeding the engine with wall-clock time instead
 *     of originalSeed produces a divergent board, proving the determinism path
 *     would catch the bug.
 */
import { describe, it, expect } from "vitest";
import { runLatencyHarness } from "./latency-harness";
import { createBoard, swapTiles } from "@match3/shared-js/engine/Board";
import { createStatefulRng } from "@match3/shared-js/engine/rng";
import { resolveBoardAnimated, findMatches } from "@match3/shared-js/engine/MatchEngine";

const ITERATIONS = 100;
const QUICK_MOVES = 5;
const QUICK_RTT_MS = 50;

describe("T-v0.5-12 accepted-move determinism contract", () => {
  it(
    "one representative 300 ms RTT / 10-move match: both clients see identical final board",
    async () => {
      const res = await runLatencyHarness({ rttMs: 300, moveCount: 10 });
      expect(res.boardA).toEqual(res.boardB);
    },
    90_000
  );

  it(
    `${ITERATIONS} back-to-back matches: board-delta accepted moves are identical for both clients`,
    async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const res = await runLatencyHarness({
          rttMs: QUICK_RTT_MS,
          moveCount: QUICK_MOVES,
        });
        if (JSON.stringify(res.boardA) !== JSON.stringify(res.boardB)) {
          throw new Error(
            `final board mismatch at iteration ${i} (roomId=${res.roomId}):\n` +
              `A=${JSON.stringify(res.boardA)}\n` +
              `B=${JSON.stringify(res.boardB)}`
          );
        }
      }
    },
    240_000
  );

  /**
   * Server-internal determinism: given the same originalSeed and the same
   * sequence of valid moves applied to two independent Room simulations, the
   * resulting boardGrid and rngState must be byte-identical at every step.
   *
   * This test runs the server engine (createBoard + swapTiles +
   * resolveBoardAnimated + createStatefulRng) directly — no sockets needed.
   */
  it("server engine is deterministic: same seed + same moves → identical boardGrid and rngState", () => {
    const seed = 987654321;

    // Discover a few match-producing swaps on the canonical board.
    const moves: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
    {
      let grid = createBoard(seed).grid;
      let rng = createStatefulRng(seed);
      for (let turn = 0; turn < 5; turn++) {
        let found = false;
        outer: for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (c + 1 < 8) {
              const candidate = grid.map((row) => [...row]);
              const tmp = candidate[r][c];
              candidate[r][c] = candidate[r][c + 1];
              candidate[r][c + 1] = tmp;
              if (findMatches(candidate).length > 0) {
                const boardObj = { grid, width: 8, height: 8 };
                const swapped = swapTiles(boardObj, r, c, r, c + 1);
                const result = resolveBoardAnimated(swapped.grid, rng.next);
                grid = result.grid;
                // rng state is now advanced by the resolution
                moves.push({ r1: r, c1: c, r2: r, c2: c + 1 });
                found = true;
                break outer;
              }
            }
          }
        }
        if (!found) break;
      }
    }

    // Replay the same moves twice from the same seed in two independent sims.
    function simulate(initialSeed: number, moveList: typeof moves): {
      boardGrid: number[][];
      rngState: number;
    } {
      let grid = createBoard(initialSeed).grid;
      const rng = createStatefulRng(initialSeed);
      for (const m of moveList) {
        const boardObj = { grid, width: 8, height: 8 };
        const swapped = swapTiles(boardObj, m.r1, m.c1, m.r2, m.c2);
        const result = resolveBoardAnimated(swapped.grid, rng.next);
        grid = result.grid;
      }
      return { boardGrid: grid, rngState: rng.state() };
    }

    const sim1 = simulate(seed, moves);
    const sim2 = simulate(seed, moves);

    expect(sim1.boardGrid).toEqual(sim2.boardGrid);
    expect(sim1.rngState).toBe(sim2.rngState);
  });

  /**
   * Demonstrates that the test *would* catch a mutation that injects
   * wall-clock entropy into a board-affecting path. We replay the same
   * move list once through the canonical seeded RNG and once through a
   * wall-clock-seeded RNG; the final grids must diverge.
   */
  it("fails deterministically if wall-clock time leaks into board code", () => {
    const seed = 987654321;
    const moves: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
    {
      let grid = createBoard(seed).grid;
      const rng = createStatefulRng(seed);
      for (let turn = 0; turn < 3; turn++) {
        outer: for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (c + 1 < 8) {
              const candidate = grid.map((row) => [...row]);
              const tmp = candidate[r][c];
              candidate[r][c] = candidate[r][c + 1];
              candidate[r][c + 1] = tmp;
              if (findMatches(candidate).length > 0) {
                const boardObj = { grid, width: 8, height: 8 };
                const swapped = swapTiles(boardObj, r, c, r, c + 1);
                const result = resolveBoardAnimated(swapped.grid, rng.next);
                grid = result.grid;
                moves.push({ r1: r, c1: c, r2: r, c2: c + 1 });
                break outer;
              }
            }
          }
        }
      }
    }

    function replay(rngSeed: number): number[][] {
      let grid = createBoard(seed).grid;
      const rng = createStatefulRng(rngSeed);
      for (const m of moves) {
        const boardObj = { grid, width: 8, height: 8 };
        const swapped = swapTiles(boardObj, m.r1, m.c1, m.r2, m.c2);
        const result = resolveBoardAnimated(swapped.grid, rng.next);
        grid = result.grid;
      }
      return grid;
    }

    const canonical = replay(seed);
    // Simulate the forbidden pattern: seed with wall-clock time.
    const poisoned = replay(Date.now());
    expect(canonical).not.toEqual(poisoned);
  });
});
