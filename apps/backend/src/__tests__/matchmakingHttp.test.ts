/**
 * T-v0.6-D09, D10 — HTTP integration tests for /matchmaking/join, /resume,
 * and /matchmaking/status.
 *
 * Uses the in-process createMatch3Server() factory. Mocks the local session verifier
 * externalTokenVerifier via setExternalTokenVerifierForTests so no external auth provider is required.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { startServer, type ServerHandle } from "../server";
import {
  setExternalTokenVerifierForTests,
  resetExternalTokenVerifierForTests,
  clearTokenCache,
} from "../AuthMiddleware";
import { verify as verifyRoomToken } from "../RoomTokenSigner";
import { BOT_WAIT_MS } from "../constants";

interface JoinResponse {
  roomToken: string;
  expiresAt: number;
  mode: string;
  opponent: { userId: string } | null;
}

async function postJson(
  port: number,
  path: string,
  body: object,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  return { status: res.status, body: parsed };
}

async function getJson(
  port: number,
  path: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  return { status: res.status, body: parsed };
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket connect timeout")), 1000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Helper: pair two users instantly (no bot wait) and return the room token
 * payload for the first user (slot 0).
 */
async function pairUsers(
  port: number,
  user1: string,
  user2: string,
  mode: "turn_based" | "pve" = "pve"
): Promise<JoinResponse> {
  const [r1] = await Promise.all([
    postJson(port, "/matchmaking/join", { mode }, user1),
    postJson(port, "/matchmaking/join", { mode }, user2),
  ]);
  return r1.body as JoinResponse;
}

