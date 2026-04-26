import type { Server } from "socket.io";
import type { RoomManager } from "./RoomManager";
import type { TimerManager } from "./TimerManager";
import { logEvent } from "./logger";

interface MinimalEmitter {
  to(room: string): { emit(event: string, payload?: unknown): unknown };
}

/**
 * Closes matches that have sat idle (no moves) for longer than `cutoffMs`.
 * Per FR-7(b) an idle match ends as a DRAW (no loser).
 */
export class IdleSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private io: Server | MinimalEmitter,
    private roomManager: RoomManager,
    private timerManager: Pick<TimerManager, "stopTimer" | "scheduleRoomClose">,
    private onClose?: (roomId: string) => void
  ) {}

  sweep(cutoffMs: number, now: number = Date.now()): string[] {
    const idle = this.roomManager.findIdleRooms(cutoffMs, now);
    const closed: string[] = [];
    for (const room of idle) {
      room.status = "over";
      this.timerManager.stopTimer(room.id);
      this.io.to(room.id).emit("game_over", {});
      logEvent("match_ended", { matchId: room.id, reason: "idle_timeout" });
      this.timerManager.scheduleRoomClose(room.id, this.onClose);
      closed.push(room.id);
    }
    return closed;
  }

  start(cutoffMs: number, intervalMs: number): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.sweep(cutoffMs), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
