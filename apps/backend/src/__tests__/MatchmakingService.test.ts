import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomManager } from "../RoomManager";
import { MatchmakingService } from "../MatchmakingService";
import { verify as verifyRoomToken } from "../RoomTokenSigner";

describe("MatchmakingService (T-v0.6-D09, D10)", () => {
  let rm: RoomManager;
  let svc: MatchmakingService;

  beforeEach(() => {
    rm = new RoomManager();
    // Short bot wait for tests (50 ms).
    svc = new MatchmakingService(rm, null, 50, 60_000);
  });

  afterEach(() => {
    svc.shutdown();
  });

  it("pairs two concurrent requests for the same mode", async () => {
    const p1 = svc.join("alice", "turn_based");
    const p2 = svc.join("bob", "turn_based");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.roomId).toBe(r2.roomId);
    expect(r1.slot).toBe(0);
    expect(r2.slot).toBe(1);
    expect(r1.opponent?.userId).toBe("bob");
    expect(r2.opponent?.userId).toBe("alice");

    // Tokens verify and carry correct claims.
    const p1Payload = verifyRoomToken(r1.roomToken);
    const p2Payload = verifyRoomToken(r2.roomToken);
    expect(p1Payload).not.toBeNull();
    expect(p2Payload).not.toBeNull();
    expect(p1Payload!.userId).toBe("alice");
    expect(p1Payload!.slot).toBe(0);
    expect(p2Payload!.userId).toBe("bob");
    expect(p2Payload!.slot).toBe(1);
    expect(p1Payload!.roomId).toBe(r1.roomId);
  });

  it("falls back to bot match after BOT_WAIT_MS", async () => {
    const result = await svc.join("alice", "turn_based");
    expect(result.opponent?.userId).toBe("bot:default");
    expect(result.slot).toBe(0);
    const room = rm.getRoom(result.roomId);
    expect(room).not.toBeNull();
    expect(room!.userIds[0]).toBe("alice");
    expect(room!.userIds[1]).toBe("bot:default");
  });

  it("different modes do not pair with each other", async () => {
    const p1 = svc.join("alice", "turn_based");
    const p2 = svc.join("bob", "pve");
    // Neither pairs with the other; both fall through to bot.
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.roomId).not.toBe(r2.roomId);
    expect(r1.opponent?.userId).toBe("bot:default");
    expect(r2.opponent?.userId).toBe("bot:default");
  });

  it("cancel removes a waiter before pairing", async () => {
    const p1 = svc.join("alice", "turn_based");
    // Cancel alice before the bot fallback fires and before anyone arrives.
    const ok = svc.cancel("alice");
    expect(ok).toBe(true);
    await expect(p1).rejects.toThrow("matchmaking_cancelled");
  });

  it("resume returns a fresh token for an existing slot", async () => {
    // Pair two users instantly to get alice an active room.
    const p1 = svc.join("alice", "pve");
    const p2 = svc.join("bob", "pve");
    const [result] = await Promise.all([p1, p2]);
    const resumed = svc.resume("alice", result.roomId);
    if ("error" in resumed) throw new Error("expected success");
    expect(resumed.roomId).toBe(result.roomId);
    expect(resumed.slot).toBe(0);
    const payload = verifyRoomToken(resumed.roomToken);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("alice");
  });

  it("resume rejects a user who is not a slot in the room", async () => {
    const p1 = svc.join("alice", "pve");
    const p2 = svc.join("bob", "pve");
    const [result] = await Promise.all([p1, p2]);
    const resumed = svc.resume("eve", result.roomId);
    expect("error" in resumed).toBe(true);
    if ("error" in resumed) expect(resumed.error).toBe("forbidden");
  });

  it("resume returns not_found for unknown roomId", () => {
    const resumed = svc.resume("alice", "nope");
    if ("error" in resumed) expect(resumed.error).toBe("not_found");
    else throw new Error("expected error");
  });
});