describe("POST /matchmaking/join — T-v0.6-D09", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    clearTokenCache();
    // Mock session verification: any non-empty token becomes `user:<token>`; "BAD" fails.
    setExternalTokenVerifierForTests(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      if (token.startsWith("EXPIRED")) throw new Error("Token expired");
      return { userId: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    handle = await startServer(0);
  });

  afterEach(async () => {
    resetExternalTokenVerifierForTests();
    clearTokenCache();
    await handle.close();
  });

  it("401 when Authorization header is missing", async () => {
    const r = await postJson(handle.port, "/matchmaking/join", { mode: "turn_based" });
    expect(r.status).toBe(401);
  });

  it("401 when token is invalid", async () => {
    const r = await postJson(handle.port, "/matchmaking/join", { mode: "turn_based" }, "BAD");
    expect(r.status).toBe(401);
  });

  it("400 when mode is missing or invalid", async () => {
    const r = await postJson(handle.port, "/matchmaking/join", {}, "alice");
    expect(r.status).toBe(400);
    const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "bogus" }, "alice");
    expect(r2.status).toBe(400);
  });

  it("400 INVALID_MODE when mode is solo (solo is now client-side only)", async () => {
    const r = await postJson(handle.port, "/matchmaking/join", { mode: "solo" }, "alice");
    expect(r.status).toBe(400);
    expect((r.body as { code: string }).code).toBe("INVALID_MODE");
  });

  it("two concurrent requests for the same mode pair up", async () => {
    const [r1, r2] = await Promise.all([
      postJson(handle.port, "/matchmaking/join", { mode: "turn_based" }, "alice"),
      postJson(handle.port, "/matchmaking/join", { mode: "turn_based" }, "bob"),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = r1.body as JoinResponse;
    const b2 = r2.body as JoinResponse;
    const p1 = verifyRoomToken(b1.roomToken)!;
    const p2 = verifyRoomToken(b2.roomToken)!;
    expect(p1.roomId).toBe(p2.roomId);
    expect(b1.opponent?.userId).toBe("user:bob");
    expect(b2.opponent?.userId).toBe("user:alice");
  });

  it("single pve request falls back to bot after BOT_WAIT_MS", async () => {
    const r = await postJson(
      handle.port,
      "/matchmaking/join",
      { mode: "pve" },
      "alice"
    );
    expect(r.status).toBe(200);
    const body = r.body as JoinResponse;
    expect(body.opponent?.userId).toBe("bot:default");
    const payload = verifyRoomToken(body.roomToken);
    expect(payload!.userId).toBe("user:alice");
    expect(payload!.slot).toBe(0);
  }, BOT_WAIT_MS + 2000);

  it("single turn_based request falls back to an authoritative bot match", async () => {
    const r = await postJson(
      handle.port,
      "/matchmaking/join",
      { mode: "turn_based" },
      "alice"
    );
    expect(r.status).toBe(200);
    const body = r.body as JoinResponse;
    expect(body.mode).toBe("turn_based");
    expect(body.opponent?.userId).toBe("bot:default");
    const payload = verifyRoomToken(body.roomToken);
    expect(payload!.userId).toBe("user:alice");
    expect(payload!.slot).toBe(0);
    const room = handle.roomManager.getRoom(payload!.roomId);
    expect(room?.gameMode).toBe("turn_based");
    expect(room?.boardGrid).toBeDefined();
  }, BOT_WAIT_MS + 2000);

  it("409 when the user already has an active room", async () => {
    // Pair alice+bob instantly so alice has an active room with no wait.
    await pairUsers(handle.port, "alice", "bob");
    // Second join attempt for alice must be rejected.
    const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "pve" }, "alice");
    expect(r2.status).toBe(409);
    expect((r2.body as { code: string }).code).toBe("ACTIVE_ROOM");
  });

  it("409 ACCOUNT_IN_USE when the active room slot is connected", async () => {
    const firstJoin = await pairUsers(handle.port, "alice", "bob");
    const socket = ioClient(`http://localhost:${handle.port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth: { token: firstJoin.roomToken },
    });
    try {
      await waitForConnect(socket);

      const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "pve" }, "alice");
      expect(r2.status).toBe(409);
      const body = r2.body as { code: string; message: string };
      expect(body.code).toBe("ACCOUNT_IN_USE");
      expect(body.message).toContain("different device");
    } finally {
      socket.disconnect();
    }
  });

  it("409 ACTIVE_ROOM still allows resume when the active room slot is disconnected", async () => {
    const firstJoin = await pairUsers(handle.port, "alice", "bob");
    const socket = ioClient(`http://localhost:${handle.port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth: { token: firstJoin.roomToken },
    });
    await waitForConnect(socket);
    socket.disconnect();

    const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "pve" }, "alice");
    expect(r2.status).toBe(409);
    const body = r2.body as { code: string; roomId: string };
    expect(body.code).toBe("ACTIVE_ROOM");
    expect(body.roomId).toBe(verifyRoomToken(firstJoin.roomToken)!.roomId);
  });

  it("409 ACCOUNT_IN_USE instead of 425 for duplicate pending joins", async () => {
    const pending = postJson(handle.port, "/matchmaking/join", { mode: "turn_based" }, "alice");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const duplicate = await postJson(
      handle.port,
      "/matchmaking/join",
      { mode: "turn_based" },
      "alice"
    );
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { code: string }).code).toBe("ACCOUNT_IN_USE");

    handle.matchmaking.cancel("user:alice");
    await pending;
  });

  // T-v0.6-G05 · AR-7 single-active-match enforcement
  it("409 response includes the existing roomId so client can call /resume", async () => {
    const firstJoin = await pairUsers(handle.port, "carol", "carol2");
    const firstPayload = verifyRoomToken(firstJoin.roomToken)!;
    const firstRoomId = firstPayload.roomId;

    const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "pve" }, "carol");
    expect(r2.status).toBe(409);
    const body = r2.body as { code: string; roomId: string };
    expect(body.code).toBe("ACTIVE_ROOM");
    // The response must include the existing roomId so the client can call /resume.
    expect(body.roomId).toBe(firstRoomId);
  });

  it("AR-7 enforced across different modes (first pve, then turn_based rejected)", async () => {
    await pairUsers(handle.port, "dave", "dave2", "pve");
    // Attempting a different mode is still rejected.
    const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "turn_based" }, "dave");
    expect(r2.status).toBe(409);
    expect((r2.body as { code: string }).code).toBe("ACTIVE_ROOM");
  });
});

