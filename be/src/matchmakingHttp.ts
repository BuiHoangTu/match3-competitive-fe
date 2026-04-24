/**
 * T-v0.6-D09 · POST /matchmaking/join
 * T-v0.6-D10 · POST /matchmaking/resume
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

const MAX_BODY_BYTES = 4 * 1024;

export interface MatchmakingHttpDeps {
  roomManager: RoomManager;
  matchmaking: MatchmakingService;
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

function sendJson(res: ServerResponse, status: number, body: object): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function extractBearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const match = /^Bearer\s+(.+)$/i.exec(h);
  return match ? match[1].trim() : null;
}

function isValidMode(v: unknown): v is MatchmakingMode {
  return v === "turn_based" || v === "pve" || v === "solo";
}

export function createMatchmakingHttpHandler(deps: MatchmakingHttpDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "";
    if (!url.startsWith("/matchmaking/")) return;

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
  const { roomManager, matchmaking } = deps;
  const mode = (body as { mode?: unknown }).mode;
  if (!isValidMode(mode)) {
    sendJson(res, 400, { code: "BAD_MODE" });
    return;
  }

  // AR-7: one active match per userId.
  const existing = roomManager.getRoomByUserId(userId);
  if (existing) {
    sendJson(res, 409, {
      code: "ACTIVE_ROOM",
      roomId: existing.id,
      message: "User already has an active match; call /matchmaking/resume instead",
    });
    return;
  }

  try {
    const result = await matchmaking.join(userId, mode);
    sendJson(res, 200, {
      roomToken: result.roomToken,
      expiresAt: result.expiresAt,
      mode: result.mode,
      opponent: result.opponent,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
  });
}

/** Expose helpers for tests. */
export const __test__ = { extractBearerToken, isValidMode };
// Silence "unused" lint for AUTH_MISSING_TOKEN since it flows through AuthError.code.
void AUTH_MISSING_TOKEN;
