/**
 * T-v0.6-D09 · POST /matchmaking/join
 * T-v0.6-D10 · POST /matchmaking/resume
 * T-v0.6-E06 · User upsert on join (after token verify)
 * T-v0.6-E08 · GET /user/history (auth-required, own rows only)
 * T-v0.6-F01..F04 · POST /account/delete (auth-required, transactional)
 *
 * HTTP endpoints attached to the same httpServer as the Socket.IO engine.
 * We don't add Express — JSON body parsing is done by hand. Requests not
 * matching our paths are ignored (Socket.IO handles /socket.io/*).
 */

import type { IncomingMessage, ServerResponse } from "http";
import { verifyToken, AuthError } from "./AuthMiddleware";
import type { RoomManager } from "./RoomManager";
import type { MatchmakingService, MatchmakingMode } from "./MatchmakingService";
import { AUTH_MISSING_TOKEN, AUTH_INVALID_TOKEN } from "./constants";
import type { PersistenceAdapter } from "./persistence/PersistenceAdapter";
import { deleteAccount } from "./persistence/AccountDeletion";
import * as metrics from "./metrics";
import {
  type LocalAccountStore,
  DuplicateUsernameError,
} from "./persistence/LocalAccountStore";
import { signSession } from "./LocalSessionSigner";
import { RateLimiter } from "./RateLimiter";

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Shared rate limiter for /auth/login and /auth/register.
 * 5 requests per minute per IP — one bucket covers both endpoints so a
 * brute-forcer can't dodge by alternating them.
 */
const _authRateLimiter = new RateLimiter({
  limit: 5,
  windowMs: 60 * 1000,
});

export interface MatchmakingHttpDeps {
  roomManager: RoomManager;
  matchmaking: MatchmakingService;
  persistence: PersistenceAdapter;
  /** Returns whether a socket id is currently connected to this process. */
  isSocketConnected?: (socketId: string) => boolean;
  /**
   * Optional local-account store. When set, /auth/register and /auth/login
   * are wired. When omitted, those endpoints return 503 (auth unavailable).
   */
  localAccounts?: LocalAccountStore;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Permissive CORS — local dev + spare-PC deploy serve the shell on a
// different origin (e.g. :8080) than the backend (:3001). Browsers block
// cross-origin fetch by default. We mirror the request origin (or fall back
// to "*") so the Flutter Web bundle can call /auth/*, /matchmaking/*, etc.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res: ServerResponse, status: number, body: object): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...CORS_HEADERS,
  });
  res.end(json);
}

function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

function extractBearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const match = /^Bearer\s+(.+)$/i.exec(h);
  return match ? match[1].trim() : null;
}

function isValidMode(v: unknown): v is MatchmakingMode {
  return v === "turn_based" || v === "pve";
}

export function createMatchmakingHttpHandler(deps: MatchmakingHttpDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "";

    // ── CORS preflight ─────────────────────────────────────────────────────────
    // Browsers send OPTIONS before any non-simple cross-origin request.
    if (req.method === "OPTIONS") {
      sendNoContent(res);
      return;
    }

    // ── POST /auth/register ────────────────────────────────────────────────────
    if (url === "/auth/register") {
      if (!checkAuthRateLimit(req, res)) return;
      await handleAuthRegister(deps, req, res);
      return;
    }

    // ── POST /auth/login ───────────────────────────────────────────────────────
    if (url === "/auth/login") {
      if (!checkAuthRateLimit(req, res)) return;
      await handleAuthLogin(deps, req, res);
      return;
    }

    // ── GET /healthz ───────────────────────────────────────────────────────────
    if (url === "/healthz") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    // ── GET /user/history ──────────────────────────────────────────────────────
    if (url.startsWith("/user/history")) {
      await handleGetHistory(deps, req, res);
      return;
    }

    // ── POST /account/delete ───────────────────────────────────────────────────
    if (url === "/account/delete") {
      await handleAccountDelete(deps, req, res);
      return;
    }

    // ── /matchmaking/* ─────────────────────────────────────────────────────────
    if (!url.startsWith("/matchmaking/")) return;

    // /matchmaking/status is GET; all others require POST.
    if (url === "/matchmaking/status") {
      if (req.method !== "GET") {
        sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
        return;
      }
      await handleStatus(deps, req, res);
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const token = extractBearerToken(req);
    let userId: string;
    try {
      const verified = await verifyToken(token);
      userId = verified.userId;
    } catch (err) {
      if (err instanceof AuthError) {
        sendJson(res, 401, { code: err.code, message: err.message });
      } else {
        sendJson(res, 401, { code: AUTH_INVALID_TOKEN, message: "Auth failed" });
      }
      return;
    }

    let body: unknown = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      sendJson(res, 400, { code: "BAD_BODY" });
      return;
    }

    if (url === "/matchmaking/join") {
      await handleJoin(deps, userId, body, res);
      return;
    }
    if (url === "/matchmaking/resume") {
      await handleResume(deps, userId, body, res);
      return;
    }
    sendJson(res, 404, { code: "NOT_FOUND" });
  };
}

