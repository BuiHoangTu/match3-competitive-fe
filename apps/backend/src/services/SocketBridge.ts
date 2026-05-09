/**
 * SocketBridge — subscribes to MatchEngineService events and rebroadcasts
 * them as Socket.IO events to the correct rooms/sockets.
 *
 * Also exposes `handleMove` and `handleForfeit` so the socket handlers can
 * route turn_based events here instead of doing the work inline.
 *
 * Fan-out on match_ended (recordMatchEnd + roomCleanup + scheduleRoomClose +
 * rejoinManager.cleanupRoom) is centralised here for turn_based rooms so the
 * individual handlers no longer call recordMatchEnd directly.
 */

import type { Server, Socket } from "socket.io";
import type { ServerContext } from "../context";
import type { MatchEngineService, PlayerState } from "./MatchEngineService";
import { computeOutcome, recordMatchEnd, roomCleanup } from "../matchEnd";
import { logEvent } from "../logger";

export class SocketBridge {
  constructor(
    private io: Server,
    private ctx: ServerContext,
    private service: MatchEngineService
  ) {
    this._subscribeToServiceEvents();
  }

  // ── Socket-event entry points (called from handlers) ──────────────────────

  /**
   * Route a "move" socket event for a turn_based room through the judge.
   * Returns true if the event was handled (caller should not also run the
   * relay path).
   */
  handleMove(
    socket: Socket,
    data: { roomId: string; r1: number; c1: number; r2: number; c2: number }
  ): boolean {
    if (!this.service.hasRoom(data.roomId)) return false;
    const serverReceivedAt = Date.now();
    logEvent("move_submitted", {
      matchId: data.roomId,
      playerId: socket.id,
      r1: data.r1,
      c1: data.c1,
      r2: data.r2,
      c2: data.c2,
    });
    this.service.submitMove(
      data.roomId,
      socket.id,
      data.r1,
      data.c1,
      data.r2,
      data.c2,
      serverReceivedAt
    );
    return true;
  }

  /**
   * Route a "forfeit" socket event for a turn_based room through the judge.
   * Returns true if handled.
   */
  handleForfeit(socket: Socket): boolean {
    const room = this.ctx.roomManager.getRoomByPlayer(socket.id);
    if (!room || room.status === "over") return false;
    if (!this.service.hasRoom(room.id)) return false;

    // Mark the room over immediately so a racing disconnect doesn't double-fire.
    room.status = "over";

    logEvent("match_ended", {
      matchId: room.id,
      reason: "forfeit",
      playerId: socket.id,
    });

    this.service.forfeit(room.id, socket.id);
    return true;
  }

  /**
   * Called by connection.ts after match_found to start the judge for a
   * turn_based room.
   */
  startMatch(
    roomId: string,
    playerIds: [string, string],
    originalSeed: number,
    gameMode: string
  ): void {
    this.service.startMatch(roomId, playerIds, originalSeed, gameMode);
  }

  // ── Service-event subscribers ─────────────────────────────────────────────

  private _subscribeToServiceEvents(): void {
    // match_started — the service just initialised; nothing extra needed here
    // (match_found was already emitted by connection.ts).
    this.service.on("match_started", (_payload) => {
      // Intentionally empty: match_found is emitted by connection.ts before
      // startMatch is called. The event is available for future use.
    });

    this.service.on("move_resolved", (payload) => {
      // Keep the room's board state in sync so snapshot-rejoin (D02 path) and
      // existing handler code that reads from room.boardGrid still works.
      const room = this.ctx.roomManager.getRoom(payload.roomId);
      if (room) {
        room.boardGrid = payload.finalGrid;
        room.rngState = payload.rngState;
        room.scores = { ...payload.scores };
      }

      const move = {
        playerId: payload.playerId,
        r1: payload.r1,
        c1: payload.c1,
        r2: payload.r2,
        c2: payload.c2,
        timestamp: payload.serverReceivedAt,
      };

      // Hot path: clients animate cascades locally from the accepted move.
      // The judge still computes cascades privately for validation, scoring,
      // HP death, and snapshot rejoin, but cascade steps/finalGrid stay off
      // the socket during normal play.
      if (room) {
        for (const pid of room.players) {
          if (pid !== payload.playerId) this.io.to(pid).emit("opponent_move", move);
        }
      }

      // Also keep move list for debug/idle tracking.
      this.ctx.roomManager.addMove(payload.roomId, move);
    });

    this.service.on("move_rejected", (payload) => {
      const { roomId, playerId, reason } = payload;
      const socket = this.io.sockets.sockets.get(playerId);
      if (socket) {
        socket.emit("move_rejected", { reason });
      }
      logEvent("move_rejected", { matchId: roomId, playerId, reason });
    });

    this.service.on("turn_changed", (payload) => {
      const { roomId, activePlayer, playerStates, serverReceivedAt } = payload;
      // Keep Room.activePlayer in sync.
      const room = this.ctx.roomManager.getRoom(roomId);
      if (room) room.activePlayer = activePlayer;
      // Emit wire event with playerStates replacing old `times` field.
      this.io.to(roomId).emit("turn_changed", {
        activePlayerId: activePlayer,
        playerStates,
        serverReceivedAt,
      });
    });

    this.service.on("match_ended", (payload) => {
      const { roomId, loserId, loserReason, scores, durationMs, playerStates } = payload;

      const room = this.ctx.roomManager.getRoom(roomId);
      if (!room) return;

      // Prevent double-fire (forfeit handler already set room.status = "over").
      if (room.status === "over") {
        // Still need to clean up if not already done.
        // roomCleanup is idempotent.
      }
      room.status = "over";

      // game_over wire event — emit loserId + loserReason (new fields).
      // loserTimeUp retained as deprecated for backward compat with clients not
      // yet migrated.
      this.io.to(roomId).emit("game_over", {
        loserId: loserId ?? undefined,
        loserReason: loserReason ?? undefined,
        playerStates,
      });

      // Compute outcome for persistence.
      const p1 = room.players[0];
      const p2 = room.players[1];
      const p1Score = p1 ? (scores[p1] ?? 0) : 0;
      const p2Score = p2 ? (scores[p2] ?? 0) : 0;
      const outcome = computeOutcome(room, p1Score, p2Score, loserId ?? undefined);

      void recordMatchEnd(
        this.ctx,
        roomId,
        { ...room, scores },
        p1Score,
        p2Score,
        outcome
      );

      roomCleanup(this.ctx, roomId);
      // Remove the judge state (the service already deleted it internally,
      // but cleanup() is idempotent).
      this.service.cleanup(roomId);
      this.ctx.timerManager.scheduleRoomClose(roomId);
      this.ctx.rejoinManager.cleanupRoom(roomId);

      logEvent("match_ended", {
        matchId: roomId,
        reason: loserId ? "time_up_or_forfeit" : "score",
        durationMs,
      });
    });
  }

  /**
   * Return the current playerStates for a room (for snapshot rejoin).
   * Returns null if the room is not managed by the judge.
   */
  getPlayerStates(roomId: string): { [playerId: string]: PlayerState } | null {
    const snapshot = this.service.getSnapshot(roomId);
    return snapshot ? snapshot.playerStates : null;
  }
}
