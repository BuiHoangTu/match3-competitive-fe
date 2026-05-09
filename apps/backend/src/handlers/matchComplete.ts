/**
 * socket.on("match_complete", ...) handler.
 *
 * The client signals server-side cleanup when its local engine determined the
 * match is over. Used by pve mode where the server doesn't track HP — without
 * this, /matchmaking/status keeps reporting the room active until the
 * disconnect grace timer fires, and "Play Again" auto-resumes a dead room.
 *
 * Fields are advisory; cleanup is unconditional. Does NOT assign blame
 * (unlike forfeit) — the client already showed the correct result locally.
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { logEvent } from "../logger";
import { roomCleanup } from "../matchEnd";

export function registerMatchCompleteHandler(
  socket: Socket,
  ctx: ServerContext,
): void {
  socket.on("match_complete", () => {
    const room = ctx.roomManager.getRoomByPlayer(socket.id);
    if (!room || room.status === "over") return;

    ctx.timerManager.stopTimer(room.id);
    room.status = "over";
    roomCleanup(ctx, room.id);
    ctx.roomManager.closeRoom(room.id);

    logEvent("match_ended", {
      matchId: room.id,
      reason: "client_complete",
      playerId: socket.id,
    });
  });
}
