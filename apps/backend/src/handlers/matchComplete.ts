/**
 * socket.on("match_complete", ...) handler.
 *
 * Used by pve where the server doesn't track HP itself: when the client's
 * local engine detects HP-zero, it sends `match_complete` with the outcome.
 * The server marks the room over, emits `game_over` back so the client
 * leaves the match through the same server-driven path PvP uses, then
 * cleans up so /matchmaking/status no longer reports the room active.
 *
 * Payload is advisory — cleanup is unconditional. The forwarded loserId /
 * loserReason are echoed back in `game_over` so the client's onGameOver
 * handler shows the right outcome.
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { logEvent } from "../logger";
import { computeOutcome, recordMatchEnd, roomCleanup } from "../matchEnd";

interface MatchCompletePayload {
  loserId?: string;
  loserReason?: "hp" | "time";
  scores?: { [playerId: string]: number };
}

export function registerMatchCompleteHandler(
  socket: Socket,
  ctx: ServerContext,
): void {
  socket.on("match_complete", (data?: MatchCompletePayload) => {
    const room = ctx.roomManager.getRoomByPlayer(socket.id);
    if (!room || room.status === "over") return;

    ctx.timerManager.stopTimer(room.id);
    room.status = "over";

    // Propagate game_over so the client leaves the match through the
    // server-driven onGameOver path (mirrors turn_based behaviour).
    ctx.io.to(room.id).emit("game_over", {
      loserId: data?.loserId,
      loserReason: data?.loserReason,
      scores: data?.scores,
    });

    // Record match history — use client-supplied scores as the authoritative
    // source for pve rooms (server doesn't track HP independently).
    const p1Score = data?.scores?.[room.players[0] ?? ""] ?? 0;
    const p2Score = data?.scores?.[room.players[1] ?? ""] ?? 0;
    const outcome = computeOutcome(room, p1Score, p2Score, data?.loserId);
    void recordMatchEnd(
      ctx,
      room.id,
      { ...room, scores: data?.scores ?? {} },
      p1Score,
      p2Score,
      outcome,
    );

    roomCleanup(ctx, room.id);
    ctx.roomManager.closeRoom(room.id);

    logEvent("match_ended", {
      matchId: room.id,
      reason: "client_complete",
      playerId: socket.id,
      loserId: data?.loserId,
      loserReason: data?.loserReason,
    });
  });
}
