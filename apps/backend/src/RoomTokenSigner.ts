import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { ROOM_TOKEN_TTL_MS } from "./constants";

const ROOM_TOKEN_SECRET =
  process.env.ROOM_TOKEN_SECRET ?? randomBytes(32).toString("hex");

if (!process.env.ROOM_TOKEN_SECRET && process.env.NODE_ENV === "production") {
  console.warn(
    "[RoomTokenSigner] ROOM_TOKEN_SECRET is not set — using a random secret. " +
      "Tokens issued by this process will not be verifiable by any other process."
  );
}

export interface RoomTokenPayload {
  roomId: string;
  userId: string;
  slot: 0 | 1;
  iat: number;
  exp: number;
}

export interface SignInput {
  roomId: string;
  userId: string;
  slot: 0 | 1;
  ttlMs?: number;
  now?: number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(padded, "base64");
}

export function sign(input: SignInput): string {
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? ROOM_TOKEN_TTL_MS;
  const payload: RoomTokenPayload = {
    roomId: input.roomId,
    userId: input.userId,
    slot: input.slot,
    iat: now,
    exp: now + ttl,
  };
  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadB64 = base64UrlEncode(payloadBuf);
  const mac = createHmac("sha256", ROOM_TOKEN_SECRET).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(mac);
  return `${payloadB64}.${sigB64}`;
}

export function verify(
  token: string,
  now: number = Date.now()
): RoomTokenPayload | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let providedSig: Buffer;
  try {
    providedSig = base64UrlDecode(sigB64);
  } catch {
    return null;
  }

  const expected = createHmac("sha256", ROOM_TOKEN_SECRET).update(payloadB64).digest();
  if (providedSig.length !== expected.length) return null;
  if (!timingSafeEqual(providedSig, expected)) return null;

  let payload: RoomTokenPayload;
  try {
    const parsed = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.roomId !== "string" ||
      typeof parsed.userId !== "string" ||
      (parsed.slot !== 0 && parsed.slot !== 1) ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    payload = parsed as RoomTokenPayload;
  } catch {
    return null;
  }

  if (now >= payload.exp) return null;
  return payload;
}