async function handleJoin(
  deps: MatchmakingHttpDeps,
  userId: string,
  body: unknown,
  res: ServerResponse
): Promise<void> {
  const { roomManager, matchmaking, persistence } = deps;
  const mode = (body as { mode?: unknown }).mode;
  // Forward-compat: old clients that still send mode:"solo" get a clear error.
  if (mode === "solo") {
    sendJson(res, 400, {
      code: "INVALID_MODE",
      message:
        "Solo mode is client-side only — use GET /matchmaking/status to check for active matches before starting.",
    });
    return;
  }
  if (!isValidMode(mode)) {
    sendJson(res, 400, { code: "BAD_MODE" });
    return;
  }

  // AR-7: one active match per userId.
  const existing = roomManager.getRoomByUserId(userId);
  if (existing) {
    const result = matchmaking.resume(userId, existing.id);
    if ("error" in result) {
      sendJson(res, result.error === "forbidden" ? 403 : 410, {
        code: result.error === "forbidden" ? "NOT_A_SLOT" : "ROOM_GONE",
      });
      return;
    }
    sendJson(res, 200, {
      roomToken: result.roomToken,
      expiresAt: result.expiresAt,
      mode: result.mode,
      opponent: result.opponent,
      joinKind: "reconnect",
      reconnected: true,
    });
    return;
  }

  // T-v0.6-E06: upsert user profile (best-effort — don't fail matchmaking on DB error).
  const rawBody = body as { displayName?: unknown; avatarUrl?: unknown; provider?: unknown };
  try {
    await persistence.userStore.upsert({
      userId,
      displayName: typeof rawBody.displayName === "string" ? rawBody.displayName : undefined,
      avatarUrl: typeof rawBody.avatarUrl === "string" ? rawBody.avatarUrl : undefined,
      provider: typeof rawBody.provider === "string" ? rawBody.provider : undefined,
    });
  } catch (err) {
    console.error("[user_store] upsert failed (non-fatal):", (err as Error).message);
  }

  try {
    const result = await matchmaking.join(userId, mode);
    sendJson(res, 201, {
      roomToken: result.roomToken,
      expiresAt: result.expiresAt,
      mode: result.mode,
      opponent: result.opponent,
      joinKind: "new",
      reconnected: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ALREADY_QUEUED") {
      sendJson(res, 409, {
        code: "ACCOUNT_IN_USE",
        message: "This account is already queuing from a different device",
      });
      return;
    }
    sendJson(res, 503, { code: "MATCHMAKING_FAILED", message: msg });
  }
}

async function handleResume(
  deps: MatchmakingHttpDeps,
  userId: string,
  body: unknown,
  res: ServerResponse
): Promise<void> {
  const roomId = (body as { roomId?: unknown }).roomId;
  if (typeof roomId !== "string" || !roomId) {
    sendJson(res, 400, { code: "BAD_ROOM_ID" });
    return;
  }
  const room = deps.roomManager.getRoom(roomId);
  if (room && room.status === "active") {
    const slot = room.userIds[0] === userId ? 0 : room.userIds[1] === userId ? 1 : -1;
    const existingPlayerId =
      slot === -1 ? null : deps.roomManager.getPlayerIdForSlot(room.id, slot as 0 | 1);
    if (
      existingPlayerId &&
      deps.isSocketConnected?.(existingPlayerId) === true
    ) {
      sendJson(res, 409, {
        code: "ACCOUNT_IN_USE",
        roomId: room.id,
        message: "This account is playing from a different device",
      });
      return;
    }
  }
  const result = deps.matchmaking.resume(userId, roomId);
  if ("error" in result) {
    switch (result.error) {
      case "not_found":
      case "closed":
        sendJson(res, 410, { code: "ROOM_GONE" });
        return;
      case "forbidden":
        sendJson(res, 403, { code: "NOT_A_SLOT" });
        return;
    }
  }
  sendJson(res, 200, {
    roomToken: result.roomToken,
    expiresAt: result.expiresAt,
    mode: result.mode,
    opponent: result.opponent,
    joinKind: "reconnect",
    reconnected: true,
  });
}

/**
 * GET /matchmaking/status
 *
 * Auth-required (Bearer token). Returns whether the caller has an active
 * server-side match so the shell can decide whether to launch solo locally
 * or reconnect to an existing room.
 *
 * 200 { active: false }
 * 200 { active: true, mode: "turn_based" | "pve", roomId: string }
 * 401 on auth failure
 */
async function handleStatus(
  deps: MatchmakingHttpDeps,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const token = extractBearerToken(req);
  let userId: string;
  try {
    const verified = await verifyToken(token);
    userId = verified.userId;
  } catch (err) {
    if (err instanceof AuthError) {
      sendJson(res, 401, { code: err.code, message: err.message });
    } else {
      sendJson(res, 401, { code: AUTH_INVALID_TOKEN, message: "Auth failed" });
    }
    return;
  }

  const room = deps.roomManager.getRoomByUserId(userId);
  if (!room) {
    sendJson(res, 200, { active: false });
    return;
  }
  sendJson(res, 200, { active: true, mode: room.gameMode, roomId: room.id });
}

/**
 * T-v0.6-E08 · GET /user/history?limit=20&offset=0
 *
 * Returns the caller's own match history. A user can NEVER query another
 * user's history — userId is always taken from the verified token.
 */
async function handleGetHistory(
  deps: MatchmakingHttpDeps,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const token = extractBearerToken(req);
  let userId: string;
  try {
    const verified = await verifyToken(token);
    userId = verified.userId;
  } catch (err) {
    if (err instanceof AuthError) {
      sendJson(res, 401, { code: err.code, message: err.message });
    } else {
      sendJson(res, 401, { code: AUTH_INVALID_TOKEN, message: "Auth failed" });
    }
    return;
  }

  // Parse query params from URL.
  const urlObj = new URL(req.url ?? "/user/history", "http://localhost");
  const limit = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get("limit") ?? "20", 10) || 20));
  const offset = Math.max(0, parseInt(urlObj.searchParams.get("offset") ?? "0", 10) || 0);

  try {
    const rows = await deps.persistence.matchHistoryStore.listForUser(userId, limit, offset);
    sendJson(res, 200, { rows, limit, offset });
  } catch (err) {
    console.error("[match_history] listForUser failed:", (err as Error).message);
    sendJson(res, 503, { code: "DB_ERROR", message: "Failed to fetch history" });
  }
}

