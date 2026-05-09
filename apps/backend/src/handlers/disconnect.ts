/**
 * socket.on("disconnect", ...) handler.
 *
 * Both bot rooms and PvP rooms: leave the room intact and the disconnected
 * player's slot in place. The active player's stamina keeps ticking; if they
 * don't reconnect via /matchmaking/resume before stamina runs out, they lose
 * normally via match_ended. No artificial grace window, no DRAW outcome —
 * stamina expiry is the natural end-of-match path.
 *
 * For PvP non-bot rooms we also notify the OTHER player so they can show a
 * "your opponent disconnected, hold tight" banner. The effective rejoin
 * window is the disconnected player's remaining stamina, sent as
 * `timeoutMs`.
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { logEvent } from "../logger";

export function registerDisconnectHandler(socket: Socket, ctx: ServerContext): void {
  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    logEvent("disconnect", { playerId: socket.id });

    const activeRoom = ctx.roomManager.getRoomByPlayer(socket.id);
    if (!activeRoom) {
      ctx.roomManager.removePlayer(socket.id);
      return;
    }

    // Notify the opponent (PvP non-bot rooms only) so their HUD can show a
    // reconnecting banner. The disconnected player's remaining stamina is
    // their effective rejoin window.
    if (!ctx.botManager.isBotRoom(activeRoom.id)) {
      const playerStates = ctx.socketBridge.getPlayerStates(activeRoom.id);
      const remainingMs = playerStates?.[socket.id]?.stamina ?? 0;
      socket.to(activeRoom.id).emit("opponent_reconnecting", {
        timeoutMs: remainingMs,
      });
    }
    // Otherwise: do nothing. Stamina is the de-facto rejoin window.
  });
}
