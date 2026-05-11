/**
 * T-Local-03 · LocalSessionSigner — JWT-signed session tokens for local accounts.
 *
 * Issues standard HS256 JWTs. Claims:
 *   sub  — userId
 *   exp  — expiry (seconds since epoch, standard JWT claim)
 *   iat  — issued-at (seconds since epoch)
 *   kind — "session" (custom claim so AuthMiddleware can identify app sessions)
 *
 * The Flutter client reads `expiresAt` as epoch ms; signSession returns that
 * in ms and verifySession returns exp in ms — both callers expect ms.
 */

import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

export const DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

let _secret: string | null = null;

/**
 * Initialise the signing secret. In production, pass a 32-byte random value
 * from an env var (SESSION_TOKEN_SECRET). In dev/tests, omit and a fresh
 * random secret is generated per process boot.
 */
export function initSessionSecret(secret?: string): void {
  if (secret && secret.length > 0) {
    // Accept either a hex string or a raw passphrase. Hex is preferred for
    // production (use `openssl rand -hex 32`); a passphrase ≥ 16 chars is
    // accepted as-is for dev convenience.
    let buf: Buffer;
    if (/^[0-9a-fA-F]+$/.test(secret) && secret.length >= 32) {
      buf = Buffer.from(secret, "hex");
    } else {
      buf = Buffer.from(secret, "utf8");
    }
    if (buf.length < 16) {
      throw new Error(
        "SESSION_TOKEN_SECRET must be ≥ 16 bytes (32 hex chars or 16 utf8 chars)"
      );
    }
    _secret = buf.toString("hex");
  } else {
    _secret = randomBytes(32).toString("hex");
    console.warn(
      "[LocalSessionSigner] no SESSION_TOKEN_SECRET set — generated ephemeral " +
        "secret for this process. Sessions will not survive a restart."
    );
  }
}

function getSecret(): string {
  if (!_secret) initSessionSecret(process.env.SESSION_TOKEN_SECRET);
  return _secret!;
}

export function signSession(params: {
  userId: string;
  ttlMs?: number;
  now?: number;
}): { token: string; expiresAt: number } {
  const ttl = params.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const nowMs = params.now ?? Date.now();
  const expMs = nowMs + ttl;
  const expSec = Math.floor(expMs / 1000);

  // jsonwebtoken auto-sets iat from real time; exp is passed explicitly.
  // Note: `now` affects exp but not iat (the library controls iat).
  const token = jwt.sign(
    {
      sub: params.userId,
      kind: "session",
      exp: expSec,
    },
    getSecret(),
    { algorithm: "HS256" }
  );

  return { token, expiresAt: expMs };
}

export function verifySession(
  token: string
): { userId: string; exp: number } | null {
  if (!token || typeof token !== "string") return null;

  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, getSecret(), {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
  } catch {
    return null;
  }

  if (
    decoded.kind !== "session" ||
    typeof decoded.sub !== "string" ||
    typeof decoded.exp !== "number"
  ) {
    return null;
  }

  const expMs = decoded.exp * 1000;
  // jwt.verify already checks expiry, but we also guard here for clarity.
  if (expMs <= Date.now()) return null;

  return { userId: decoded.sub, exp: expMs };
}

/** Test helper to reset state between runs. */
export function _resetForTests(): void {
  _secret = null;
}
