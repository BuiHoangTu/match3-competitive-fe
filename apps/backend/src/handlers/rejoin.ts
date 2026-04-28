/**
 * socket.on("rejoin", ...) handler.
 * T-v0.6-G02/G03 · userId-keyed rejoin via verified socket identity.
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { logEvent } from "../logger";

export function registerRejoinHandler(socket: Socket, ctx: ServerContext): void {
  // The socket's userId is set by the D02 room-token handshake middleware.
  // Sockets without a verified identity receive rejoin_failed; clients
  // should reconnect via POST /matchmaking/resume → room token instead.
  socket.on("rejoin", (_data: unknown) => {
    const userId = socket.data.userId as string | undefined;
    if (!userId) {
      socket.emit("rejoin_failed", { reason: "no verified identity — use /matchmaking/resume" });
      return;
    }

    const entry = ctx.rejoinManager.lookup(userId);
    if (!entry) {
      socket.emit("rejoin_failed", { reason: "no active rejoin window for this identity" });
      return;
    }

    const { roomId } = entry;
    const room = ctx.roomManager.getRoom(roomId);
    if (!room || room.status === "over") {
      socket.emit("rejoin_failed", { reason: "game already ended" });
      ctx.rejoinManager.delete(userId);
      logEvent("rejoin", {
        matchId: roomId,
        playerId: socket.id,
        userId,
        ok: false,
        reason: "game already ended",
      });
      return;
    }

    // Find the old socket ID for this userId in the room.
    const slotIndex = room.userIds.indexOf(userId);
    // Find any player socket that previously occupied this userId's slot;
    // for userId-keyed rooms the old socket may already be gone.
    const oldPlayerId = room.players.find((_, i) => i === slotIndex) ?? null;

    if (oldPlayerId) {
      const gracePending = ctx.disconnectedPlayers.get(oldPlayerId);
      if (gracePending) {
        clearTimeout(gracePending);
        ctx.disconnectedPlayers.delete(oldPlayerId);
      }
    }

    // Attach the new socket to the slot (replaces old socket ID in room).
    let updatedRoom = room;
    if (oldPlayerId) {
      const replaced = ctx.roomManager.replacePlayer(oldPlayerId, socket.id);
      if (replaced) updatedRoom = replaced;
    } else {
      ctx.roomManager.attachSocketToSlot(roomId, slotIndex as 0 | 1, socket.id);
    }

    socket.join(roomId);
    ctx.rejoinManager.delete(userId);

    const times = ctx.timerManager.getTimes(roomId);
    const opponentId = updatedRoom.players.find((p) => p !== socket.id) ?? null;

    const remappedMoves = updatedRoom.moves.map((m) =>
      oldPlayerId && m.playerId === oldPlayerId ? { ...m, playerId: socket.id } : m
    );

    logEvent("rejoin", {
      matchId: roomId,
      playerId: socket.id,
      userId,
      ok: true,
    });

    socket.emit("rejoin_ok", {
      roomId,
      seed: updatedRoom.seed,
      moves: remappedMoves,
      myPlayerId: socket.id,
      activePlayerId: updatedRoom.activePlayer,
      times: times ?? {},
      opponentId,
      rejoinToken: "", // rejoin tokens replaced by room tokens; use /matchmaking/resume
    });

    socket.to(roomId).emit("opponent_reconnected");
  });
}