describe("POST /matchmaking/resume — T-v0.6-D10", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    clearTokenCache();
    setExternalTokenVerifierForTests(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      return { userId: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    handle = await startServer(0);
  });

  afterEach(async () => {
    resetExternalTokenVerifierForTests();
    clearTokenCache();
    await handle.close();
  });

  it("returns a fresh token for the caller's active slot", async () => {
    // Pair alice+alice2 to get alice an active room instantly.
    const joinBody = await pairUsers(handle.port, "alice", "alice2");
    const joinPayload = verifyRoomToken(joinBody.roomToken)!;

    const resume = await postJson(
      handle.port,
      "/matchmaking/resume",
      { roomId: joinPayload.roomId },
      "alice"
    );
    expect(resume.status).toBe(200);
    const resumeBody = resume.body as JoinResponse;
    const resumePayload = verifyRoomToken(resumeBody.roomToken)!;
    expect(resumePayload.roomId).toBe(joinPayload.roomId);
    expect(resumePayload.userId).toBe("user:alice");
    expect(resumePayload.slot).toBe(0);
  });

  it("409 ACCOUNT_IN_USE when resuming a slot that is still connected", async () => {
    const joinBody = await pairUsers(handle.port, "alice", "alice2");
    const joinPayload = verifyRoomToken(joinBody.roomToken)!;
    const socket = ioClient(`http://localhost:${handle.port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth: { token: joinBody.roomToken },
    });
    try {
      await waitForConnect(socket);

      const resume = await postJson(
        handle.port,
        "/matchmaking/resume",
        { roomId: joinPayload.roomId },
        "alice"
      );
      expect(resume.status).toBe(409);
      expect((resume.body as { code: string }).code).toBe("ACCOUNT_IN_USE");
    } finally {
      socket.disconnect();
    }
  });

  it("403 when userId is not a slot in the room", async () => {
    const joinBody = await pairUsers(handle.port, "alice", "alice2");
    const joinPayload = verifyRoomToken(joinBody.roomToken)!;
    const resume = await postJson(
      handle.port,
      "/matchmaking/resume",
      { roomId: joinPayload.roomId },
      "eve"
    );
    expect(resume.status).toBe(403);
  });

  it("410 when room does not exist", async () => {
    const resume = await postJson(
      handle.port,
      "/matchmaking/resume",
      { roomId: "nope" },
      "alice"
    );
    expect(resume.status).toBe(410);
  });

  it("400 when roomId is missing", async () => {
    const resume = await postJson(handle.port, "/matchmaking/resume", {}, "alice");
    expect(resume.status).toBe(400);
  });
});

describe("GET /matchmaking/status", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    clearTokenCache();
    setExternalTokenVerifierForTests(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      return { userId: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    handle = await startServer(0);
  });

  afterEach(async () => {
    resetExternalTokenVerifierForTests();
    clearTokenCache();
    await handle.close();
  });

  it("401 when Authorization header is missing", async () => {
    const r = await getJson(handle.port, "/matchmaking/status");
    expect(r.status).toBe(401);
  });

  it("401 when token is invalid", async () => {
    const r = await getJson(handle.port, "/matchmaking/status", "BAD");
    expect(r.status).toBe(401);
  });

  it("{ active: false } when user has no active match", async () => {
    const r = await getJson(handle.port, "/matchmaking/status", "alice");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ active: false });
  });

  it("{ active: true, mode, roomId } when user has an active match", async () => {
    // Pair alice+alice2 to give alice an active pve room instantly.
    const joinBody = await pairUsers(handle.port, "alice", "alice2", "pve");
    const joinPayload = verifyRoomToken(joinBody.roomToken)!;

    const r = await getJson(handle.port, "/matchmaking/status", "alice");
    expect(r.status).toBe(200);
    const body = r.body as { active: boolean; mode: string; roomId: string };
    expect(body.active).toBe(true);
    expect(body.mode).toBe("pve");
    expect(body.roomId).toBe(joinPayload.roomId);
  });

  it("405 when called with POST instead of GET", async () => {
    const r = await postJson(handle.port, "/matchmaking/status", {}, "alice");
    expect(r.status).toBe(405);
  });
});
