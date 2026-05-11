/**
 * socket.on("rejoin", ...) handler.
 * T-v0.6-G02/G03 · userId-keyed rejoin via verified socket identity.
 *
 * turn_based rooms: emits a one-shot board snapshot (boardGrid + rngState +
 * scores + originalSeed) instead of the legacy moves[] list.
 *
 * pve rooms: retains the legacy seed + moves[] shape (unchanged).
 */

import type { Socket } from "socket.io";
import type { ServerContext } from "../context";
import { defaultPlayerState, type PlayerState } from "../services/MatchEngineService";
import { logEvent } from "../logger";

function flattenGrid(grid: number[][] | undefined): number[] | undefined {
  return grid ? grid.flatMap((row) => row) : undefined;
}

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

    const opponentId = updatedRoom.players.find((p) => p !== socket.id) ?? null;

    logEvent("rejoin", {
      matchId: roomId,
      playerId: socket.id,
      userId,
      ok: true,
    });

    if (updatedRoom.gameMode === "turn_based") {
      // ── Snapshot rejoin for turn_based ───────────────────────────────────
      // Pull playerStates from the judge; fall back to default if not yet started.
      const rawPlayerStates = ctx.socketBridge.getPlayerStates(roomId);
      // Remap any stale socket-ID key to the current socket.id.
      const playerStates: Record<string, PlayerState> = {};
      if (rawPlayerStates) {
        for (const [pid, ps] of Object.entries(rawPlayerStates)) {
          const newPid = oldPlayerId && pid === oldPlayerId ? socket.id : pid;
          playerStates[newPid] = ps;
        }
      }
      // Ensure rejoining socket has an entry.
      if (!(socket.id in playerStates)) {
        playerStates[socket.id] = defaultPlayerState();
      }

      socket.emit("rejoin_ok", {
        roomId,
        seed: updatedRoom.seed,
        mode: updatedRoom.gameMode,
        myPlayerId: socket.id,
        activePlayerId: updatedRoom.activePlayer,
        playerStates,
        opponentId,
        rejoinToken: "", // rejoin tokens replaced by room tokens; use /matchmaking/resume
        // Snapshot fields:
        width: updatedRoom.boardGrid?.[0]?.length ?? 0,
        height: updatedRoom.boardGrid?.length ?? 0,
        boardVersion: updatedRoom.boardVersion ?? 1,
        board: flattenGrid(updatedRoom.boardGrid),
        boardGrid: updatedRoom.boardGrid,
        rngState: updatedRoom.rngState,
        originalSeed: updatedRoom.originalSeed,
      });
    } else {
      // ── Legacy move-replay rejoin for pve ────────────────────────────────
      const remappedMoves = updatedRoom.moves.map((m) =>
        oldPlayerId && m.playerId === oldPlayerId ? { ...m, playerId: socket.id } : m
      );
      // For pve rooms, build playerStates from TimerManager times.
      const times = ctx.timerManager.getTimes(roomId);
      const pvePlayerStates: Record<string, PlayerState> = {};
      if (times) {
        for (const [pid, stamina] of Object.entries(times)) {
          pvePlayerStates[pid] = { ...defaultPlayerState(), stamina };
        }
      }
      if (!(socket.id in pvePlayerStates)) {
        pvePlayerStates[socket.id] = defaultPlayerState();
      }

      socket.emit("rejoin_ok", {
        roomId,
        seed: updatedRoom.seed,
        moves: remappedMoves,
        myPlayerId: socket.id,
        activePlayerId: updatedRoom.activePlayer,
        playerStates: pvePlayerStates,
        opponentId,
        rejoinToken: "", // rejoin tokens replaced by room tokens; use /matchmaking/resume
      });
    }

    socket.to(roomId).emit("opponent_reconnected");
  });
}
