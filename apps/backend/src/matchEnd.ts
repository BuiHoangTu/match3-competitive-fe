/**
 * Match-end helpers: computeOutcome, recordMatchEnd, roomCleanup.
 * Extracted from server.ts so TimerManager callbacks and the disconnect
 * handler can import them without pulling in the full server module.
 */

import type { ServerContext } from "./context";
import type { MatchOutcome } from "./persistence/MatchHistoryStore";
import * as metrics from "./metrics";

/**
 * Determine match outcome from final scores and the loserTimeUp field.
 * loserTimeUp is the socketId of the player whose clock ran out.
 */
export function computeOutcome(
  room: { players: string[]; userIds: [string, string] },
  p1Score: number,
  p2Score: number,
  loserTimeUp?: string
): MatchOutcome {
  if (loserTimeUp) {
    const loserSlot = room.players.indexOf(loserTimeUp);
    if (loserSlot === 0) return "P2_WIN";
    if (loserSlot === 1) return "P1_WIN";
  }
  if (p1Score > p2Score) return "P1_WIN";
  if (p2Score > p1Score) return "P2_WIN";
  return "DRAW";
}

/**
 * Insert a match_history row for the given room.
 *
 * For turn_based rooms, p1Score / p2Score are authoritative (tracked on the
 * Room). Callers may pass 0/0 for pve/solo rooms where server score tracking
 * is not implemented.
 */
export async function recordMatchEnd(
  ctx: Pick<ServerContext, "persistence" | "matchStartTimes">,
  roomId: string,
  room: { players: string[]; userIds: [string, string]; scores?: { [playerId: string]: number } },
  p1Score: number,
  p2Score: number,
  outcome: MatchOutcome
): Promise<void> {
  // If the room carries authoritative scores, use them for the history row.
  if (room.scores && room.players.length >= 1) {
    const p1Socket = room.players[0];
    const p2Socket = room.players[1];
    p1Score = room.scores[p1Socket ?? ""] ?? p1Score;
    p2Score = room.scores[p2Socket ?? ""] ?? p2Score;
  }
  const startedAt = ctx.matchStartTimes.get(roomId) ?? Date.now();
  ctx.matchStartTimes.delete(roomId);
  const durationMs = Date.now() - startedAt;
  const endedAt = new Date();
  try {
    await ctx.persistence.matchHistoryStore.insert({
      matchId: roomId,
      p1UserId: room.userIds[0] || null,
      p2UserId: room.userIds[1] || null,
      p1Score,
      p2Score,
      outcome,
      durationMs,
      endedAt,
    });
  } catch (err) {
    console.error("[match_history] insert failed:", (err as Error).message);
  }
  // T-v1.0-09: count every match end.
  metrics.increment("match_count");
}

/** Tear down bot and rejoin state for a finished room. */
export function roomCleanup(
  ctx: Pick<ServerContext, "botManager" | "rejoinManager">,
  roomId: string
): void {
  ctx.botManager.cleanup(roomId);
  ctx.rejoinManager.cleanupRoom(roomId);
}
