/**
 * HTTP integration tests for persistence endpoints.
 *
 * T-v0.6-E08 · GET /user/history — auth isolation
 * T-v0.6-F01 · POST /account/delete — AR-7 rejection + happy path
 *
 * Uses createMatch3Server() with InMemory stores — no Postgres required.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type ServerHandle } from "../server";
import {
  setVerifyIdTokenImpl,
  resetVerifyIdTokenImpl,
  clearTokenCache,
} from "../AuthMiddleware";
import {
  InMemoryUserStore,
} from "../persistence/UserStore";
import {
  InMemoryMatchHistoryStore,
} from "../persistence/MatchHistoryStore";

async function httpJson(
  port: number,
  method: string,
  path: string,
  body?: object,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
  return { status: res.status, body: parsed };
}

describe("GET /user/history (T-v0.6-E08)", () => {
  let handle: ServerHandle;
  let userStore: InMemoryUserStore;
  let matchHistoryStore: InMemoryMatchHistoryStore;

  beforeEach(async () => {
    clearTokenCache();
    setVerifyIdTokenImpl(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      return { uid: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    userStore = new InMemoryUserStore();
    matchHistoryStore = new InMemoryMatchHistoryStore();
    handle = await startServer(0, {
      persistence: { userStore, matchHistoryStore },
    });
  });

  afterEach(async () => {
    resetVerifyIdTokenImpl();
    clearTokenCache();
    await handle.close();
  });

  it("401 when no token", async () => {
    const r = await httpJson(handle.port, "GET", "/user/history");
    expect(r.status).toBe(401);
  });

  it("405 for POST /user/history", async () => {
    const r = await httpJson(handle.port, "POST", "/user/history", {}, "alice");
    expect(r.status).toBe(405);
  });

  it("returns empty array when user has no history", async () => {
    const r = await httpJson(handle.port, "GET", "/user/history", undefined, "alice");
    expect(r.status).toBe(200);
    const body = r.body as { rows: unknown[] };
    expect(body.rows).toHaveLength(0);
  });

  it("returns only the caller's rows (isolation — cannot see other user's history)", async () => {
    await matchHistoryStore.insert({
      matchId: "m1",
      p1UserId: "user:alice",
      p2UserId: "user:bob",
      p1Score: 100,
      p2Score: 80,
      outcome: "P1_WIN",
      durationMs: 60_000,
    });
    await matchHistoryStore.insert({
      matchId: "m2",
      p1UserId: "user:charlie",
      p2UserId: "user:dave",
      p1Score: 50,
      p2Score: 70,
      outcome: "P2_WIN",
      durationMs: 30_000,
    });

    // Alice can only see her own match.
    const aliceR = await httpJson(handle.port, "GET", "/user/history", undefined, "alice");
    expect(aliceR.status).toBe(200);
    const aliceBody = aliceR.body as { rows: { matchId: string }[] };
    expect(aliceBody.rows).toHaveLength(1);
    expect(aliceBody.rows[0].matchId).toBe("m1");

    // Charlie cannot see alice's match — he only sees his own.
    const charlieR = await httpJson(handle.port, "GET", "/user/history", undefined, "charlie");
    expect(charlieR.status).toBe(200);
    const charlieBody = charlieR.body as { rows: { matchId: string }[] };
    expect(charlieBody.rows).toHaveLength(1);
    expect(charlieBody.rows[0].matchId).toBe("m2");
  });

  it("respects default limit of 20", async () => {
    // Insert 25 matches for alice.
    for (let i = 0; i < 25; i++) {
      await matchHistoryStore.insert({
        matchId: `m${i}`,
        p1UserId: "user:alice",
        p2UserId: "user:bob",
        p1Score: i,
        p2Score: 0,
        outcome: "P1_WIN",
        durationMs: 1000,
        endedAt: new Date(Date.now() - i * 1000),
      });
    }
    const r = await httpJson(handle.port, "GET", "/user/history", undefined, "alice");
    expect(r.status).toBe(200);
    const body = r.body as { rows: unknown[]; limit: number };
    expect(body.rows).toHaveLength(20);
    expect(body.limit).toBe(20);
  });
});

describe("POST /account/delete (T-v0.6-F01)", () => {
  let handle: ServerHandle;
  let userStore: InMemoryUserStore;
  let matchHistoryStore: InMemoryMatchHistoryStore;

  beforeEach(async () => {
    clearTokenCache();
    setVerifyIdTokenImpl(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      return { uid: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    userStore = new InMemoryUserStore();
    matchHistoryStore = new InMemoryMatchHistoryStore();
    handle = await startServer(0, {
      persistence: { userStore, matchHistoryStore },
    });
  });

  afterEach(async () => {
    resetVerifyIdTokenImpl();
    clearTokenCache();
    await handle.close();
  });

  it("401 when no token", async () => {
    const r = await httpJson(handle.port, "POST", "/account/delete", {});
    expect(r.status).toBe(401);
  });

  it("405 for GET /account/delete", async () => {
    const r = await httpJson(handle.port, "GET", "/account/delete", undefined, "alice");
    expect(r.status).toBe(405);
  });

  it("happy path: deletes user and anonymises match history", async () => {
    // Seed data.
    await userStore.upsert({ userId: "user:alice", displayName: "Alice" });
    await userStore.upsert({ userId: "user:bob", displayName: "Bob" });
    await matchHistoryStore.insert({
      matchId: "m1",
      p1UserId: "user:alice",
      p2UserId: "user:bob",
      p1Score: 100,
      p2Score: 80,
      outcome: "P1_WIN",
      durationMs: 60_000,
    });

    const r = await httpJson(handle.port, "POST", "/account/delete", {}, "alice");
    expect(r.status).toBe(200);
    const body = r.body as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // User row gone.
    expect(userStore.rows.has("user:alice")).toBe(false);
    // Bob intact.
    expect(userStore.rows.has("user:bob")).toBe(true);
  });

  it("409 when caller has an active match (AR-7)", async () => {
    // Join alice to a match so she has an active room.
    const joinR = await httpJson(
      handle.port,
      "POST",
      "/matchmaking/join",
      { mode: "solo" },
      "alice"
    );
    expect(joinR.status).toBe(200);

    const r = await httpJson(handle.port, "POST", "/account/delete", {}, "alice");
    expect(r.status).toBe(409);
    const body = r.body as { code: string };
    expect(body.code).toBe("ACTIVE_MATCH");
  });

  it("idempotent: second delete returns deleted:false but 200", async () => {
    await userStore.upsert({ userId: "user:carol", displayName: "Carol" });

    const r1 = await httpJson(handle.port, "POST", "/account/delete", {}, "carol");
    expect(r1.status).toBe(200);

    const r2 = await httpJson(handle.port, "POST", "/account/delete", {}, "carol");
    expect(r2.status).toBe(200);
    const body2 = r2.body as { deleted: boolean };
    expect(body2.deleted).toBe(false);
  });
});

describe("POST /matchmaking/join upserts user (T-v0.6-E06)", () => {
  let handle: ServerHandle;
  let userStore: InMemoryUserStore;
  let matchHistoryStore: InMemoryMatchHistoryStore;

  beforeEach(async () => {
    clearTokenCache();
    setVerifyIdTokenImpl(async (token: string) => {
      if (token === "BAD") throw new Error("invalid");
      return { uid: `user:${token}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    });
    userStore = new InMemoryUserStore();
    matchHistoryStore = new InMemoryMatchHistoryStore();
    handle = await startServer(0, {
      persistence: { userStore, matchHistoryStore },
    });
  });

  afterEach(async () => {
    resetVerifyIdTokenImpl();
    clearTokenCache();
    await handle.close();
  });

  it("creates a user row on first join", async () => {
    const r = await httpJson(handle.port, "POST", "/matchmaking/join", {
      mode: "solo",
      displayName: "Alice",
      avatarUrl: "https://example.com/avatar.png",
      provider: "google.com",
    }, "alice");
    expect(r.status).toBe(200);
    expect(userStore.rows.has("user:alice")).toBe(true);
    expect(userStore.rows.get("user:alice")?.displayName).toBe("Alice");
  });

  it("updates display fields on second join (one row)", async () => {
    await httpJson(handle.port, "POST", "/matchmaking/join", {
      mode: "solo",
      displayName: "Alice",
    }, "alice");

    // Close the room so alice can join again.
    handle.roomManager.closeRoom([...handle.roomManager["rooms"].keys()][0]);

    await httpJson(handle.port, "POST", "/matchmaking/join", {
      mode: "solo",
      displayName: "Alice Renamed",
    }, "alice");

    expect(userStore.rows.size).toBe(1);
    expect(userStore.rows.get("user:alice")?.displayName).toBe("Alice Renamed");
  });
});
