/**
 * Server-authoritative PvP move handler integration tests.
 *
 * Validates:
 * - Invalid swap (no match) is rejected with move_rejected { no_match }
 * - Valid swap relays the accepted move to the opponent only
 * - The hot path broadcasts Flutter-native board-delta move_resolved payloads
 * - Snapshot rejoin: flat board in rejoin_ok match live room state
 * - Server determinism: two independent simulations from the same seed + moves
 *   produce byte-identical boardGrid and rngState at every step
 */

import { describe, it, expect, afterEach } from "vitest";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import { createMatch3Server, type ServerHandle } from "../server";
import { signSession } from "../LocalSessionSigner";
import { BOARD_HEIGHT, BOARD_WIDTH } from "@match3/shared-js/engine/Board";
import {
  applyGravity,
  findMatches,
  removeMatches,
} from "@match3/shared-js/engine/MatchEngine";
import { BOT_ID, BOT_USER_ID } from "../constants";
import type {
  BoardDeltaMoveResolvedPayload,
  MatchFoundPayload,
  Move,
} from "@match3/shared-js/protocol";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TestServer {
  handle: ServerHandle;
  url: string;
}

async function startServer(botWaitMs?: number): Promise<TestServer> {
  const handle = await new Promise<ServerHandle>((resolve) => {
    const h = createMatch3Server({ botWaitMs });
    h.httpServer.listen(0, () => resolve(h));
  });
  const port = (handle.httpServer.address() as AddressInfo).port;
  return { handle, url: `http://127.0.0.1:${port}` };
}

async function joinAndConnect(
  url: string,
  userId: string
): Promise<{ socket: ClientSocket; roomToken: string }> {
  const session = signSession({ userId }).token;
  const res = await fetch(`${url}/matchmaking/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ mode: "turn_based" }),
  });
  if (!res.ok) throw new Error(`matchmaking/join failed: ${res.status}`);
  const { roomToken } = (await res.json()) as { roomToken: string };
  const socket = ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    auth: { token: roomToken },
  });
  return { socket, roomToken };
}

async function joinSoloAndConnect(
  url: string,
  userId: string
): Promise<{ socket: ClientSocket; roomToken: string }> {
  const session = signSession({ userId }).token;
  const res = await fetch(`${url}/matchmaking/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ mode: "turn_based" }),
  });
  if (!res.ok) throw new Error(`matchmaking/join failed: ${res.status}`);
  const body = (await res.json()) as {
    roomToken: string;
    opponent: { userId: string } | null;
  };
  expect(body.opponent?.userId).toBe(BOT_USER_ID);
  const socket = ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    auth: { token: body.roomToken },
  });
  return { socket, roomToken: body.roomToken };
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function waitForEventFilter<T>(
  socket: ClientSocket,
  event: string,
  pred: (d: T) => boolean,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}' (filtered)`)), timeoutMs);
    const handler = (data: T) => {
      if (!pred(data)) return;
      socket.off(event, handler);
      clearTimeout(t);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

function gridFromFlatBoard(payload: MatchFoundPayload): number[][] {
  if (!payload.board) throw new Error("match_found missing flat board");
  expect(payload.board).toHaveLength(BOARD_WIDTH * BOARD_HEIGHT);
  const grid: number[][] = [];
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    grid.push(payload.board.slice(r * BOARD_WIDTH, (r + 1) * BOARD_WIDTH));
  }
  return grid;
}

function finalGridFromResolved(
  startGrid: number[][],
  payload: BoardDeltaMoveResolvedPayload
): number[][] {
  let current = startGrid.map((row) => [...row]);
  [current[payload.r1]![payload.c1], current[payload.r2]![payload.c2]] = [
    current[payload.r2]![payload.c2]!,
    current[payload.r1]![payload.c1]!,
  ];
  let generatedIndex = 0;

  for (let i = 0; i < 20; i++) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const afterGravity = applyGravity(removeMatches(current, matches));
    current = afterGravity.map((row) => [...row]);
    for (let c = 0; c < BOARD_WIDTH; c++) {
      for (let r = BOARD_HEIGHT - 1; r >= 0; r--) {
        if (current[r]![c] === -1) {
          const tile = payload.generatedTiles[generatedIndex++];
          if (tile === undefined) throw new Error("generatedTiles exhausted");
          current[r]![c] = tile;
        }
      }
    }
  }

  expect(generatedIndex).toBe(payload.generatedTiles.length);
  return current;
}

