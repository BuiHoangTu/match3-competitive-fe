/**
 * T-v0.6-D09, D10 — HTTP integration tests for /matchmaking/join and /resume.
 *
 * Uses the in-process createMatch3Server() factory. Mocks the Firebase Admin
 * verifyIdToken via setVerifyIdTokenImpl so no Firebase project is required.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type ServerHandle } from "../server";
import {
  setVerifyIdTokenImpl,
  resetVerifyIdTokenImpl,
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

describe("POST /matchmaking/join — T-v0.6-D09", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    clearTokenCache();
    // Mock Firebase: any non-empty token becomes `user:<token>`; "BAD" fails.
    setVerifyIdTokenImpl(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      if (token.startsWith("EXPIRED")) throw new Error("Token expired");
      return { uid: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    handle = await startServer(0);
  });

  afterEach(async () => {
    resetVerifyIdTokenImpl();
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

  it("solo match returns a room token with no opponent", async () => {
    const r = await postJson(handle.port, "/matchmaking/join", { mode: "solo" }, "alice");
    expect(r.status).toBe(200);
    const body = r.body as JoinResponse;
    expect(body.mode).toBe("solo");
    expect(body.opponent).toBeNull();
    const payload = verifyRoomToken(body.roomToken);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user:alice");
    expect(payload!.slot).toBe(0);
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

  it("single request falls back to bot after BOT_WAIT_MS", async () => {
    const r = await postJson(
      handle.port,
      "/matchmaking/join",
      { mode: "turn_based" },
      "alice"
    );
    expect(r.status).toBe(200);
    const body = r.body as JoinResponse;
    expect(body.opponent?.userId).toBe("bot:default");
    const payload = verifyRoomToken(body.roomToken);
    expect(payload!.userId).toBe("user:alice");
    expect(payload!.slot).toBe(0);
  }, BOT_WAIT_MS + 2000);

  it("409 when the user already has an active room", async () => {
    // First request gets a room via bot fallback.
    const r1 = await postJson(handle.port, "/matchmaking/join", { mode: "solo" }, "alice");
    expect(r1.status).toBe(200);
    // Second immediate request should be rejected.
    const r2 = await postJson(handle.port, "/matchmaking/join", { mode: "solo" }, "alice");
    expect(r2.status).toBe(409);
    expect((r2.body as { code: string }).code).toBe("ACTIVE_ROOM");
  });
});

describe("POST /matchmaking/resume — T-v0.6-D10", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    clearTokenCache();
    setVerifyIdTokenImpl(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      return { uid: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    handle = await startServer(0);
  });

  afterEach(async () => {
    resetVerifyIdTokenImpl();
    clearTokenCache();
    await handle.close();
  });

  it("returns a fresh token for the caller's active slot", async () => {
    const join = await postJson(
      handle.port,
      "/matchmaking/join",
      { mode: "solo" },
      "alice"
    );
    const joinBody = join.body as JoinResponse;
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

  it("403 when userId is not a slot in the room", async () => {
    const join = await postJson(
      handle.port,
      "/matchmaking/join",
      { mode: "solo" },
      "alice"
    );
    const joinPayload = verifyRoomToken((join.body as JoinResponse).roomToken)!;
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
    const resume = await postJson(
      handle.port,
      "/matchmaking/resume",
      {},
      "alice"
    );
    expect(resume.status).toBe(400);
  });
});