/**
 * T-v0.6-F01..F04 · POST /account/delete
 *
 * Auth-required. Runs the GDPR deletion transaction. Rejects if the caller
 * has an active match (AR-7 interaction).
 */
async function handleAccountDelete(
  deps: MatchmakingHttpDeps,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const token = extractBearerToken(req);
  let userId: string;
  try {
    const verified = await verifyToken(token);
    userId = verified.userId;
  } catch (err) {
    if (err instanceof AuthError) {
      sendJson(res, 401, { code: err.code, message: err.message });
    } else {
      sendJson(res, 401, { code: AUTH_INVALID_TOKEN, message: "Auth failed" });
    }
    return;
  }

  // AR-7: reject if caller has an active match.
  const activeRoom = deps.roomManager.getRoomByUserId(userId);
  if (activeRoom) {
    sendJson(res, 409, {
      code: "ACTIVE_MATCH",
      message: "Cannot delete account while in an active match. End or forfeit the match first.",
    });
    return;
  }

  try {
    const result = await deleteAccount(userId, {
      userStore: deps.persistence.userStore,
      matchHistoryStore: deps.persistence.matchHistoryStore,
    });
    if (result.deleted) {
      // T-v1.0-09: count successful deletions only.
      metrics.increment("account_deletion_count");
    }
    sendJson(res, 200, {
      deleted: result.deleted,
    });
  } catch (err) {
    console.error("[account_deletion] failed:", (err as Error).message);
    sendJson(res, 500, { code: "DELETION_FAILED", message: "Account deletion failed" });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// T-Local-04 · /auth/register and /auth/login
// ───────────────────────────────────────────────────────────────────────────

/**
 * Check rate limit for /auth/* endpoints. Returns true if allowed.
 * On exceed: writes HTTP 429 with Retry-After and returns false.
 */
function checkAuthRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
  const ip = req.socket?.remoteAddress ?? "unknown";
  const result = _authRateLimiter.check(ip);
  if (!result.allowed) {
    const body = JSON.stringify({
      code: "RATE_LIMITED",
      message: "Too many auth attempts, try again later",
    });
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Retry-After": String(result.retryAfterSecs),
      ...CORS_HEADERS,
    });
    res.end(body);
    return false;
  }
  return true;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 200;

