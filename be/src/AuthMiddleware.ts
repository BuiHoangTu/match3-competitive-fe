/**
 * T-v0.6-D01 · JWT verification middleware
 * T-v0.6-D03 · Attach userId to socket context
 * T-v0.6-D05 · In-memory token cache
 * T-v0.6-D06 · Emit auth_token_rejected on stale/invalid token mid-session
 *
 * Uses firebase-admin/auth verifyIdToken. Caches results keyed by SHA-256 of
 * the raw token. TTL = min(exp - now, TOKEN_CACHE_MAX_TTL_MS).
 *
 * NOTE: firebase-admin requires initialisation before use. Production deployments
 * must call `initializeApp()` with a service-account credential before this
 * module is imported. Tests can mock the module or initialise with
 * `initializeApp({ projectId: 'test' })` before calling verifyToken.
 */

import { createHash } from "crypto";
import type { Socket } from "socket.io";
import { AUTH_MISSING_TOKEN, AUTH_INVALID_TOKEN, AUTH_EXPIRED, type AuthErrorCode } from "./constants";

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

/** Lazy-loaded verifyIdToken function to allow test mocking. */
type VerifyIdTokenFn = (token: string) => Promise<{ uid: string; exp: number }>;

/** Injectable verifier — defaults to real firebase-admin; overridden in tests. */
let _verifyIdToken: VerifyIdTokenFn | null = null;

/**
 * Override the verifyIdToken implementation. Call this in tests to avoid
 * hitting the real Firebase Admin SDK.
 */
export function setVerifyIdTokenImpl(fn: VerifyIdTokenFn): void {
  _verifyIdToken = fn;
}

/**
 * Reset to the real firebase-admin implementation. Useful after tests.
 */
export function resetVerifyIdTokenImpl(): void {
  _verifyIdToken = null;
}

/** SHA-256 hash of token string → CacheEntry. */
const tokenCache = new Map<string, CacheEntry>();

/** Clear the entire token cache (useful between tests). */
export function clearTokenCache(): void {
  tokenCache.clear();
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

async function getVerifier(): Promise<VerifyIdTokenFn> {
  if (_verifyIdToken) return _verifyIdToken;
  // Lazy-load real firebase-admin/auth to allow test mocking without importing
  const { getAuth } = await import("firebase-admin/auth");
  return (token: string) => getAuth().verifyIdToken(token);
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

  let decoded: { uid: string; exp: number };
  try {
    const verifier = await getVerifier();
    decoded = await verifier(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/expired|exp/i.test(msg)) {
      throw new AuthError(AUTH_EXPIRED, `Token expired: ${msg}`);
    }
    throw new AuthError(AUTH_INVALID_TOKEN, `Token invalid: ${msg}`);
  }

  if (!decoded.uid) {
    throw new AuthError(AUTH_INVALID_TOKEN, "Token missing uid claim");
  }

  const tokenExpMs = decoded.exp * 1000;
  const ttlMs = Math.min(tokenExpMs - nowMs(), TOKEN_CACHE_MAX_TTL_MS);
  if (ttlMs <= 0) {
    throw new AuthError(AUTH_EXPIRED, "Token already expired");
  }

  const entry: CacheEntry = {
    userId: decoded.uid,
    expiresAtMs: nowMs() + ttlMs,
    tokenExpSec: decoded.exp,
  };
  tokenCache.set(hash, entry);

  return { userId: decoded.uid, tokenExpSec: decoded.exp };
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
