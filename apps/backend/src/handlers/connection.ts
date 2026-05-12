/**
 * io.on("connection", ...) orchestrator.
 *
 * Handles the room-token connection setup: attaches the socket to its
 * pre-existing room slot, emits match_found when both players are present,
 * starts timers, wires per-socket move/rejoin/disconnect handlers.
 */

import type { Server, Socket } from "socket.io";
import type { ServerContext } from "../context";
import { BOT_ID, BOT_USER_ID } from "../constants";
import { logEvent } from "../logger";
import { computeOutcome, recordMatchEnd, roomCleanup } from "../matchEnd";
import { registerMoveHandler } from "./move";
import { registerRejoinHandler } from "./rejoin";
import { registerDisconnectHandler } from "./disconnect";
import { registerForfeitHandler } from "./forfeit";
import { registerMatchCompleteHandler } from "./matchComplete";

function flattenGrid(grid: number[][] | undefined): number[] | undefined {
  return grid ? grid.flatMap((row) => row) : undefined;
}

function connectedSlotPlayers(players: string[]): players is [string, string] {
  return Boolean(players[0] && players[1]);
}

export function registerConnectionHandler(io: Server, ctx: ServerContext): void {
  io.on("connection", (socket: Socket) => {
    console.log(`[connect] ${socket.id}`);

    // T-v0.6-D02 — room-token handshake: place the socket directly into its
    // pre-existing room (created by /matchmaking/join) and emit match_found.
    const tokenRoomId = socket.data.roomId as string | undefined;
    const tokenUserId = socket.data.userId as string | undefined;
    const tokenSlot = socket.data.slot as 0 | 1 | undefined;
    if (tokenRoomId && tokenUserId !== undefined && tokenSlot !== undefined) {
      // Reconnect case: if this userId already has an old socket in the room
      // (still present because the grace-period hasn't expired), replace it
      // with the new socket ID before calling attachSocketToSlot.
      const existingRoom = ctx.roomManager.getRoom(tokenRoomId);
      if (existingRoom && tokenSlot !== undefined) {
        const oldSocketId = existingRoom.players[tokenSlot];
        if (oldSocketId && oldSocketId !== socket.id) {
          ctx.socketBridge.replacePlayerId(tokenRoomId, oldSocketId, socket.id);
          ctx.roomManager.replacePlayer(oldSocketId, socket.id);
        }
      }

      const room = ctx.roomManager.attachSocketToSlot(tokenRoomId, tokenSlot, socket.id);
      if (room) {
        socket.join(tokenRoomId);
        logEvent("player_joined", { matchId: tokenRoomId, playerId: socket.id });

        const opponentSlot = tokenSlot === 0 ? 1 : 0;
        const opponentUserId = room.userIds[opponentSlot];
        const isBotOpponent = opponentUserId === BOT_USER_ID;
        if (isBotOpponent && !room.players.includes(BOT_ID)) {
          room.players.push(BOT_ID);
        }

        // Both slots bound (both humans connected, OR bot opponent is
        // always "present"): start the match.
        const bothSocketsConnected = connectedSlotPlayers(room.players);
        if (bothSocketsConnected || isBotOpponent) {
          if (!room.activePlayer) {
            // Pick starter deterministically: slot 0 goes first.
            room.activePlayer = room.players[0] || room.players.find(Boolean) || null;
          }
          // Record match start time for duration calculation.
          if (!ctx.matchStartTimes.has(room.id)) {
            ctx.matchStartTimes.set(room.id, Date.now());
          }
          if (isBotOpponent && room.gameMode === "turn_based") {
            const humanPlayerId = room.players.find((p) => p !== BOT_ID) ?? socket.id;
            ctx.socketBridge.startMatch(
              room.id,
              [humanPlayerId, BOT_ID],
              room.originalSeed ?? room.seed,
              room.gameMode
            );
          } else if (isBotOpponent) {
            // pve bot rooms use TimerManager (unchanged path).
            ctx.botManager.setup(room.id);
            ctx.timerManager.startRoomTimer(
              room.id,
              socket.id,
              BOT_ID,
              (id, loserId) => {
                const r = ctx.roomManager.getRoom(id);
                const outcome = computeOutcome(r ?? { players: room.players, userIds: room.userIds }, 0, 0, loserId);
                void recordMatchEnd(ctx, id, r ?? { players: room.players, userIds: room.userIds }, 0, 0, outcome);
                roomCleanup(ctx, id);
                ctx.timerManager.scheduleRoomClose(id);
              }
            );
          } else if (connectedSlotPlayers(room.players) && room.gameMode === "turn_based") {
            // turn_based human-vs-human: judge takes over from here.
            const [p0, p1] = room.players as [string, string];
            ctx.socketBridge.startMatch(
              room.id,
              [p0, p1],
              room.originalSeed ?? room.seed,
              room.gameMode
            );
          } else if (connectedSlotPlayers(room.players)) {
            // pve fallback (non-bot, non-turn_based): keep TimerManager path.
            const [p0, p1] = room.players as [string, string];
            ctx.timerManager.startRoomTimer(room.id, p0, p1, (id, loserId) => {
              const r = ctx.roomManager.getRoom(id);
              const outcome = computeOutcome(r ?? { players: [p0, p1], userIds: room.userIds }, 0, 0, loserId);
              void recordMatchEnd(ctx, id, r ?? { players: [p0, p1], userIds: room.userIds }, 0, 0, outcome);
              ctx.rejoinManager.cleanupRoom(id);
              ctx.timerManager.scheduleRoomClose(id);
            });
          }

          const initialPlayerStates = ctx.socketBridge.getPlayerStates(room.id);
          for (const pid of room.players) {
            if (!pid) continue;
            if (pid === BOT_ID) continue;
            const opponentSocketId = room.players.find((p) => p && p !== pid) ?? BOT_ID;
            const isTurnBased = room.gameMode === "turn_based";
            io.to(pid).emit("match_found", {
              roomId: room.id,
              opponentId: isBotOpponent ? BOT_ID : opponentSocketId,
              myPlayerId: pid,
              firstPlayerId: room.activePlayer,
              activePlayerId: room.activePlayer,
              mode: room.gameMode,
              // turn_based only: initial authoritative flat board snapshot
              ...(isTurnBased && {
                boardVersion: room.boardVersion ?? 1,
                board: flattenGrid(room.boardGrid),
              }),
              // pve only: ship the move log so the client can replay on
              // reconnect. Empty on first connect; populated on resume after
              // the user has already played some moves.
              ...(!isTurnBased && { seed: room.seed, moves: room.moves }),
              // Initial stats so the HUD can render full bars immediately.
              ...(initialPlayerStates && { playerStates: initialPlayerStates }),
            });
          }

          if (isBotOpponent && room.activePlayer === BOT_ID) {
            ctx.botManager.scheduleBotTurn(room.id, socket.id);
          }
        }
      }
    }

    registerRejoinHandler(socket, ctx);
    registerMoveHandler(socket, ctx);
    registerForfeitHandler(socket, ctx);
    registerMatchCompleteHandler(socket, ctx);
    registerDisconnectHandler(socket, ctx);
  });
}
