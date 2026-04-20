import type { Server } from "socket.io";
import type { RoomManager } from "./RoomManager";
import { BOT_ID, PLAYER_TIME_MS } from "./constants";

interface TimerState {
  intervalId: ReturnType<typeof setInterval>;
  times: Record<string, number>;
}

export class TimerManager {
  private timers = new Map<string, TimerState>();

  constructor(private io: Server, private roomManager: RoomManager) {}

  startRoomTimer(
    roomId: string,
    player1Id: string,
    player2Id: string,
    onTimeUp?: (roomId: string) => void
  ): void {
    const times: Record<string, number> = {
      [player1Id]: PLAYER_TIME_MS,
      [player2Id]: PLAYER_TIME_MS,
    };

    const intervalId = setInterval(() => {
      const room = this.roomManager.getRoom(roomId);
      const timerState = this.timers.get(roomId);
      if (!room || !timerState || !room.activePlayer) return;

      if (room.activePlayer === BOT_ID) return;

      timerState.times[room.activePlayer] -= 1000;

      if ((timerState.times[room.activePlayer] ?? 0) <= 0) {
        const loserId = room.activePlayer;
        this.stopTimer(roomId);
        room.status = "over";
        this.io.to(roomId).emit("game_over", {
          loserTimeUp: loserId,
          times: { ...timerState.times },
        });
        onTimeUp?.(roomId);
      }
    }, 1000);

    this.timers.set(roomId, { intervalId, times });
  }

  stopTimer(roomId: string): void {
    const t = this.timers.get(roomId);
    if (t) {
      clearInterval(t.intervalId);
      this.timers.delete(roomId);
    }
  }

  getTimes(roomId: string): Record<string, number> | null {
    return this.timers.get(roomId)?.times ?? null;
  }

  scheduleRoomClose(roomId: string, extraCleanup?: (roomId: string) => void): void {
    setTimeout(() => {
      extraCleanup?.(roomId);
      this.roomManager.closeRoom(roomId);
      this.stopTimer(roomId);
    }, 30_000);
  }
}
