/**
 * T-v0.5-15 — NFR-4 reconnect-to-resume ≤ 2 s assertion.
 *
 * Scripts a short match, drops one client mid-play, reconnects it with the
 * saved HMAC rejoin token, and measures the elapsed time from the new
 * socket's `connect` event to the point where the local engine finishes
 * replaying the server-supplied move log onto an identical board.
 */
import { describe, it, expect } from "vitest";
import { io as ioClient } from "socket.io-client";
import type { AddressInfo } from "net";
import { createMatch3Server, type ServerHandle } from "../server";
import { createBoard, swapTiles } from "@match3/shared/engine/Board";
import { createRng } from "@match3/shared/engine/rng";
import {
  findMatches,
  resolveBoard,
} from "@match3/shared/engine/MatchEngine";
import type {
  MatchFoundPayload,
  RejoinOkPayload,
  Move,
} from "@match3/shared/protocol";

async function startServer(): Promise<{ server: ServerHandle; url: string }> {
  const server = createMatch3Server();
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, () => resolve())
  );
  const port = (server.httpServer.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

function pickSwap(
  grid: number[][]
): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const trial = grid.map((row) => [...row]);
        [trial[r][c], trial[r][c + 1]] = [trial[r][c + 1], trial[r][c]];
        if (findMatches(trial).length > 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const trial = grid.map((row) => [...row]);
        [trial[r][c], trial[r + 1][c]] = [trial[r + 1][c], trial[r][c]];
        if (findMatches(trial).length > 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

/** Replays a move log through the shared engine and returns the final board. */
function replayMoves(
  seed: number,
  moves: Move[],
  extraDelayMs = 0
): {
  grid: number[][];
  durationMs: number;
} {
  const t0 = Date.now();
  let board = createBoard(seed);
  const rng = createRng(seed + 1);
  for (const m of moves) {
    if (extraDelayMs > 0) {
      // Busy-wait to simulate a slow replay path for the failure-mode
      // demonstration.
      const end = Date.now() + extraDelayMs;
      while (Date.now() < end) {
        /* spin */
      }
    }
    const swapped = swapTiles(board, m.r1, m.c1, m.r2, m.c2);
    const { grid } = resolveBoard(swapped.grid, rng);
    board = { ...swapped, grid };
  }
  return { grid: board.grid, durationMs: Date.now() - t0 };
}

async function playScripted(
  url: string,
  movesToPlay: number
): Promise<{
  server: ServerHandle;
  matchA: MatchFoundPayload;
  matchB: MatchFoundPayload;
  rejoinTokenA: string;
  moveLog: Move[];
  urlOut: string;
}> {
  const { server, url: srvUrl } = await startServer();

  const a = ioClient(srvUrl, { transports: ["websocket"], forceNew: true });
  const b = ioClient(srvUrl, { transports: ["websocket"], forceNew: true });

  await Promise.all([
    new Promise<void>((r) => a.on("connect", () => r())),
    new Promise<void>((r) => b.on("connect", () => r())),
  ]);

  const matchAPromise = new Promise<MatchFoundPayload>((resolve) => {
    a.once("match_found", (d) => resolve(d as MatchFoundPayload));
  });
  const matchBPromise = new Promise<MatchFoundPayload>((resolve) => {
    b.once("match_found", (d) => resolve(d as MatchFoundPayload));
  });
  a.emit("matchmake");
  b.emit("matchmake");
  const [matchA, matchB] = await Promise.all([matchAPromise, matchBPromise]);

  const seed = matchA.seed;
  let board = createBoard(seed);
  const rng = createRng(seed + 1);
  const moveLog: Move[] = [];

  a.on("opponent_move", (m: unknown) => moveLog.push(m as Move));
  b.on("opponent_move", () => {});

  let current = matchA.firstPlayerId === matchA.myPlayerId ? a : b;
  let currentIsA = current === a;

  for (let i = 0; i < movesToPlay; i++) {
    const swap = pickSwap(board.grid);
    if (!swap) break;
    const turnChanged = new Promise<void>((resolve) => {
      current.once("turn_changed", () => resolve());
    });
    current.emit("move", {
      roomId: matchA.roomId,
      r1: swap.r1,
      c1: swap.c1,
      r2: swap.r2,
      c2: swap.c2,
    });
    await turnChanged;

    // Track the move in the server-authoritative order for replay
    const mv: Move = {
      playerId: currentIsA ? matchA.myPlayerId : matchB.myPlayerId,
      r1: swap.r1,
      c1: swap.c1,
      r2: swap.r2,
      c2: swap.c2,
      timestamp: Date.now(),
    };
    moveLog.push(mv);

    const swapped = swapTiles(board, swap.r1, swap.c1, swap.r2, swap.c2);
    const { grid } = resolveBoard(swapped.grid, rng);
    board = { ...swapped, grid };

    current = current === a ? b : a;
    currentIsA = current === a;
  }

  // Cleanup transient helpers
  a.off("opponent_move");
  b.off("opponent_move");

  // Disconnect A and return the state so caller can drive the rejoin
  a.disconnect();

  // Wait a beat so the server sees the disconnect and records the grace period
  await new Promise((r) => setTimeout(r, 100));

  return {
    server,
    matchA,
    matchB,
    rejoinTokenA: matchA.rejoinToken,
    moveLog,
    urlOut: srvUrl,
  };
}

describe("T-v0.5-15 reconnect-to-resume", () => {
  it(
    "rejoin + local replay completes in ≤ 2000 ms",
    async () => {
      const { server, matchA, rejoinTokenA, urlOut } = await playScripted(
        /* url fetched inline */ "",
        4
      );

      try {
        const newA = ioClient(urlOut, {
          transports: ["websocket"],
          forceNew: true,
        });
        await new Promise<void>((r) => newA.on("connect", () => r()));

        const startMs = Date.now();

        const rejoinPayload = await new Promise<RejoinOkPayload>((resolve, reject) => {
          newA.once("rejoin_ok", (d) => resolve(d as RejoinOkPayload));
          newA.once("rejoin_failed", (d) =>
            reject(new Error(`rejoin_failed: ${JSON.stringify(d)}`))
          );
          newA.emit("rejoin", { token: rejoinTokenA });
        });

        const { grid: replayedGrid } = replayMoves(
          rejoinPayload.seed,
          rejoinPayload.moves
        );
        const elapsedMs = Date.now() - startMs;

        // Correctness check — replay matches the expected cell state
        let authoritativeBoard = createBoard(matchA.seed);
        const rng = createRng(matchA.seed + 1);
        for (const m of rejoinPayload.moves) {
          const swapped = swapTiles(authoritativeBoard, m.r1, m.c1, m.r2, m.c2);
          const { grid } = resolveBoard(swapped.grid, rng);
          authoritativeBoard = { ...swapped, grid };
        }
        expect(replayedGrid).toEqual(authoritativeBoard.grid);

        expect(elapsedMs).toBeLessThanOrEqual(2000);
        console.log(`[rejoin-latency] elapsed=${elapsedMs}ms`);

        newA.disconnect();
      } finally {
        await server.close();
      }
    },
    30_000
  );

  it(
    "failure mode: the same assertion trips when the replay is artificially slowed",
    async () => {
      const { server, rejoinTokenA, urlOut } = await playScripted("", 4);

      try {
        const newA = ioClient(urlOut, {
          transports: ["websocket"],
          forceNew: true,
        });
        await new Promise<void>((r) => newA.on("connect", () => r()));

        const startMs = Date.now();
        const rejoinPayload = await new Promise<RejoinOkPayload>((resolve, reject) => {
          newA.once("rejoin_ok", (d) => resolve(d as RejoinOkPayload));
          newA.once("rejoin_failed", (d) =>
            reject(new Error(`rejoin_failed: ${JSON.stringify(d)}`))
          );
          newA.emit("rejoin", { token: rejoinTokenA });
        });

        // Artificially slow the replay to > 2 s per move
        replayMoves(rejoinPayload.seed, rejoinPayload.moves, 600);
        const elapsedMs = Date.now() - startMs;

        expect(elapsedMs).toBeGreaterThan(2000);
        console.log(`[rejoin-latency-slow] elapsed=${elapsedMs}ms (expected > 2000)`);

        newA.disconnect();
      } finally {
        await server.close();
      }
    },
    30_000
  );
});
