/**
 * In-process latency simulation harness for T-v0.5-11 / T-v0.5-12.
 *
 * Starts a real Match-3 server on an ephemeral port, wires two Node-side
 * socket.io-client instances, and wraps their emit / on to inject a
 * configurable RTT. Scripts 50 alternating valid moves and returns final
 * board state from both clients so determinism and reconnection tests can
 * run against it.
 *
 * Tuning: set the env var `SIM_RTT_MS` (0 / 100 / 300 / 500). When imported
 * programmatically the same value can be passed via the `rttMs` option.
 */
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import { createMatch3Server, type ServerHandle } from "../server";
import { createBoard, swapTiles, type Board } from "@match3/shared-js/engine/Board";
import { createRng } from "@match3/shared-js/engine/rng";
import {
  findMatches,
  resolveBoard,
} from "@match3/shared-js/engine/MatchEngine";
import type {
  MatchFoundPayload,
  TurnChangedPayload,
  Move,
} from "@match3/shared-js/protocol";

export interface LatencyHarnessOptions {
  /** Simulated round-trip time in ms. Half applied per direction. */
  rttMs?: number;
  /** How many moves to play (alternating between clients). */
  moveCount?: number;
  /** Max time in ms we'll wait for matchmaking before giving up. */
  matchmakeTimeoutMs?: number;
}

export interface LatencyHarnessResult {
  /** Final board grid (immutable copy) as replayed on each client. */
  boardA: number[][];
  boardB: number[][];
  /** Per-move client-observed roundtrip timings in ms. */
  roundtripsMs: number[];
  /** Total moves actually played (may be fewer than requested if we ran out). */
  movesPlayed: number;
  /** Seed agreed between clients. */
  seed: number;
}

interface DelayedClient {
  raw: ClientSocket;
  id: string;
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  /** Register a one-shot listener; resolves with event args after inbound delay. */
  once: (event: string) => Promise<unknown[]>;
  /** Register a listener with matching filter + auto-off after match. */
  onFilter: (
    event: string,
    pred: (args: unknown[]) => boolean
  ) => Promise<unknown[]>;
  close: () => void;
}

function wrapWithLatency(socket: ClientSocket, rttMs: number): DelayedClient {
  const halfDelay = rttMs / 2;
  const handles = new Set<ReturnType<typeof setTimeout>>();

  function later(fn: () => void): void {
    if (halfDelay <= 0) {
      fn();
      return;
    }
    const h = setTimeout(() => {
      handles.delete(h);
      fn();
    }, halfDelay);
    handles.add(h);
  }

  return {
    raw: socket,
    get id(): string {
      return socket.id ?? "";
    },
    emit(event: string, ...args: unknown[]): void {
      later(() => socket.emit(event, ...args));
    },
    on(event: string, cb: (...args: unknown[]) => void): void {
      socket.on(event, (...args: unknown[]) => {
        later(() => cb(...args));
      });
    },
    once(event: string): Promise<unknown[]> {
      return new Promise((resolve) => {
        const handler = (...args: unknown[]): void => {
          socket.off(event, handler);
          later(() => resolve(args));
        };
        socket.on(event, handler);
      });
    },
    onFilter(
      event: string,
      pred: (args: unknown[]) => boolean
    ): Promise<unknown[]> {
      return new Promise((resolve) => {
        const handler = (...args: unknown[]): void => {
          if (!pred(args)) return;
          socket.off(event, handler);
          later(() => resolve(args));
        };
        socket.on(event, handler);
      });
    },
    close(): void {
      for (const h of handles) clearTimeout(h);
      handles.clear();
      socket.disconnect();
    },
  };
}

/**
 * Drives a deterministic scripted match: for each turn, finds a swap whose
 * resulting board produces a match, sends it to the server, and waits for
 * the corresponding `turn_changed` echo. Clients replay every move via the
 * shared engine so we can compare final grids.
 */
