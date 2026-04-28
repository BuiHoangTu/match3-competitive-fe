/**
 * socket.on("move", ...) handler.
 * Validates the move, relays it to the opponent, and switches the active player.
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { checkTokenExpiry } from "../AuthMiddleware";
import { isValidMove, checkUserIdOwnsSlot } from "../validator";
import { BOT_ID } from "../constants";
import { logEvent } from "../logger";

export function registerMoveHandler(socket: Socket, ctx: ServerContext): void {
  socket.on(
    "move",
    async (data: { roomId: string; r1: number; c1: number; r2: number; c2: number }) => {
      // T-v0.6-D06: re-check token expiry on every move event.
      if (!(await checkTokenExpiry(socket))) return;

      const move = {
        playerId: socket.id,
        r1: data.r1,
        c1: data.c1,
        r2: data.r2,
        c2: data.c2,
        timestamp: Date.now(),
      };

      if (!isValidMove(move)) {
        socket.emit("move_rejected", { reason: "invalid move", move });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "invalid move" });
        return;
      }

      const room = ctx.roomManager.getRoom(data.roomId);
      if (!room) {
        socket.emit("move_rejected", { reason: "room not found", move });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "room not found" });
        return;
      }

      if (!room.players.includes(socket.id)) {
        socket.emit("move_rejected", { reason: "not in room", move });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not in room" });
        return;
      }

      // T-v0.6-D04 · userId slot check: the socket's verified userId must own a slot in the room.
      const socketUserId = socket.data.userId as string | undefined;
      if (socketUserId) {
        const slotCheck = checkUserIdOwnsSlot(socketUserId, room);
        if (!slotCheck.ok) {
          socket.emit("move_rejected", { reason: slotCheck.reason, move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: slotCheck.reason });
          return;
        }
      }

      if (room.activePlayer && room.activePlayer !== socket.id) {
        socket.emit("move_rejected", { reason: "not your turn", move });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not your turn" });
        return;
      }

      if (!ctx.roomManager.addMove(data.roomId, move)) {
        socket.emit("move_rejected", { reason: "room not found", move });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "room not found" });
        return;
      }

      logEvent("move_submitted", {
        matchId: data.roomId,
        playerId: socket.id,
        r1: data.r1,
        c1: data.c1,
        r2: data.r2,
        c2: data.c2,
      });

      socket.to(data.roomId).emit("opponent_move", move);

      if (ctx.botManager.isBotRoom(data.roomId)) {
        ctx.botManager.applyMove(data.roomId, data.r1, data.c1, data.r2, data.c2);
      }

      const nextPlayer = room.players.find((p) => p !== socket.id);
      if (nextPlayer) {
        room.activePlayer = nextPlayer;
        const times = ctx.timerManager.getTimes(data.roomId);
        ctx.io.to(data.roomId).emit("turn_changed", {
          activePlayerId: nextPlayer,
          times: times ?? {},
        });

        if (nextPlayer === BOT_ID) {
          ctx.botManager.scheduleBotTurn(data.roomId, socket.id);
        }
      }
    }
  );
}
