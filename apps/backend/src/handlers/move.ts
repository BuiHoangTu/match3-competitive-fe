/**
 * socket.on("move", ...) handler.
 *
 * turn_based rooms: routed through SocketBridge → MatchEngineService (the
 * judge). All validation, board resolution, score tracking, and event emission
 * happen inside the service. This handler is a thin authentication + routing
 * layer only.
 *
 * pve rooms: relay-only path (unchanged from v0.5) — validates adjacency/bounds
 * then forwards opponent_move to the room and advances the bot turn.
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

      // ── Tier 1: adjacency + bounds (both paths) ───────────────────────────
      if (!isValidMove(move)) {
        const reason = (() => {
          const { r1, c1, r2, c2 } = data;
          const inBounds = (v: number) => Number.isInteger(v) && v >= 0 && v <= 7;
          if (!inBounds(r1) || !inBounds(c1) || !inBounds(r2) || !inBounds(c2))
            return "out_of_bounds";
          return "non_adjacent";
        })();
        socket.emit("move_rejected", { reason });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason });
        return;
      }

      const room = ctx.roomManager.getRoom(data.roomId);
      if (!room) {
        socket.emit("move_rejected", { reason: "room not found" });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "room not found" });
        return;
      }

      if (!room.players.includes(socket.id)) {
        socket.emit("move_rejected", { reason: "not in room" });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not in room" });
        return;
      }

      // T-v0.6-D04 · userId slot check
      const socketUserId = socket.data.userId as string | undefined;
      if (socketUserId) {
        const slotCheck = checkUserIdOwnsSlot(socketUserId, room);
        if (!slotCheck.ok) {
          socket.emit("move_rejected", { reason: slotCheck.reason });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: slotCheck.reason });
          return;
        }
      }

      // ── Branch: turn_based → judge (SocketBridge / MatchEngineService) ────
      if (room.gameMode === "turn_based") {
        // The bridge handles turn-order check, engine validation, resolution,
        // scoring, and event emission.
        ctx.socketBridge.handleMove(socket, data);
        return;
      }

      // ── PvE relay-only path (unchanged) ──────────────────────────────────
      if (room.activePlayer && room.activePlayer !== socket.id) {
        socket.emit("move_rejected", { reason: "not_your_turn" });
        logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not_your_turn" });
        return;
      }

      if (!ctx.roomManager.addMove(data.roomId, move)) {
        socket.emit("move_rejected", { reason: "room not found" });
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