export async function runLatencyHarness(
  opts: LatencyHarnessOptions = {}
): Promise<LatencyHarnessResult> {
  const rttMs = opts.rttMs ?? Number(process.env.SIM_RTT_MS ?? 0);
  const moveCount = opts.moveCount ?? 50;
  const matchmakeTimeoutMs = opts.matchmakeTimeoutMs ?? 10_000;

  const server: ServerHandle = await new Promise<ServerHandle>((resolve) => {
    const handle = createMatch3Server();
    handle.httpServer.listen(0, () => resolve(handle));
  });
  const port = (server.httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const rawA = ioClient(url, { transports: ["websocket"], forceNew: true });
  const rawB = ioClient(url, { transports: ["websocket"], forceNew: true });
  const a = wrapWithLatency(rawA, rttMs);
  const b = wrapWithLatency(rawB, rttMs);

  const cleanup = async (): Promise<void> => {
    a.close();
    b.close();
    await server.close();
  };

  try {
    await Promise.all([
      new Promise<void>((res) => rawA.on("connect", () => res())),
      new Promise<void>((res) => rawB.on("connect", () => res())),
    ]);

    // Await match_found on both clients simultaneously, then send matchmake
    const matchA = a.once("match_found");
    const matchB = b.once("match_found");

    a.emit("matchmake");
    b.emit("matchmake");

    const timeoutMatch = setTimeout(() => {
      throw new Error(`matchmake timeout (${matchmakeTimeoutMs}ms)`);
    }, matchmakeTimeoutMs);
    timeoutMatch.unref?.();
    const [[mARaw], [mBRaw]] = await Promise.all([matchA, matchB]);
    clearTimeout(timeoutMatch);
    const mA = mARaw as MatchFoundPayload;
    const mB = mBRaw as MatchFoundPayload;
    if (mA.seed !== mB.seed) {
      throw new Error(`Seed mismatch: A=${mA.seed} B=${mB.seed}`);
    }
    if (mA.roomId !== mB.roomId) {
      throw new Error(`Room mismatch: A=${mA.roomId} B=${mB.roomId}`);
    }

    const seed = mA.seed;
    const roomId = mA.roomId;

    // Both clients track their own engine state (seed + move list)
    const boardA: { board: Board; rng: () => number } = {
      board: createBoard(seed),
      rng: createRng(seed + 1),
    };
    const boardB: { board: Board; rng: () => number } = {
      board: createBoard(seed),
      rng: createRng(seed + 1),
    };

    function applyResolved(
      state: { board: Board; rng: () => number },
      r1: number,
      c1: number,
      r2: number,
      c2: number
    ): void {
      const swapped = swapTiles(state.board, r1, c1, r2, c2);
      const { grid } = resolveBoard(swapped.grid, state.rng);
      state.board = { ...swapped, grid };
    }

    // Wire opponent_move — both clients replay each other's moves through
    // the latency wrapper so the inbound delay is counted.
    const onOppMove = (state: typeof boardA) => (...args: unknown[]) => {
      const m = args[0] as Move;
      applyResolved(state, m.r1, m.c1, m.r2, m.c2);
    };
    a.on("opponent_move", onOppMove(boardA));
    b.on("opponent_move", onOppMove(boardB));

    // Helper: returns a promise resolving when `turn_changed` fires with
    // `activePlayerId === expected` on the given client (through the latency
    // wrapper, so the inbound delay is counted).
    function waitForTurn(
      client: DelayedClient,
      expectedActiveId: string
    ): Promise<void> {
      return client
        .onFilter("turn_changed", (args) => {
          const td = args[0] as TurnChangedPayload;
          return td.activePlayerId === expectedActiveId;
        })
        .then(() => undefined);
    }

    /** Picks any valid (match-producing) swap on the given grid. */
    function pickValidSwap(
      grid: number[][]
    ): { r1: number; c1: number; r2: number; c2: number } | null {
      const h = grid.length;
      const w = grid[0]?.length ?? 0;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          if (c + 1 < w) {
            const candidate = grid.map((row) => [...row]);
            const tmp = candidate[r][c];
            candidate[r][c] = candidate[r][c + 1];
            candidate[r][c + 1] = tmp;
            if (findMatches(candidate).length > 0) {
              return { r1: r, c1: c, r2: r, c2: c + 1 };
            }
          }
          if (r + 1 < h) {
            const candidate = grid.map((row) => [...row]);
            const tmp = candidate[r][c];
            candidate[r][c] = candidate[r + 1][c];
            candidate[r + 1][c] = tmp;
            if (findMatches(candidate).length > 0) {
              return { r1: r, c1: c, r2: r + 1, c2: c };
            }
          }
        }
      }
      return null;
    }

    const activePlayerId = mA.firstPlayerId;
    const startingState =
      activePlayerId === mA.myPlayerId ? boardA : boardB;
    const startingClient = activePlayerId === mA.myPlayerId ? a : b;
    const otherClient = startingClient === a ? b : a;
    let currentState = startingState;
    let currentClient = startingClient;
    let nextClient = otherClient;
    let nextState = currentState === boardA ? boardB : boardA;

    const roundtripsMs: number[] = [];
    let movesPlayed = 0;

    for (let i = 0; i < moveCount; i++) {
      const move = pickValidSwap(currentState.board.grid);
      if (!move) break;

      const myId = currentClient === a ? mA.myPlayerId : mB.myPlayerId;
      const opponentId = currentClient === a ? mB.myPlayerId : mA.myPlayerId;

      const senderTurnChanged = waitForTurn(currentClient, opponentId);

      const t0 = Date.now();
      currentClient.emit("move", {
        roomId,
        r1: move.r1,
        c1: move.c1,
        r2: move.r2,
        c2: move.c2,
      });
      await senderTurnChanged;
      const t1 = Date.now();
      roundtripsMs.push(t1 - t0);

      // Sender applies own move to their engine
      applyResolved(currentState, move.r1, move.c1, move.r2, move.c2);

      // Give the opponent_move event time to traverse half-latency before
      // swapping roles. 2*halfDelay + a tiny buffer is safe.
      await new Promise((r) => setTimeout(r, rttMs + 20));

      movesPlayed++;

      console.log(
        `[harness] move ${i + 1}/${moveCount} by ${myId.slice(0, 6)} → ` +
          `rtt=${t1 - t0}ms`
      );

      // Swap current / next
      [currentClient, nextClient] = [nextClient, currentClient];
      [currentState, nextState] = [nextState, currentState];
      void myId;
      void opponentId;
    }

    return {
      boardA: boardA.board.grid.map((r) => [...r]),
      boardB: boardB.board.grid.map((r) => [...r]),
      roundtripsMs,
      movesPlayed,
      seed,
    };
  } finally {
    await cleanup();
  }
}

// Allow running directly: `SIM_RTT_MS=300 ts-node src/__tests__/latency-harness.ts`
if (require.main === module) {
  runLatencyHarness()
    .then((res) => {
      console.log(
        `[harness] done: ${res.movesPlayed} moves, boards equal: ${
          JSON.stringify(res.boardA) === JSON.stringify(res.boardB)
        }`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
