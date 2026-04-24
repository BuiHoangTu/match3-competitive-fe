import type { RoomManager, Room } from "./RoomManager";
import type { BotManager } from "./BotManager";
import { sign as signRoomToken } from "./RoomTokenSigner";
import { BOT_USER_ID, BOT_WAIT_MS, ROOM_TOKEN_TTL_MS } from "./constants";

export type MatchmakingMode = "turn_based" | "pve" | "solo";

export interface MatchmakingResult {
  roomToken: string;
  expiresAt: number;
  roomId: string;
  slot: 0 | 1;
  mode: MatchmakingMode;
  opponent: { userId: string } | null;
}

interface Pending {
  userId: string;
  mode: MatchmakingMode;
  resolve: (result: MatchmakingResult) => void;
  reject: (err: Error) => void;
  botTimer: ReturnType<typeof setTimeout> | null;
}

export class MatchmakingService {
  private waiting: Map<MatchmakingMode, Pending[]> = new Map();

  constructor(
    private roomManager: RoomManager,
    private botManager: BotManager | null = null,
    private botWaitMs: number = BOT_WAIT_MS,
    private roomTokenTtlMs: number = ROOM_TOKEN_TTL_MS
  ) {}

  /**
   * Enqueue a matchmaking request. Resolves when paired with a human (another
   * waiting request for the same mode) or when the bot fallback timer fires.
   *
   * T-v0.6-D09.
   */
  join(userId: string, mode: MatchmakingMode): Promise<MatchmakingResult> {
    return new Promise<MatchmakingResult>((resolve, reject) => {
      // Solo mode short-circuits with no opponent, no token enqueue — the client
      // gets a room token for a solo-play room.
      if (mode === "solo") {
        const result = this.createSoloMatch(userId);
        resolve(result);
        return;
      }

      const queue = this.waiting.get(mode) ?? [];

      // Pair with the oldest waiter for the same mode, if any.
      const partner = queue.shift();
      if (partner) {
        if (partner.botTimer) clearTimeout(partner.botTimer);
        this.waiting.set(mode, queue);
        const { partnerResult, selfResult } = this.createHumanMatch(
          partner.userId,
          userId,
          mode
        );
        partner.resolve(partnerResult);
        resolve(selfResult);
        return;
      }

      // No partner available — enqueue and set bot-fallback timer.
      const pending: Pending = {
        userId,
        mode,
        resolve,
        reject,
        botTimer: null,
      };
      queue.push(pending);
      this.waiting.set(mode, queue);

      pending.botTimer = setTimeout(() => {
        const currentQueue = this.waiting.get(mode) ?? [];
        const idx = currentQueue.indexOf(pending);
        if (idx === -1) return; // already paired
        currentQueue.splice(idx, 1);
        this.waiting.set(mode, currentQueue);
        const result = this.createBotMatch(userId, mode);
        resolve(result);
      }, this.botWaitMs);
    });
  }

  /**
   * Remove any pending matchmaking request for a userId. Used when the client
   * cancels or disconnects before a match is found.
   */
  cancel(userId: string): boolean {
    for (const [mode, queue] of this.waiting) {
      const idx = queue.findIndex((p) => p.userId === userId);
      if (idx === -1) continue;
      const [pending] = queue.splice(idx, 1);
      if (pending.botTimer) clearTimeout(pending.botTimer);
      pending.reject(new Error("matchmaking_cancelled"));
      this.waiting.set(mode, queue);
      return true;
    }
    return false;
  }

  /**
   * Issue a fresh room token for an existing room slot. Used by the resume
   * endpoint (T-v0.6-D10).
   */
  resume(
    userId: string,
    roomId: string
  ): MatchmakingResult | { error: "not_found" | "forbidden" | "closed" } {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return { error: "not_found" };
    if (room.status !== "active") return { error: "closed" };
    const slot = room.userIds[0] === userId ? 0 : room.userIds[1] === userId ? 1 : -1;
    if (slot === -1) return { error: "forbidden" };
    const opponentSlot = slot === 0 ? 1 : 0;
    const opponentUserId = room.userIds[opponentSlot];
    return this.signForSlot(
      room,
      slot as 0 | 1,
      "turn_based",
      opponentUserId ? { userId: opponentUserId } : null
    );
  }

  /** Current number of waiters for a mode (observability / tests). */
  waitingCount(mode: MatchmakingMode): number {
    return (this.waiting.get(mode) ?? []).length;
  }

  /** Dispose all pending timers — useful for test cleanup. */
  shutdown(): void {
    for (const queue of this.waiting.values()) {
      for (const pending of queue) {
        if (pending.botTimer) clearTimeout(pending.botTimer);
        pending.reject(new Error("shutdown"));
      }
    }
    this.waiting.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────────

  private createHumanMatch(
    userIdSlot0: string,
    userIdSlot1: string,
    mode: MatchmakingMode
  ): { partnerResult: MatchmakingResult; selfResult: MatchmakingResult } {
    const room = this.roomManager.createRoomForMatch(userIdSlot0, userIdSlot1);
    const partnerResult = this.signForSlot(room, 0, mode, { userId: userIdSlot1 });
    const selfResult = this.signForSlot(room, 1, mode, { userId: userIdSlot0 });
    return { partnerResult, selfResult };
  }

  private createBotMatch(userId: string, mode: MatchmakingMode): MatchmakingResult {
    const room = this.roomManager.createRoomForMatch(userId, BOT_USER_ID);
    if (this.botManager) this.botManager.setup(room.id);
    return this.signForSlot(room, 0, mode, { userId: BOT_USER_ID });
  }

  private createSoloMatch(userId: string): MatchmakingResult {
    const room = this.roomManager.createRoomForMatch(userId, "");
    return this.signForSlot(room, 0, "solo", null);
  }

  private signForSlot(
    room: Room,
    slot: 0 | 1,
    mode: MatchmakingMode,
    opponent: { userId: string } | null
  ): MatchmakingResult {
    const userId = room.userIds[slot];
    const now = Date.now();
    const roomToken = signRoomToken({
      roomId: room.id,
      userId,
      slot,
      seed: room.seed,
      ttlMs: this.roomTokenTtlMs,
      now,
    });
    return {
      roomToken,
      expiresAt: now + this.roomTokenTtlMs,
      roomId: room.id,
      slot,
      mode,
      opponent,
    };
  }
}
