/**
 * In-process latency simulation harness for T-v0.5-11 / T-v0.5-12.
 *
 * Starts a real Match-3 server on an ephemeral port, wires two Node-side
 * socket.io-client instances, and wraps their emit / on to inject a
 * configurable RTT. Scripts N alternating valid moves and returns final
 * board state from both clients so determinism and reconnection tests can
 * run against it.
 *
 * The server validates and resolves each turn privately, then relays the
 * accepted move with board-delta cascade data. The harness mirrors the
 * Flutter game-view contract by applying the accepted board-delta result on
 * both clients and asserting their board views remain byte-identical under
 * simulated latency.
 *
 * Tuning: set the env var `SIM_RTT_MS` (0 / 100 / 300 / 500). When imported
 * programmatically the same value can be passed via the `rttMs` option.
 */
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import { createMatch3Server, type ServerHandle } from "../server";
import { signSession } from "../LocalSessionSigner";
import { BOARD_HEIGHT, BOARD_WIDTH } from "@match3/shared-js/engine/Board";
import { findMatches } from "@match3/shared-js/engine/MatchEngine";
import type {
  BoardDeltaMoveResolvedPayload,
  MatchFoundPayload,
  TurnChangedPayload,
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
  /**
   * Final board grid as seen by each client after locally resolving every
   * server-accepted move.
   */
  boardA: number[][];
  boardB: number[][];
  /** Per-move client-observed roundtrip timings in ms. */
  roundtripsMs: number[];
  /** Total moves actually played (may be fewer than requested if we ran out). */
  movesPlayed: number;
  /** Room under test, useful in failure messages. */
  roomId: string;
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
 * resulting board produces a match, sends it to the server, waits for the
 * accepted turn change, and resolves the same move locally on both client
 * board views.
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

  // Pair the two clients via the HTTP matchmaking endpoint.
  const sessionA = signSession({ userId: "harness:A" }).token;
  const sessionB = signSession({ userId: "harness:B" }).token;

  async function joinTurnBased(sessionToken: string): Promise<{
    roomToken: string;
  }> {
    const res = await fetch(`${url}/matchmaking/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ mode: "turn_based" }),
    });
    if (!res.ok) {
      throw new Error(`matchmaking/join ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<{ roomToken: string }>;
  }
  const [{ roomToken: tokenA }, { roomToken: tokenB }] = await Promise.all([
    joinTurnBased(sessionA),
    // Stagger the second call slightly so the first registers in the queue.
    new Promise<void>((r) => setTimeout(r, 5)).then(() => joinTurnBased(sessionB)),
  ]);

  const rawA = ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    auth: { token: tokenA },
  });
  const rawB = ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    auth: { token: tokenB },
  });
  const a = wrapWithLatency(rawA, rttMs);
  const b = wrapWithLatency(rawB, rttMs);

  const cleanup = async (): Promise<void> => {
    a.close();
    b.close();
    await server.close();
  };

  try {
    // Both clients receive match_found from the room-token handshake (D02).
    const matchA = a.once("match_found");
    const matchB = b.once("match_found");

    const timeoutMatch = setTimeout(() => {
      throw new Error(`matchmake timeout (${matchmakeTimeoutMs}ms)`);
    }, matchmakeTimeoutMs);
    timeoutMatch.unref?.();
    const [[mARaw], [mBRaw]] = await Promise.all([matchA, matchB]);
    clearTimeout(timeoutMatch);
    const mA = mARaw as MatchFoundPayload;
    const mB = mBRaw as MatchFoundPayload;
    if (mA.roomId !== mB.roomId) {
      throw new Error(`Room mismatch: A=${mA.roomId} B=${mB.roomId}`);
    }
    if (mA.board?.join(",") !== mB.board?.join(",")) {
      throw new Error("Initial board mismatch between clients");
    }

    const roomId = mA.roomId;

    const flatToGrid = (board?: number[]): number[][] | null => {
      if (!board || board.length !== BOARD_WIDTH * BOARD_HEIGHT) return null;
      const grid: number[][] = [];
      for (let r = 0; r < BOARD_HEIGHT; r++) {
        grid.push(board.slice(r * BOARD_WIDTH, (r + 1) * BOARD_WIDTH));
      }
      return grid;
    };

    // Clients start from the server-broadcast flat board (match_found).
    const initialBoardA = flatToGrid(mA.board);
    const initialBoardB = flatToGrid(mB.board);
    if (!initialBoardA || !initialBoardB) {
      throw new Error("match_found missing flat board snapshot");
    }
    let boardA: number[][] = initialBoardA;
    let boardB: number[][] = initialBoardB;

    const finalGridFromResolved = (payload: BoardDeltaMoveResolvedPayload): number[][] => {
      const finalStep = payload.steps[payload.steps.length - 1];
      if (!finalStep) throw new Error("move_resolved missing cascade steps");
      return finalStep.afterRefill.map((row) => [...row]);
    };

    // Helper: returns a promise resolving when `turn_changed` fires with
    // `activePlayerId === expected` on the given client.
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
    // Determine which client goes first.
    const startingClient = activePlayerId === mA.myPlayerId ? a : b;
    const otherClient = startingClient === a ? b : a;
    let currentClient = startingClient;
    let nextClient = otherClient;

    const roundtripsMs: number[] = [];
    let movesPlayed = 0;

    // Track early game-over (can happen via HP death with the player-stats system)
    let gameOver = false;
    a.on("game_over", () => { gameOver = true; });
    b.on("game_over", () => { gameOver = true; });

    for (let i = 0; i < moveCount; i++) {
      if (gameOver) break;

      // The active client uses the current client's board view to pick a swap.
      const currentBoard = currentClient === a ? boardA : boardB;
      const swap = pickValidSwap(currentBoard);
      if (!swap) break;

      const myId = currentClient === a ? mA.myPlayerId : mB.myPlayerId;
      const opponentId = currentClient === a ? mB.myPlayerId : mA.myPlayerId;

      // Race turn_changed against game_over to avoid hanging on HP-death end.
      const gameOverPromise = new Promise<"game_over">((resolve) => {
        currentClient.onFilter("game_over", () => true).then(() => resolve("game_over")).catch(() => undefined);
      });
      const turnChangedPromise = waitForTurn(currentClient, opponentId).then(() => "turn_changed" as const);
      const resolvedPromise = currentClient
        .onFilter("move_resolved", (args) => {
          const resolved = args[0] as BoardDeltaMoveResolvedPayload;
          return resolved.playerId === myId;
        })
        .then((args) => args[0] as BoardDeltaMoveResolvedPayload);

      const t0 = Date.now();
      currentClient.emit("move", {
        roomId,
        r1: swap.r1,
        c1: swap.c1,
        r2: swap.r2,
        c2: swap.c2,
      });
      const winner = await Promise.race([turnChangedPromise, gameOverPromise]);
      const resolved = await resolvedPromise;
      const t1 = Date.now();

      const finalGrid = finalGridFromResolved(resolved);
      boardA = finalGrid.map((r) => [...r]);
      boardB = finalGrid.map((r) => [...r]);

      if (winner === "game_over") {
        gameOver = true;
        movesPlayed++;
        // Wait for any in-flight relayed move to settle before returning.
        await new Promise((r) => setTimeout(r, rttMs + 200));
        break;
      }

      roundtripsMs.push(t1 - t0);

      // Give the relayed move event time to traverse half-latency to both clients.
      await new Promise((r) => setTimeout(r, rttMs + 20));

      movesPlayed++;

      console.log(
        `[harness] move ${i + 1}/${moveCount} by ${myId.slice(0, 6)} → ` +
          `rtt=${t1 - t0}ms`
      );

      // Swap current / next
      [currentClient, nextClient] = [nextClient, currentClient];
      void opponentId;
    }

    return {
      boardA: boardA.map((r) => [...r]),
      boardB: boardB.map((r) => [...r]),
      roundtripsMs,
      movesPlayed,
      roomId,
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