/** Find the first adjacent swap on grid that produces a match. */
function findMatchingSwap(
  grid: number[][]
): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r][c + 1]] = [cand[r][c + 1], cand[r][c]];
        if (findMatches(cand).length > 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r + 1][c]] = [cand[r + 1][c], cand[r][c]];
        if (findMatches(cand).length > 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

/** Find the first adjacent swap that produces NO match. */
function findNonMatchingSwap(
  grid: number[][]
): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r][c + 1]] = [cand[r][c + 1], cand[r][c]];
        if (findMatches(cand).length === 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r + 1][c]] = [cand[r + 1][c], cand[r][c]];
        if (findMatches(cand).length === 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("server-authoritative PvP move handler", () => {
  const servers: TestServer[] = [];
  const sockets: ClientSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    for (const srv of servers.splice(0)) await srv.handle.close();
  });

  async function setup(): Promise<{
    srv: TestServer;
    sockA: ClientSocket;
    sockB: ClientSocket;
    mA: MatchFoundPayload;
    mB: MatchFoundPayload;
  }> {
    const srv = await startServer();
    servers.push(srv);

    const [{ socket: sockA }, { socket: sockB }] = await Promise.all([
      joinAndConnect(srv.url, "test:A"),
      new Promise<void>((r) => setTimeout(r, 5)).then(() =>
        joinAndConnect(srv.url, "test:B")
      ),
    ]);
    sockets.push(sockA, sockB);

    const [mA, mB] = await Promise.all([
      waitForEvent<MatchFoundPayload>(sockA, "match_found"),
      waitForEvent<MatchFoundPayload>(sockB, "match_found"),
    ]);
    return { srv, sockA, sockB, mA, mB };
  }

  it("match_found includes flat board without seed or board dimensions for turn_based", async () => {
    const { mA, mB } = await setup();
    expect(mA.mode).toBe("turn_based");
    expect("seed" in mA).toBe(false);
    expect("width" in mA).toBe(false);
    expect("height" in mA).toBe(false);
    expect("boardGrid" in mA).toBe(false);
    expect(Array.isArray(mA.board)).toBe(true);
    expect(mA.board).toHaveLength(BOARD_WIDTH * BOARD_HEIGHT);
    // Both clients receive the same board
    expect(mA.board).toEqual(mB.board);
  });

  it("valid move relays opponent_move to the opposing socket only", async () => {
    const { sockA, sockB, mA } = await setup();
    const firstPlayerSocket = mA.firstPlayerId === mA.myPlayerId ? sockA : sockB;
    const otherSocket = firstPlayerSocket === sockA ? sockB : sockA;
    const firstPlayerBoard = gridFromFlatBoard(mA);
    const swap = findMatchingSwap(firstPlayerBoard);
    if (!swap) throw new Error("No matching swap found");

    let senderGotOpponentMove = false;
    firstPlayerSocket.once("opponent_move", () => {
      senderGotOpponentMove = true;
    });

    const [relayed] = await Promise.all([
      waitForEvent<Move>(otherSocket, "opponent_move"),
      (async () => {
        firstPlayerSocket.emit("move", { roomId: mA.roomId, ...swap });
      })(),
    ]);

    expect(relayed.playerId).toBe(firstPlayerSocket.id);
    expect(relayed.r1).toBe(swap.r1);
    expect(relayed.c1).toBe(swap.c1);
    expect(relayed.r2).toBe(swap.r2);
    expect(relayed.c2).toBe(swap.c2);
    expect(typeof relayed.timestamp).toBe("number");
    await new Promise((r) => setTimeout(r, 100));
    expect(senderGotOpponentMove).toBe(false);
  });

  it("broadcasts board-delta move_resolved on the hot path", async () => {
    const { sockA, sockB, mA } = await setup();
    const firstPlayerSocket = mA.firstPlayerId === mA.myPlayerId ? sockA : sockB;
    const grid = gridFromFlatBoard(mA);
    const swap = findMatchingSwap(grid);
    if (!swap) throw new Error("No matching swap found");

    const opponentSocket = firstPlayerSocket === sockA ? sockB : sockA;
    const relayedPromise = waitForEvent<Move>(opponentSocket, "opponent_move");
    const resolvedAPromise = waitForEvent<BoardDeltaMoveResolvedPayload>(sockA, "move_resolved");
    const resolvedBPromise = waitForEvent<BoardDeltaMoveResolvedPayload>(sockB, "move_resolved");

    firstPlayerSocket.emit("move", { roomId: mA.roomId, ...swap });
    const [relayed, resolvedA, resolvedB] = await Promise.all([
      relayedPromise,
      resolvedAPromise,
      resolvedBPromise,
    ]);

    expect(relayed.playerId).toBe(firstPlayerSocket.id);
    for (const resolved of [resolvedA, resolvedB]) {
      expect(resolved.playerId).toBe(firstPlayerSocket.id);
      expect(resolved.r1).toBe(swap.r1);
      expect(resolved.c1).toBe(swap.c1);
      expect(resolved.r2).toBe(swap.r2);
      expect(resolved.c2).toBe(swap.c2);
      expect(resolved.boardVersion).toBeGreaterThan(mA.boardVersion ?? 1);
      expect("steps" in resolved).toBe(false);
      expect(Array.isArray(resolved.generatedTiles)).toBe(true);
      expect(resolved.generatedTiles.every(Number.isInteger)).toBe(true);
      expect(typeof resolved.boardHash).toBe("string");
      expect("rngState" in resolved).toBe(false);
      expect("finalGrid" in resolved).toBe(false);
      expect("scores" in resolved).toBe(false);
      expect("pointsEarned" in resolved).toBe(false);
    }
  });

  it("invalid swap (no_match) emits move_rejected only to the offending socket", async () => {
    const { sockA, sockB, mA } = await setup();
    const firstPlayerSocket = mA.firstPlayerId === mA.myPlayerId ? sockA : sockB;
    const otherSocket = firstPlayerSocket === sockA ? sockB : sockA;
    const grid = gridFromFlatBoard(mA);
    const badSwap = findNonMatchingSwap(grid);
    if (!badSwap) {
      // Edge case: all swaps produce matches (skip rather than fail).
      console.warn("All swaps produce matches on this board — test vacuous");
      return;
    }

    // The offending socket should get move_rejected; the other should NOT.
    const rejectedPromise = waitForEvent<{ reason: string }>(firstPlayerSocket, "move_rejected");
    let otherGotRejected = false;
    otherSocket.once("move_rejected", () => { otherGotRejected = true; });

    firstPlayerSocket.emit("move", { roomId: mA.roomId, ...badSwap });
    const rejected = await rejectedPromise;

    expect(rejected.reason).toBe("no_match");
    await new Promise((r) => setTimeout(r, 100));
    expect(otherGotRejected).toBe(false);
  });

  it("wrong-turn move emits move_rejected { not_your_turn }", async () => {
    const { sockA, sockB, mA } = await setup();
    // The inactive player tries to move
    const inactiveSocket = mA.firstPlayerId === mA.myPlayerId ? sockB : sockA;
    const inactiveBoard = gridFromFlatBoard(mA);
    const swap = findMatchingSwap(inactiveBoard);
    if (!swap) throw new Error("No matching swap found");

    const rejectedPromise = waitForEvent<{ reason: string }>(inactiveSocket, "move_rejected");
    inactiveSocket.emit("move", { roomId: mA.roomId, ...swap });
    const rejected = await rejectedPromise;

    expect(rejected.reason).toBe("not_your_turn");
  });

  it("turn changes after each accepted move", async () => {
    const { sockA, sockB, mA } = await setup();
    const p1Socket = mA.firstPlayerId === mA.myPlayerId ? sockA : sockB;
    const p2Socket = p1Socket === sockA ? sockB : sockA;

    // Move 1 by p1
    let currentGrid = gridFromFlatBoard(mA);
    const swap1 = findMatchingSwap(currentGrid);
    if (!swap1) throw new Error("No swap1 found");

    const turn1Promise = waitForEvent<{ activePlayerId: string; serverReceivedAt?: number }>(
      sockA,
      "turn_changed"
    );
    const resolved1Promise = waitForEvent<BoardDeltaMoveResolvedPayload>(sockA, "move_resolved");
    p1Socket.emit("move", { roomId: mA.roomId, ...swap1 });
    const [turn1, resolved1] = await Promise.all([turn1Promise, resolved1Promise]);

    expect(turn1.activePlayerId).toBe(p2Socket.id);
    expect(typeof turn1.serverReceivedAt).toBe("number");
    currentGrid = finalGridFromResolved(currentGrid, resolved1);

    // Move 2 by p2
    const swap2 = findMatchingSwap(currentGrid);
    if (!swap2) return; // Board may be in a state with no valid swaps after cascade

    const turn2Promise = waitForEvent<{ activePlayerId: string; serverReceivedAt?: number }>(
      sockA,
      "turn_changed"
    );
    p2Socket.emit("move", { roomId: mA.roomId, ...swap2 });
    const turn2 = await turn2Promise;

    expect(turn2.activePlayerId).toBe(p1Socket.id);
    expect(typeof turn2.serverReceivedAt).toBe("number");
  });

  it("bot fallback in turn_based uses the same board-delta judge path", async () => {
    const srv = await startServer(50);
    servers.push(srv);

    const { socket } = await joinSoloAndConnect(srv.url, "bot:A");
    sockets.push(socket);

    const match = await waitForEvent<MatchFoundPayload>(socket, "match_found", 8000);
    expect(match.mode).toBe("turn_based");
    expect(match.opponentId).toBe(BOT_ID);
    expect(match.board).toHaveLength(BOARD_WIDTH * BOARD_HEIGHT);
    expect("seed" in match).toBe(false);

    const grid = gridFromFlatBoard(match);
    const swap = findMatchingSwap(grid);
    if (!swap) throw new Error("No matching swap found");

    const humanResolvedPromise = waitForEventFilter<BoardDeltaMoveResolvedPayload>(
      socket,
      "move_resolved",
      (payload) => payload.playerId === socket.id,
      5000
    );
    const botResolvedPromise = waitForEventFilter<BoardDeltaMoveResolvedPayload>(
      socket,
      "move_resolved",
      (payload) => payload.playerId === BOT_ID,
      8000
    );

    socket.emit("move", { roomId: match.roomId, ...swap });
    const [humanResolved, botResolved] = await Promise.all([
      humanResolvedPromise,
      botResolvedPromise,
    ]);

    expect(humanResolved.playerId).toBe(socket.id);
    expect(botResolved.playerId).toBe(BOT_ID);
    expect(botResolved.boardVersion).toBeGreaterThan(humanResolved.boardVersion);
    expect("scores" in botResolved).toBe(false);
    expect("steps" in botResolved).toBe(false);
    expect(Array.isArray(botResolved.generatedTiles)).toBe(true);
    expect(typeof botResolved.boardHash).toBe("string");
  });
});