interface RegisterBody {
  username?: unknown;
  email?: unknown;
  password?: unknown;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

async function handleAuthRegister(
  deps: MatchmakingHttpDeps,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (!deps.localAccounts) {
    sendJson(res, 503, {
      code: "LOCAL_AUTH_DISABLED",
      message: "Local account auth not configured on this server",
    });
    return;
  }
  let body: RegisterBody = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { code: "BAD_BODY" });
    return;
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const email =
    typeof body.email === "string" && body.email.trim() !== ""
      ? body.email.trim()
      : undefined;
  if (!USERNAME_RE.test(username)) {
    sendJson(res, 400, {
      code: "BAD_USERNAME",
      message:
        "Username must be 3-32 chars, alphanumerics / underscore / hyphen only",
    });
    return;
  }
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    sendJson(res, 400, {
      code: "BAD_PASSWORD",
      message: `Password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters`,
    });
    return;
  }
  try {
    const account = await deps.localAccounts.register({ username, email, password });
    const { token, expiresAt } = signSession({ userId: account.userId });
    sendJson(res, 201, {
      sessionToken: token,
      expiresAt,
      userId: account.userId,
      username: account.username,
    });
  } catch (err) {
    if (err instanceof DuplicateUsernameError) {
      sendJson(res, 409, { code: "USERNAME_TAKEN", message: err.message });
      return;
    }
    console.error("[auth/register] failed:", (err as Error).message);
    sendJson(res, 500, { code: "REGISTER_FAILED", message: "Registration failed" });
  }
}

async function handleAuthLogin(
  deps: MatchmakingHttpDeps,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (!deps.localAccounts) {
    sendJson(res, 503, {
      code: "LOCAL_AUTH_DISABLED",
      message: "Local account auth not configured on this server",
    });
    return;
  }
  let body: LoginBody = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { code: "BAD_BODY" });
    return;
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    sendJson(res, 400, { code: "BAD_BODY", message: "username and password required" });
    return;
  }
  let userId: string | null = null;
  try {
    userId = await deps.localAccounts.login(username, password);
  } catch (err) {
    console.error("[auth/login] failed:", (err as Error).message);
    sendJson(res, 500, { code: "LOGIN_FAILED" });
    return;
  }
  if (!userId) {
    // Same code for "no such user" and "wrong password" — defense in depth.
    sendJson(res, 401, { code: "INVALID_CREDENTIALS" });
    return;
  }
  const { token, expiresAt } = signSession({ userId });
  sendJson(res, 200, {
    sessionToken: token,
    expiresAt,
    userId,
    username,
  });
}

/** Expose helpers for tests. */
export const __test__ = { extractBearerToken, isValidMode, _authRateLimiter };

/**
 * Reset the auth rate limiter between test runs. Only call from test code.
 * The limiter is a module-level singleton; without this, sequential integration
 * tests that make many /auth/* requests exhaust the bucket for loopback IPs.
 */
export function _resetAuthRateLimiterForTests(): void {
  _authRateLimiter.clear();
}

// Silence "unused" lint for AUTH_MISSING_TOKEN since it flows through AuthError.code.
void AUTH_MISSING_TOKEN;
