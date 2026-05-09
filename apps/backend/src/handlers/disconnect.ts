/**
 * socket.on("disconnect", ...) handler.
 *
 * Both bot rooms and PvP rooms: leave the room intact and the disconnected
 * player's slot in place. The active player's stamina keeps ticking; if they
 * don't reconnect via /matchmaking/resume before stamina runs out, they lose
 * normally via match_ended. No artificial grace window, no DRAW outcome —
 * stamina expiry is the natural end-of-match path.
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
    }
    // Active room: do nothing. Stamina is the de-facto rejoin window.
  });
}
