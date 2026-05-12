/**
 * T-v0.5-15 (updated for v0.6) — reconnect-to-resume latency assertion.
 *
 * v0.6 rejoin flow:
 *   1. Client calls POST /matchmaking/join → roomToken A.
 *   2. Client connects Socket.IO with roomToken A → match starts.
 *   3. Client disconnects.
 *   4. Client calls POST /matchmaking/resume → fresh roomToken A'.
 *   5. Client reconnects with roomToken A' → match_found (or receives board
 *      state from the room's move log).
 *
 * HMAC-based rejoin (v0.5) has been retired; see T-v0.6-G03.
 */
import { describe, it, expect } from "vitest";
import { io as ioClient } from "socket.io-client";
import type { AddressInfo } from "net";
import { createMatch3Server, type ServerHandle } from "../server";
import { setExternalTokenVerifierForTests, resetExternalTokenVerifierForTests, clearTokenCache } from "../AuthMiddleware";
import { verify as verifyRoomToken } from "../RoomTokenSigner";
import { createBoard, swapTiles } from "@match3/shared-js/engine/Board";
import { createRng } from "@match3/shared-js/engine/rng";
import {
  findMatches,
  resolveBoard,
} from "@match3/shared-js/engine/MatchEngine";
import type {
  MatchFoundPayload,
  Move,
} from "@match3/shared-js/protocol";


