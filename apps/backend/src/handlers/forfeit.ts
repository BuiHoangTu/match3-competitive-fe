/**
 * socket.on("forfeit", ...) handler.
 *
 * The shell's "Leave match" button sends a RequestLeaveMatch message to the
 * embedded game; the game forwards it as `forfeit` over Socket.IO. The
 * forfeiter is treated as the loser — same shape as a clock-expiry
 * outcome — so the existing GameScene `onGameOver` path on the opponent's
 * side computes the win + remaining-time bonus correctly.
 *
 * No-op for sockets without an active room (e.g. solo mode never created a
 * server-side room for this socket).
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { logEvent } from "../logger";
import { computeOutcome, recordMatchEnd, roomCleanup } from "../matchEnd";

export function registerForfeitHandler(socket: Socket, ctx: ServerContext): void {
  socket.on("forfeit", () => {
    const room = ctx.roomManager.getRoomByPlayer(socket.id);
    if (!room || room.status === "over") return;

    ctx.timerManager.stopTimer(room.id);
    const times = ctx.timerManager.getTimes(room.id) ?? {};
    room.status = "over";

    // Treat forfeiter as the timed-out player so the opponent's existing
    // game_over handler awards them the win + their remaining-time bonus.
    ctx.io.to(room.id).emit("game_over", {
      loserTimeUp: socket.id,
      times,
    });

    const outcome = computeOutcome(room, 0, 0, socket.id);
    void recordMatchEnd(ctx, room.id, room, 0, 0, outcome);
    ctx.rejoinManager.cleanupRoom(room.id);
    roomCleanup(ctx, room.id);
    ctx.timerManager.scheduleRoomClose(room.id);

    logEvent("match_ended", {
      matchId: room.id,
      reason: "forfeit",
      playerId: socket.id,
    });
  });
}
