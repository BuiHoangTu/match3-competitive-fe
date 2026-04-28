/**
 * socket.on("disconnect", ...) handler.
 * Handles graceful disconnect with rejoin window for PvP rooms,
 * and immediate teardown for bot rooms.
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { REJOIN_WINDOW_MS } from "../constants";
import { logEvent } from "../logger";
import { recordMatchEnd, roomCleanup } from "../matchEnd";

export function registerDisconnectHandler(socket: Socket, ctx: ServerContext): void {
  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    logEvent("disconnect", { playerId: socket.id });

    const activeRoom = ctx.roomManager.getRoomByPlayer(socket.id);
    if (activeRoom) {
      if (ctx.botManager.isBotRoom(activeRoom.id)) {
        ctx.timerManager.stopTimer(activeRoom.id);
        roomCleanup(ctx, activeRoom.id);
        ctx.timerManager.scheduleRoomClose(activeRoom.id);
        ctx.roomManager.removePlayer(socket.id);
        logEvent("match_ended", { matchId: activeRoom.id, reason: "human_left_bot_room" });
      } else {
        socket.to(activeRoom.id).emit("opponent_reconnecting", {
          timeoutMs: REJOIN_WINDOW_MS,
        });

        const gracePending = setTimeout(() => {
          ctx.disconnectedPlayers.delete(socket.id);
          const room = ctx.roomManager.getRoom(activeRoom.id);
          if (room && room.players.includes(socket.id)) {
            ctx.timerManager.stopTimer(activeRoom.id);
            room.status = "over";
            ctx.io.to(activeRoom.id).emit("game_over", {});
            void recordMatchEnd(ctx, activeRoom.id, room, 0, 0, "DRAW");
            ctx.timerManager.scheduleRoomClose(activeRoom.id, (id) =>
              ctx.rejoinManager.cleanupRoom(id)
            );
            ctx.roomManager.removePlayer(socket.id);
            logEvent("match_ended", { matchId: activeRoom.id, reason: "rejoin_window_expired" });
          }
        }, REJOIN_WINDOW_MS);

        ctx.disconnectedPlayers.set(socket.id, gracePending);
      }
    } else {
      ctx.roomManager.removePlayer(socket.id);
    }
  });
}
