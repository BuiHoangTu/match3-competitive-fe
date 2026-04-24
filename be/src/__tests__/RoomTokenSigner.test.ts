import { describe, expect, it } from "vitest";
import { sign, verify } from "../RoomTokenSigner";

const baseInput = {
  roomId: "room-abc",
  userId: "user-alice",
  slot: 0 as const,
  seed: 12345,
};

describe("RoomTokenSigner (T-v0.6-D11)", () => {
  it("round-trip: verify decodes the input claims", () => {
    const now = 1_700_000_000_000;
    const token = sign({ ...baseInput, now, ttlMs: 60_000 });
    const payload = verify(token, now);
    expect(payload).not.toBeNull();
    expect(payload!.roomId).toBe("room-abc");
    expect(payload!.userId).toBe("user-alice");
    expect(payload!.slot).toBe(0);
    expect(payload!.seed).toBe(12345);
    expect(payload!.iat).toBe(now);
    expect(payload!.exp).toBe(now + 60_000);
  });

  it("tampered payload returns null", () => {
    const token = sign(baseInput);
    const [payloadB64, sigB64] = token.split(".");
    // Flip one character in the payload.
    const flipped =
      payloadB64.slice(0, -1) + (payloadB64.slice(-1) === "A" ? "B" : "A");
    const tampered = `${flipped}.${sigB64}`;
    expect(verify(tampered)).toBeNull();
  });

  it("tampered signature returns null", () => {
    const token = sign(baseInput);
    const [payloadB64, sigB64] = token.split(".");
    const flipped =
      sigB64.slice(0, -1) + (sigB64.slice(-1) === "A" ? "B" : "A");
    const tampered = `${payloadB64}.${flipped}`;
    expect(verify(tampered)).toBeNull();
  });

  it("expired token returns null", () => {
    const now = 1_700_000_000_000;
    const token = sign({ ...baseInput, now, ttlMs: 1000 });
    // one ms past expiry
    expect(verify(token, now + 1001)).toBeNull();
  });

  it("malformed token returns null", () => {
    expect(verify("")).toBeNull();
    expect(verify("no-dot-here")).toBeNull();
    expect(verify(".sig-only")).toBeNull();
    expect(verify("payload-only.")).toBeNull();
    expect(verify("!!!.@@@")).toBeNull();
  });

  it("slot values are constrained to 0 or 1 by type system — verified payload preserves them", () => {
    const t0 = sign({ ...baseInput, slot: 0 });
    const t1 = sign({ ...baseInput, slot: 1 });
    expect(verify(t0)!.slot).toBe(0);
    expect(verify(t1)!.slot).toBe(1);
  });

  it("different claims produce different tokens", () => {
    const t1 = sign({ ...baseInput, roomId: "room-1" });
    const t2 = sign({ ...baseInput, roomId: "room-2" });
    expect(t1).not.toBe(t2);
  });

  it("valid token at the exact exp boundary is rejected (strict >=)", () => {
    const now = 1_700_000_000_000;
    const token = sign({ ...baseInput, now, ttlMs: 1000 });
    // exp = now + 1000. verify() rejects when now >= exp.
    expect(verify(token, now + 999)).not.toBeNull();
    expect(verify(token, now + 1000)).toBeNull();
  });
});