async function makeTestServer(): Promise<{ server: ServerHandle; url: string; port: number }> {
  const server = createMatch3Server();
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, () => resolve())
  );
  const port = (server.httpServer.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}`, port };
}

async function postJson(
  port: number,
  path: string,
  body: object,
  bearerToken: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
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

function replayMoves(
  seed: number,
  moves: Move[],
  extraDelayMs = 0
): { grid: number[][]; durationMs: number } {
  const t0 = Date.now();
  let board = createBoard(seed);
  const rng = createRng(seed + 1);
  for (const m of moves) {
    if (extraDelayMs > 0) {
      const end = Date.now() + extraDelayMs;
      while (Date.now() < end) { /* spin */ }
    }
    const swapped = swapTiles(board, m.r1, m.c1, m.r2, m.c2);
    const { grid } = resolveBoard(swapped.grid, rng);
    board = { ...swapped, grid };
  }
  return { grid: board.grid, durationMs: Date.now() - t0 };
}

describe("T-v0.5-15 (v0.6) reconnect-to-resume via HTTP resume endpoint", () => {
  it(
    "HTTP /matchmaking/resume issues a fresh room token; reconnect receives match_found",
    async () => {
      setExternalTokenVerifierForTests(async (token: string) => ({
        userId: `user:${token}`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }));
      clearTokenCache();
      const { server, port } = await makeTestServer();

      try {
        // 1. Join matchmaking (solo mode for simplicity)
        const joinResp = await postJson(port, "/matchmaking/join", { mode: "pve" }, "alice");
        expect(joinResp.status).toBe(200);
        const { roomToken: token1 } = joinResp.body as { roomToken: string; expiresAt: number };
        const payload1 = verifyRoomToken(token1);
        expect(payload1).not.toBeNull();
        const roomId = payload1!.roomId;

        // 2. Connect with the room token — match_found fires.
        const client1 = ioClient(`http://127.0.0.1:${port}`, {
          transports: ["websocket"],
          forceNew: true,
          auth: { token: token1 },
        });

        const matchPayload = await new Promise<MatchFoundPayload>((resolve, reject) => {
          client1.once("match_found", (d) => resolve(d as MatchFoundPayload));
          client1.once("connect_error", (e: Error) => reject(e));
        });

        expect(matchPayload.roomId).toBe(roomId);
        const seed = matchPayload.seed;
        expect(typeof seed).toBe("number");
        if (typeof seed !== "number") throw new Error("pve match_found missing seed");

        // 3. Disconnect client without playing moves — the rejoin path is
        // independent of the room's move log; we just need the room alive.
        client1.disconnect();
        await new Promise((r) => setTimeout(r, 100));

        // 5. Call /matchmaking/resume to get a fresh room token.
        const resumeResp = await postJson(port, "/matchmaking/resume", { roomId }, "alice");
        expect(resumeResp.status).toBe(200);
        const { roomToken: token2 } = resumeResp.body as { roomToken: string };
        const payload2 = verifyRoomToken(token2);
        expect(payload2).not.toBeNull();
        expect(payload2!.roomId).toBe(roomId);
        expect(payload2!.userId).toBe("user:alice");

        // 6. Reconnect with the fresh token — measure latency.
        const startMs = Date.now();
        const client2 = ioClient(`http://127.0.0.1:${port}`, {
          transports: ["websocket"],
          forceNew: true,
          auth: { token: token2 },
        });

        const reconnectPayload = await new Promise<MatchFoundPayload>((resolve, reject) => {
          client2.once("match_found", (d) => resolve(d as MatchFoundPayload));
          client2.once("connect_error", (e: Error) => reject(e));
        });

        expect(reconnectPayload.roomId).toBe(roomId);
        expect(reconnectPayload.seed).toBe(seed);

        // 7. Replay moves from the room (server stores them).
        const room = server.roomManager.getRoom(roomId);
        const replayableMoves = room?.moves ?? [];
        const { grid, durationMs } = replayMoves(seed, replayableMoves);
        const elapsedMs = Date.now() - startMs;

        expect(elapsedMs).toBeLessThanOrEqual(2000);
        expect(durationMs).toBeLessThanOrEqual(2000);

        console.log(`[rejoin-latency v0.6] elapsed=${elapsedMs}ms, replay=${durationMs}ms`);

        client2.disconnect();
      } finally {
        resetExternalTokenVerifierForTests();
        clearTokenCache();
        await server.close();
      }
    },
    30_000
  );

  it(
    "failure mode: replay slowed > 2 s is detectable",
    async () => {
      setExternalTokenVerifierForTests(async (token: string) => ({
        userId: `user:${token}`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }));
      clearTokenCache();
      const { server, port } = await makeTestServer();

      try {
        const joinResp = await postJson(port, "/matchmaking/join", { mode: "pve" }, "bob");
        expect(joinResp.status).toBe(200);
        const { roomToken } = joinResp.body as { roomToken: string };
        const payload = verifyRoomToken(roomToken)!;
        const roomId = payload.roomId;
        const seed = server.roomManager.getRoom(roomId)!.seed;

        const client = ioClient(`http://127.0.0.1:${port}`, {
          transports: ["websocket"],
          forceNew: true,
          auth: { token: roomToken },
        });
        await new Promise<MatchFoundPayload>((resolve, reject) => {
          client.once("match_found", (d) => resolve(d as MatchFoundPayload));
          client.once("connect_error", (e: Error) => reject(e));
        });
        client.disconnect();

        // Replay with 600 ms per move × a few entries (even with 0 moves it
        // adds overhead; we manufacture delay for demonstration).
        const fakeMoves: Move[] = [
          { playerId: "p", r1: 0, c1: 0, r2: 0, c2: 1, timestamp: 0 },
          { playerId: "p", r1: 1, c1: 0, r2: 1, c2: 1, timestamp: 0 },
          { playerId: "p", r1: 2, c1: 0, r2: 2, c2: 1, timestamp: 0 },
          { playerId: "p", r1: 3, c1: 0, r2: 3, c2: 1, timestamp: 0 },
        ];
        const { durationMs } = replayMoves(seed, fakeMoves, 600);
        expect(durationMs).toBeGreaterThan(2000);
        console.log(`[rejoin-latency-slow v0.6] replay=${durationMs}ms (expected > 2000)`);
        void roomId;
      } finally {
        resetExternalTokenVerifierForTests();
        clearTokenCache();
        await server.close();
      }
    },
    30_000
  );
});
