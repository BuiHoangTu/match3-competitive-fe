/**
 * T-v0.6-D07 · Reject tokenless sockets (unit test)
 * T-v0.6-D08 · Server-side auth unit tests
 *
 * Tests AuthMiddleware.verifyToken with a fake Admin SDK mock.
 * Also tests that D07 enforces token presence on Socket.IO handshake.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  verifyToken,
  setVerifyIdTokenImpl,
  resetVerifyIdTokenImpl,
  clearTokenCache,
  AuthError,
} from "../AuthMiddleware";
import { AUTH_MISSING_TOKEN, AUTH_INVALID_TOKEN, AUTH_EXPIRED } from "../constants";
import { io as ioClient } from "socket.io-client";
import { startServer, type ServerHandle } from "../server";
import type { AddressInfo } from "net";

// ── D08: verifyToken unit tests ───────────────────────────────────────────────

function makeVerifier(opts: {
  uid?: string;
  exp?: number;
  throws?: string;
}) {
  return async (_token: string) => {
    if (opts.throws) throw new Error(opts.throws);
    return {
      uid: opts.uid ?? "user-abc",
      exp: opts.exp ?? Math.floor(Date.now() / 1000) + 3600,
    };
  };
}

describe("AuthMiddleware.verifyToken (T-v0.6-D08)", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  afterEach(() => {
    resetVerifyIdTokenImpl();
    clearTokenCache();
  });

  it("valid token: returns userId and tokenExpSec", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 3600;
    setVerifyIdTokenImpl(makeVerifier({ uid: "user-123", exp: expSec }));
    const result = await verifyToken("valid-token");
    expect(result.userId).toBe("user-123");
    expect(result.tokenExpSec).toBe(expSec);
  });

  it("expired token: throws AuthError with AUTH_EXPIRED code", async () => {
    setVerifyIdTokenImpl(makeVerifier({ throws: "Token expired" }));
    await expect(verifyToken("expired-token")).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && (e as AuthError).code === AUTH_EXPIRED
    );
  });

  it("tampered/invalid token: throws AuthError with AUTH_INVALID_TOKEN code", async () => {
    setVerifyIdTokenImpl(makeVerifier({ throws: "signature mismatch" }));
    await expect(verifyToken("tampered-token")).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && (e as AuthError).code === AUTH_INVALID_TOKEN
    );
  });

  it("missing token (null): throws AuthError with AUTH_MISSING_TOKEN code", async () => {
    setVerifyIdTokenImpl(makeVerifier({ uid: "irrelevant" }));
    await expect(verifyToken(null)).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && (e as AuthError).code === AUTH_MISSING_TOKEN
    );
  });

  it("missing token (undefined): throws AuthError with AUTH_MISSING_TOKEN code", async () => {
    await expect(verifyToken(undefined)).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && (e as AuthError).code === AUTH_MISSING_TOKEN
    );
  });

  it("token with missing uid claim: throws AuthError with AUTH_INVALID_TOKEN", async () => {
    setVerifyIdTokenImpl(async () => ({ uid: "", exp: Math.floor(Date.now() / 1000) + 3600 }));
    await expect(verifyToken("no-uid-token")).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && (e as AuthError).code === AUTH_INVALID_TOKEN
    );
  });

  it("second verify within TTL hits cache (does not call verifyIdToken again)", async () => {
    let callCount = 0;
    const expSec = Math.floor(Date.now() / 1000) + 3600;
    setVerifyIdTokenImpl(async () => {
      callCount++;
      return { uid: "user-cached", exp: expSec };
    });

    await verifyToken("my-token");
    await verifyToken("my-token");

    // The second call must use the cache — verifyIdToken called exactly once.
    expect(callCount).toBe(1);
  });

  it("different tokens result in separate cache entries", async () => {
    let callCount = 0;
    const expSec = Math.floor(Date.now() / 1000) + 3600;
    setVerifyIdTokenImpl(async (token: string) => {
      callCount++;
      return { uid: `user-${token}`, exp: expSec };
    });

    const r1 = await verifyToken("token-A");
    const r2 = await verifyToken("token-B");
    expect(callCount).toBe(2);
    expect(r1.userId).toBe("user-token-A");
    expect(r2.userId).toBe("user-token-B");
  });

  it("already-expired token (exp in past) throws AUTH_EXPIRED without caching", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10; // 10 s ago
    setVerifyIdTokenImpl(async () => ({ uid: "user-x", exp: pastExp }));
    await expect(verifyToken("stale-token")).rejects.toSatisfy(
      (e: unknown) => e instanceof AuthError && (e as AuthError).code === AUTH_EXPIRED
    );
  });
});

// ── D07: tokenless socket rejection integration test ─────────────────────────

describe("T-v0.6-D07 · Reject tokenless sockets", () => {
  let handle: ServerHandle;

  beforeEach(async () => {
    clearTokenCache();
    handle = await startServer(0);
  });

  afterEach(async () => {
    await handle.close();
    clearTokenCache();
  });

  it("connection without auth.token receives connect_error with no_token", async () => {
    const port = (handle.httpServer.address() as AddressInfo).port;
    const client = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      // No auth: token deliberately omitted.
    });

    const errorCode = await new Promise<string>((resolve) => {
      client.on("connect_error", (err: Error) => {
        resolve(err.message);
      });
    });

    client.disconnect();
    expect(errorCode).toBe("no_token");
  });

  it("connection with an invalid room token receives connect_error with invalid_token", async () => {
    const port = (handle.httpServer.address() as AddressInfo).port;
    const client = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth: { token: "not.a.valid.token" },
    });

    const errorCode = await new Promise<string>((resolve) => {
      client.on("connect_error", (err: Error) => {
        resolve(err.message);
      });
    });

    client.disconnect();
    expect(errorCode).toBe("invalid_token");
  });
});
