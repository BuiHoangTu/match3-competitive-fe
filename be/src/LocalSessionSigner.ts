/**
 * T-Local-03 · LocalSessionSigner — HMAC-signed session tokens for local accounts.
 *
 * Mirrors RoomTokenSigner but with a different secret, longer TTL (7 days),
 * and a different `kind` claim ("session"). The same downstream verifier in
 * AuthMiddleware can recognise tokens with `kind: "session"` and treat them
 * as Firebase-equivalent (just yielding {userId} without a Firebase call).
 *
 * Format: base64url(payload).base64url(hmacSha256(payload))
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  kind: "session";
  userId: string;
  /** Epoch ms when this token expires. */
  exp: number;
}

let _secret: Buffer | null = null;

/**
 * Initialise the signing secret. In production, pass a 32-byte random value
 * from an env var (SESSION_TOKEN_SECRET). In dev/tests, omit and a fresh
 * random secret is generated per process boot.
 */
export function initSessionSecret(secretHex?: string): void {
  if (secretHex) {
    const buf = Buffer.from(secretHex, "hex");
    if (buf.length < 16) {
      throw new Error("SESSION_TOKEN_SECRET must be ≥ 16 bytes (32 hex chars)");
    }
    _secret = buf;
  } else {
    _secret = randomBytes(32);
    console.warn(
      "[LocalSessionSigner] no SESSION_TOKEN_SECRET set — generated ephemeral " +
        "secret for this process. Sessions will not survive a restart."
    );
  }
}

function getSecret(): Buffer {
  if (!_secret) initSessionSecret(process.env.SESSION_TOKEN_SECRET);
  return _secret!;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  let pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  else if (pad === 1) throw new Error("invalid base64url length");
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signSession(params: {
  userId: string;
  ttlMs?: number;
  now?: number;
}): { token: string; expiresAt: number } {
  const ttl = params.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = params.now ?? Date.now();
  const exp = now + ttl;
  const payload: SessionPayload = {
    kind: "session",
    userId: params.userId,
    exp,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  const sigB64 = b64url(sig);
  return { token: `${payloadB64}.${sigB64}`, expiresAt: exp };
}

export function verifySession(
  token: string
): { userId: string; exp: number } | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest();
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return null;
  }

  let payload: SessionPayload;
  try {
    const json = b64urlDecode(payloadB64).toString("utf8");
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  if (
    payload.kind !== "session" ||
    typeof payload.userId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.exp <= Date.now()) return null;
  return { userId: payload.userId, exp: payload.exp };
}

/** Test helper to reset state between runs. */
export function _resetForTests(): void {
  _secret = null;
}