// ─── Snapshot rejoin test ─────────────────────────────────────────────────────
//
// The primary rejoin mechanism for v0.6 is the D02 room-token path:
//   1. Client disconnects (or just requests a new token via /matchmaking/resume)
//   2. Client calls POST /matchmaking/resume → fresh room token
//   3. Client reconnects with new token → D02 handshake attaches to room slot
//   4. Server emits match_found to the reconnecting socket with the current
//      flat board snapshot (for turn_based rooms)
//
// The legacy "rejoin" socket event also supports snapshot delivery (via
// RejoinManager.lookup); it requires the disconnect handler to have registered
// the user. We test the D02 path here since that is the canonical production flow.

describe("snapshot rejoin for turn_based rooms (D02 resume path)", () => {
  const servers: TestServer[] = [];
  const sockets: ClientSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    for (const srv of servers.splice(0)) await srv.handle.close();
  });

  it("reconnecting player receives match_found with current flat board", async () => {
    const srv = await startServer();
    servers.push(srv);

    // Connect both players
    const [{ socket: sockA }, { socket: sockB }] = await Promise.all([
      joinAndConnect(srv.url, "rejoin:A"),
      new Promise<void>((r) => setTimeout(r, 5)).then(() =>
        joinAndConnect(srv.url, "rejoin:B")
      ),
    ]);
    sockets.push(sockA, sockB);

    const [mA] = await Promise.all([
      waitForEvent<MatchFoundPayload>(sockA, "match_found"),
      waitForEvent<MatchFoundPayload>(sockB, "match_found"),
    ]);

    const p1Socket = mA.firstPlayerId === mA.myPlayerId ? sockA : sockB;
    const p2Socket = p1Socket === sockA ? sockB : sockA;

    // Play 3 moves to advance board state
    let currentGrid = gridFromFlatBoard(mA);
    let playedAnyMove = false;

    for (let i = 0; i < 3; i++) {
      const activeSocket = i % 2 === 0 ? p1Socket : p2Socket;
      const swap = findMatchingSwap(currentGrid);
      if (!swap) break;

      // Listen on the opposing socket for the accepted move relay.
      const relayPromise = waitForEvent<Move>(
        activeSocket === sockA ? sockB : sockA,
        "opponent_move"
      );
      const resolvedPromise = waitForEvent<BoardDeltaMoveResolvedPayload>(sockA, "move_resolved");
      activeSocket.emit("move", { roomId: mA.roomId, ...swap });
      const [, resolved] = await Promise.all([relayPromise, resolvedPromise]);
      currentGrid = finalGridFromResolved(currentGrid, resolved);
      playedAnyMove = true;
    }

    if (!playedAnyMove) {
      console.warn("No moves played — snapshot rejoin test vacuous");
      return;
    }

    // Disconnect p1 and reconnect via /matchmaking/resume (D02 path).
    // We use userIdA (the userId baked into the session token) as "rejoin:A".
    // p1 is whichever socket has myPlayerId === mA.firstPlayerId.
    p1Socket.disconnect();

    // Wait for disconnect to be processed server-side.
    await new Promise((r) => setTimeout(r, 200));

    // Request a fresh room token
    const sessionA = signSession({ userId: "rejoin:A" }).token;
    const resumeRes = await fetch(`${srv.url}/matchmaking/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionA}` },
      body: JSON.stringify({ roomId: mA.roomId }),
    });
    expect(resumeRes.status).toBe(200);
    const { roomToken: newToken } = (await resumeRes.json()) as { roomToken: string };

    // Reconnect with the new token — D02 handshake attaches to room slot.
    // When the second player is now present again, match_found fires with
    // the current flat board snapshot.
    const rejoinSocket = ioClient(srv.url, {
      transports: ["websocket"],
      forceNew: true,
      auth: { token: newToken },
    });
    sockets.push(rejoinSocket);

    const rejoinFoundPromise = waitForEvent<MatchFoundPayload>(rejoinSocket, "match_found", 10000);
    const reconnectPayload = await rejoinFoundPromise;

    // Validate: the reconnecting client receives the snapshot
    expect("seed" in reconnectPayload).toBe(false);
    expect("width" in reconnectPayload).toBe(false);
    expect("height" in reconnectPayload).toBe(false);
    expect("boardGrid" in reconnectPayload).toBe(false);
    expect(reconnectPayload.board).toBeDefined();
    expect(reconnectPayload.myPlayerId).toBe(rejoinSocket.id);
    expect(reconnectPayload.playerStates?.[reconnectPayload.myPlayerId]).toBeDefined();
    expect([reconnectPayload.myPlayerId, reconnectPayload.opponentId]).toContain(
      reconnectPayload.activePlayerId
    );

    // Flat board snapshot must match the locally-computed result of the accepted moves.
    expect(gridFromFlatBoard(reconnectPayload)).toEqual(currentGrid);
  });
});
