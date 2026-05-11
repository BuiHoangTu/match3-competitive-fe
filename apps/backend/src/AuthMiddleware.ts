/**
 * T-v0.6-D01 · JWT verification middleware
 * T-v0.6-D03 · Attach userId to socket context
 * T-v0.6-D05 · In-memory token cache
 * T-v0.6-D06 · Emit auth_token_rejected on stale/invalid token mid-session
 *
 * Uses local backend session tokens. Caches results keyed by SHA-256 of the raw
 * token. TTL = min(exp - now, TOKEN_CACHE_MAX_TTL_MS).
 */

import { createHash } from "crypto";
import type { Socket } from "socket.io";
import { AUTH_MISSING_TOKEN, AUTH_INVALID_TOKEN, AUTH_EXPIRED, type AuthErrorCode } from "./constants";
import { verifySession } from "./LocalSessionSigner";

/** Maximum time to keep a cached result even if token expiry is longer. */
const TOKEN_CACHE_MAX_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Verified token result stored in the cache. */
interface CacheEntry {
  userId: string;
  /** Absolute epoch (ms) when this cache entry expires. */
  expiresAtMs: number;
  /** Original token exp field (seconds since epoch) from the JWT. */
  tokenExpSec: number;
}

/** SHA-256 hash of token string → CacheEntry. */
const tokenCache = new Map<string, CacheEntry>();

type ExternalTokenVerifier = (token: string) => Promise<{ userId: string; exp?: number }>;

let externalTokenVerifierForTests: ExternalTokenVerifier | null = null;

/** Clear the entire token cache (useful between tests). */
export function clearTokenCache(): void {
  tokenCache.clear();
}

export function setExternalTokenVerifierForTests(verifier: ExternalTokenVerifier): void {
  externalTokenVerifierForTests = verifier;
}

export function resetExternalTokenVerifierForTests(): void {
  externalTokenVerifierForTests = null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowMs(): number {
  return Date.now();
}

/** Evict expired entries (best-effort, called on every cache access). */
function evictExpired(): void {
  const now = nowMs();
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAtMs <= now) {
      tokenCache.delete(key);
    }
  }
}

export interface VerifiedToken {
  userId: string;
  /** Token expiry in seconds since epoch. */
  tokenExpSec: number;
}

/**
 * Verify an id_token and return the userId. Caches successful results.
 *
 * @throws {AuthError} on missing, invalid, or expired token.
 */
export async function verifyToken(token: string | undefined | null): Promise<VerifiedToken> {
  if (!token) {
    throw new AuthError(AUTH_MISSING_TOKEN, "No token provided");
  }

  const hash = hashToken(token);
  evictExpired();

  const cached = tokenCache.get(hash);
  if (cached && cached.expiresAtMs > nowMs()) {
    // Check if the underlying JWT has expired even though we have a cache hit.
    // This guards against the case where TTL < JWT exp but JWT was revoked
    // or expired in the meantime — the cache entry's expiresAtMs already
    // accounts for tokenExp, so this is just a belt-and-suspenders check.
    if (cached.tokenExpSec * 1000 <= nowMs()) {
      tokenCache.delete(hash);
      throw new AuthError(AUTH_EXPIRED, "Token expired (cached expiry)");
    }
    return { userId: cached.userId, tokenExpSec: cached.tokenExpSec };
  }

  // T-Local-04 · Local session token first. Shape is base64url.base64url
  // and the payload includes kind:"session". Cheap (HMAC, no network).
  const localResult = verifySession(token);
  if (localResult) {
    const tokenExpSec = Math.floor(localResult.exp / 1000);
    const tokenExpMs = localResult.exp;
    const ttlMs = Math.min(tokenExpMs - nowMs(), TOKEN_CACHE_MAX_TTL_MS);
    if (ttlMs <= 0) throw new AuthError(AUTH_EXPIRED, "Token already expired");
    tokenCache.set(hash, {
      userId: localResult.userId,
      expiresAtMs: nowMs() + ttlMs,
      tokenExpSec,
    });
    return { userId: localResult.userId, tokenExpSec };
  }

  if (externalTokenVerifierForTests) {
    try {
      const result = await externalTokenVerifierForTests(token);
      if (!result.userId) {
        throw new AuthError(AUTH_INVALID_TOKEN, "Token missing user id");
      }

      const tokenExpSec = result.exp ?? Math.floor((nowMs() + TOKEN_CACHE_MAX_TTL_MS) / 1000);
      const tokenExpMs = tokenExpSec * 1000;
      const ttlMs = Math.min(tokenExpMs - nowMs(), TOKEN_CACHE_MAX_TTL_MS);
      if (ttlMs <= 0) throw new AuthError(AUTH_EXPIRED, "Token already expired");

      tokenCache.set(hash, {
        userId: result.userId,
        expiresAtMs: nowMs() + ttlMs,
        tokenExpSec,
      });
      return { userId: result.userId, tokenExpSec };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("expired")) {
        throw new AuthError(AUTH_EXPIRED, message);
      }
      throw new AuthError(AUTH_INVALID_TOKEN, message);
    }
  }

  throw new AuthError(AUTH_INVALID_TOKEN, "Token not a valid local session");
}

/** Structured error thrown by {@link verifyToken}. */
export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Socket.IO `use` middleware factory (T-v0.6-D02).
 *
 * Usage:
 *   io.use(authMiddleware());
 *
 * On success: sets socket.data.userId and socket.data.tokenExpSec, calls next().
 * On failure: calls next(error) with a message in the form "<CODE>:<message>".
 */
export function authMiddleware() {
  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    const token = socket.handshake.auth?.token as string | undefined;
    try {
      const { userId, tokenExpSec } = await verifyToken(token);
      socket.data.userId = userId;
      socket.data.tokenExpSec = tokenExpSec;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        next(new Error(`${err.code}:${err.message}`));
      } else {
        next(new Error(`${AUTH_INVALID_TOKEN}:Unknown auth error`));
      }
    }
  };
}

/**
 * Re-check the token attached to a socket on sensitive events (T-v0.6-D06).
 *
 * If the cached token has expired, emits `auth_token_rejected` and disconnects.
 * Returns true if the token is still valid, false if it was rejected.
 *
 * Usage inside a socket event handler:
 *   if (!(await checkTokenExpiry(socket))) return;
 */
export async function checkTokenExpiry(socket: Socket): Promise<boolean> {
  const tokenExpSec = socket.data.tokenExpSec as number | undefined;
  if (tokenExpSec !== undefined && tokenExpSec * 1000 <= nowMs()) {
    socket.emit("auth_token_rejected", { code: AUTH_EXPIRED, reason: "Token expired" });
    socket.disconnect(true);
    return false;
  }
  return true;
}
