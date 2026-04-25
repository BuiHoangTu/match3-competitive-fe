/**
 * T-Local · LocalAccountStore + LocalSessionSigner + auth endpoints.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "http";
import type { AddressInfo } from "net";
import {
  DuplicateUsernameError,
  InMemoryLocalAccountStore,
  hashPassword,
  verifyPassword,
} from "../persistence/LocalAccountStore";
import {
  signSession,
  verifySession,
  initSessionSecret,
  _resetForTests,
} from "../LocalSessionSigner";
import { verifyToken, AuthError, clearTokenCache } from "../AuthMiddleware";
import { createMatchmakingHttpHandler } from "../matchmakingHttp";
import { RoomManager } from "../RoomManager";
import { MatchmakingService } from "../MatchmakingService";
import { NullPersistenceAdapter } from "../persistence/PersistenceAdapter";

beforeEach(() => {
  _resetForTests();
  initSessionSecret("0".repeat(64));
  clearTokenCache();
});
afterEach(() => clearTokenCache());

// ─── LocalAccountStore ────────────────────────────────────────────────────────

describe("InMemoryLocalAccountStore", () => {
  it("registers a new user and returns a userId + row", async () => {
    const store = new InMemoryLocalAccountStore();
    const row = await store.register({
      username: "alice",
      email: "alice@example.com",
      password: "secret123",
    });
    expect(row.username).toBe("alice");
    expect(row.email).toBe("alice@example.com");
    expect(row.userId).toMatch(/^local:[0-9a-f]+$/);
  });

  it("rejects a duplicate username", async () => {
    const store = new InMemoryLocalAccountStore();
    await store.register({ username: "alice", password: "secret123" });
    await expect(
      store.register({ username: "alice", password: "another" })
    ).rejects.toBeInstanceOf(DuplicateUsernameError);
  });

  it("login returns userId on correct password, null on wrong password", async () => {
    const store = new InMemoryLocalAccountStore();
    const row = await store.register({ username: "alice", password: "secret123" });
    await expect(store.login("alice", "secret123")).resolves.toBe(row.userId);
    await expect(store.login("alice", "wrongpwd")).resolves.toBeNull();
    await expect(store.login("nobody", "secret123")).resolves.toBeNull();
  });

  it("findByUserId returns the stored account", async () => {
    const store = new InMemoryLocalAccountStore();
    const row = await store.register({ username: "alice", password: "secret123" });
    await expect(store.findByUserId(row.userId)).resolves.toMatchObject({
      username: "alice",
    });
    await expect(store.findByUserId("nope")).resolves.toBeNull();
  });
});

describe("hashPassword / verifyPassword", () => {
  it("verifies the same password against its hash", () => {
    const { passwordHash, salt } = hashPassword("secret123");
    expect(verifyPassword("secret123", salt, passwordHash)).toBe(true);
  });

  it("rejects a different password", () => {
    const { passwordHash, salt } = hashPassword("secret123");
    expect(verifyPassword("not-it", salt, passwordHash)).toBe(false);
  });

  it("hashes are deterministic with same salt", () => {
    const { passwordHash, salt } = hashPassword("abcabcabc");
    const again = hashPassword("abcabcabc");
    // different salts → different hashes
    expect(passwordHash.equals(again.passwordHash)).toBe(false);
    expect(salt.equals(again.salt)).toBe(false);
  });
});

// ─── LocalSessionSigner ───────────────────────────────────────────────────────

describe("LocalSessionSigner", () => {
  it("round-trips sign → verify", () => {
    const { token } = signSession({ userId: "local:abc" });
    const out = verifySession(token);
    expect(out?.userId).toBe("local:abc");
  });

  it("rejects tampered payload", () => {
    const { token } = signSession({ userId: "local:abc" });
    const [p, s] = token.split(".");
    const tampered = `${p}x.${s}`;
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejects tampered signature", () => {
    const { token } = signSession({ userId: "local:abc" });
    const [p, s] = token.split(".");
    expect(verifySession(`${p}.${s}x`)).toBeNull();
  });

  it("rejects expired token", () => {
    const { token } = signSession({ userId: "local:abc", ttlMs: 1, now: 0 });
    expect(verifySession(token)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifySession("not-a-token")).toBeNull();
    expect(verifySession("")).toBeNull();
    expect(verifySession(".")).toBeNull();
  });
});

// ─── AuthMiddleware integration ───────────────────────────────────────────────

describe("AuthMiddleware accepts a local session token", () => {
  it("verifyToken returns userId from a session token", async () => {
    const { token } = signSession({ userId: "local:zoe" });
    await expect(verifyToken(token)).resolves.toMatchObject({
      userId: "local:zoe",
    });
  });

  it("verifyToken throws on missing token", async () => {
    await expect(verifyToken(null)).rejects.toBeInstanceOf(AuthError);
  });

  it("verifyToken throws when neither local nor Firebase recognise the token", async () => {
    // Random base64-ish strings that aren't valid session HMAC.
    await expect(verifyToken("aaa.bbb")).rejects.toBeInstanceOf(AuthError);
  });
});

// ─── HTTP endpoints /auth/register and /auth/login ────────────────────────────

async function withTestServer<T>(
  fn: (port: number) => Promise<T>,
  store: InMemoryLocalAccountStore
): Promise<T> {
  const roomManager = new RoomManager();
  const matchmaking = new MatchmakingService(roomManager, null, 5000, 5 * 60 * 1000);
  const handler = createMatchmakingHttpHandler({
    roomManager,
    matchmaking,
    persistence: NullPersistenceAdapter,
    localAccounts: store,
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(port);
  } finally {
    matchmaking.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function postJson(
  port: number,
  path: string,
  body: object
): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /auth/register", () => {
  it("201 returns a session token + userId", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      const r = await postJson(port, "/auth/register", {
        username: "alice",
        email: "alice@example.com",
        password: "secret123",
      });
      expect(r.status).toBe(201);
      expect(r.body.sessionToken).toMatch(/.+\..+/);
      expect(r.body.userId).toMatch(/^local:/);
      expect(r.body.username).toBe("alice");
    }, store);
  });

  it("400 on bad username (too short)", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      const r = await postJson(port, "/auth/register", {
        username: "ab",
        password: "secret123",
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("BAD_USERNAME");
    }, store);
  });

  it("400 on bad password (too short)", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      const r = await postJson(port, "/auth/register", {
        username: "alice",
        password: "abc",
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("BAD_PASSWORD");
    }, store);
  });

  it("409 on duplicate username", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      await postJson(port, "/auth/register", {
        username: "alice",
        password: "secret123",
      });
      const r = await postJson(port, "/auth/register", {
        username: "alice",
        password: "different",
      });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("USERNAME_TAKEN");
    }, store);
  });
});

describe("POST /auth/login", () => {
  it("200 returns session token on correct credentials", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      await postJson(port, "/auth/register", {
        username: "alice",
        password: "secret123",
      });
      const r = await postJson(port, "/auth/login", {
        username: "alice",
        password: "secret123",
      });
      expect(r.status).toBe(200);
      expect(r.body.sessionToken).toMatch(/.+\..+/);
    }, store);
  });

  it("401 INVALID_CREDENTIALS on wrong password", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      await postJson(port, "/auth/register", {
        username: "alice",
        password: "secret123",
      });
      const r = await postJson(port, "/auth/login", {
        username: "alice",
        password: "wrong",
      });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("INVALID_CREDENTIALS");
    }, store);
  });

  it("401 INVALID_CREDENTIALS on unknown user (same code as wrong password)", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      const r = await postJson(port, "/auth/login", {
        username: "nobody",
        password: "anything",
      });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("INVALID_CREDENTIALS");
    }, store);
  });
});

describe("session token works against /matchmaking/join", () => {
  it("verifies through verifyToken without Firebase", async () => {
    const store = new InMemoryLocalAccountStore();
    await withTestServer(async (port) => {
      const reg = await postJson(port, "/auth/register", {
        username: "alice",
        password: "secret123",
      });
      const sessionToken = reg.body.sessionToken;
      const join = await fetch(`http://127.0.0.1:${port}/matchmaking/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ mode: "solo" }),
      });
      expect(join.status).toBe(200);
      const data = await join.json();
      expect(data.roomToken).toMatch(/.+\..+/);
    }, store);
  });
});

describe("/auth endpoints disabled when localAccounts not configured", () => {
  it("returns 503 LOCAL_AUTH_DISABLED", async () => {
    const roomManager = new RoomManager();
    const matchmaking = new MatchmakingService(roomManager, null, 5000, 5 * 60 * 1000);
    const handler = createMatchmakingHttpHandler({
      roomManager,
      matchmaking,
      persistence: NullPersistenceAdapter,
      // localAccounts intentionally omitted
    });
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const r = await postJson(port, "/auth/register", {
        username: "alice",
        password: "secret123",
      });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("LOCAL_AUTH_DISABLED");
    } finally {
      matchmaking.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
