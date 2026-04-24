import { createServer as createHttpServer, Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import { WaitingQueue } from "./WaitingQueue";
import { RejoinManager } from "./RejoinManager";
import { TimerManager } from "./TimerManager";
import { BotManager } from "./BotManager";
import { IdleSweeper } from "./IdleSweeper";
import { MatchmakingService } from "./MatchmakingService";
import { createMatchmakingHttpHandler } from "./matchmakingHttp";
import { verify as verifyRoomToken } from "./RoomTokenSigner";
import { isValidMove } from "./validator";
import {
  BOT_ID,
  BOT_USER_ID,
  BOT_WAIT_MS,
  REJOIN_WINDOW_MS,
  IDLE_MATCH_TIMEOUT_MS,
  IDLE_SWEEP_INTERVAL_MS,
} from "./constants";
import { logEvent } from "./logger";

export interface ServerHandle {
  io: Server;
  httpServer: HttpServer;
  roomManager: RoomManager;
  rejoinManager: RejoinManager;
  timerManager: TimerManager;
  botManager: BotManager;
  idleSweeper: IdleSweeper;
  matchmaking: MatchmakingService;
  port: number;
  close(): Promise<void>;
}

/**
 * Build (but do not start) a fully wired Match-3 server. Handlers are bound
 * during construction; listening happens when the caller awaits `close()`-able
 * listen via the returned `httpServer.listen(...)`. For the default CLI
 * bootstrap, use {@link startServer} which listens on a port and returns the
 * handle.
 */
export function createMatch3Server(): ServerHandle {
  const httpServer = createHttpServer();
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  if (process.env.REDIS_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Promise.all([
      Promise.resolve().then(() => require("@socket.io/redis-adapter") as { createAdapter: (...args: unknown[]) => unknown }),
      Promise.resolve().then(() => require("ioredis") as { default: new (url: string) => { duplicate: () => unknown } }),
    ])
      .then(([redisAdapter, ioredis]) => {
        const Redis = ioredis.default;
        const pub = new Redis(process.env.REDIS_URL!);
        const sub = pub.duplicate();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (io as any).adapter(redisAdapter.createAdapter(pub, sub));
        console.log(`[redis] adapter connected to ${process.env.REDIS_URL}`);
      })
      .catch((err: unknown) => {
        console.error("[redis] failed to load adapter — running without it:", err);
      });
  }

  const roomManager = new RoomManager();
  const waitingQueue = new WaitingQueue();
  const rejoinManager = new RejoinManager();
  const timerManager = new TimerManager(io, roomManager);
  const botManager = new BotManager(io, roomManager, timerManager);
  const matchmaking = new MatchmakingService(roomManager, botManager);
  const idleSweeper = new IdleSweeper(io, roomManager, timerManager, (id) => {
    botManager.cleanup(id);
    rejoinManager.cleanupRoom(id);
  });
  idleSweeper.start(IDLE_MATCH_TIMEOUT_MS, IDLE_SWEEP_INTERVAL_MS);

  // T-v0.6-D09, D10 — attach HTTP matchmaking endpoints to the same httpServer.
  // Socket.IO ignores non-/socket.io/ URLs; our listener only reacts to
  // /matchmaking/*, so other listeners are unaffected.
  const matchmakingHttp = createMatchmakingHttpHandler({ roomManager, matchmaking });
  httpServer.on("request", (req, res) => {
    if (!req.url?.startsWith("/matchmaking/")) return;
    void matchmakingHttp(req, res);
  });

  // T-v0.6-D02 (revised) — if the handshake carries a valid room token,
  // place the socket into the referenced room and skip the legacy join_queue
  // path. Legacy (untoken) handshakes continue to work for v0.5 tests.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next();
      return;
    }
    const payload = verifyRoomToken(token);
    if (!payload) {
      next(new Error("invalid_token"));
      return;
    }
    const room = roomManager.getRoom(payload.roomId);
    if (!room || room.status !== "active") {
      next(new Error("room_closed"));
      return;
    }
    if (room.userIds[payload.slot] !== payload.userId) {
      next(new Error("slot_mismatch"));
      return;
    }
    socket.data.roomId = payload.roomId;
    socket.data.userId = payload.userId;
    socket.data.slot = payload.slot;
    next();
  });

  const disconnectedPlayers = new Map<string, ReturnType<typeof setTimeout>>();

  function roomCleanup(roomId: string): void {
    botManager.cleanup(roomId);
    rejoinManager.cleanupRoom(roomId);
  }

  function startBotGame(roomId: string, humanSocketId: string): void {
    const humanSocket = io.sockets.sockets.get(humanSocketId);
    if (!humanSocket || !humanSocket.connected) {
      timerManager.scheduleRoomClose(roomId);
      return;
    }

    const room = roomManager.joinRoom(roomId, BOT_ID);
    if (!room) return;

    if (!botManager.setup(roomId)) return;

    logEvent("player_joined", { matchId: roomId, playerId: BOT_ID, bot: true });

    const firstPlayerId = Math.random() < 0.5 ? humanSocketId : BOT_ID;
    room.activePlayer = firstPlayerId;

    timerManager.startRoomTimer(roomId, humanSocketId, BOT_ID, (id) => {
      roomCleanup(id);
      timerManager.scheduleRoomClose(id);
    });

    const rejoinToken = rejoinManager.generate(roomId, humanSocketId);

    humanSocket.emit("match_found", {
      roomId,
      seed: room.seed,
      opponentId: BOT_ID,
      myPlayerId: humanSocketId,
      firstPlayerId,
      mode: "turn_based",
      rejoinToken,
    });

    if (firstPlayerId === BOT_ID) {
      botManager.scheduleBotTurn(roomId, humanSocketId);
    }
  }

  function startBotFallback(roomId: string, socket: Socket): void {
    const timeoutId = setTimeout(() => {
      const removed = waitingQueue.removeBySocket(socket.id);
      if (removed) startBotGame(roomId, socket.id);
    }, BOT_WAIT_MS);
    waitingQueue.setBotTimeout(socket.id, timeoutId);
  }

  io.on("connection", (socket) => {
    console.log(`[connect] ${socket.id}`);

    // T-v0.6-D02 (revised) — room-token handshake: place the socket directly
    // into its pre-existing room and emit match_found without needing a
    // `matchmake` event from the client.
    const tokenRoomId = socket.data.roomId as string | undefined;
    const tokenUserId = socket.data.userId as string | undefined;
    const tokenSlot = socket.data.slot as 0 | 1 | undefined;
    if (tokenRoomId && tokenUserId !== undefined && tokenSlot !== undefined) {
      const room = roomManager.attachSocketToSlot(tokenRoomId, tokenSlot, socket.id);
      if (room) {
        socket.join(tokenRoomId);
        logEvent("player_joined", { matchId: tokenRoomId, playerId: socket.id });

        const opponentSlot = tokenSlot === 0 ? 1 : 0;
        const opponentUserId = room.userIds[opponentSlot];
        const isBotOpponent = opponentUserId === BOT_USER_ID;

        // Both slots bound (both humans connected, OR bot opponent is
        // always "present"): start the match.
        const bothSocketsConnected = room.players.length === 2;
        if (bothSocketsConnected || isBotOpponent) {
          if (!room.activePlayer) {
            // Pick starter deterministically for reproducibility: slot 0 goes first.
            room.activePlayer = room.players[0];
          }
          if (isBotOpponent) {
            botManager.setup(room.id);
            timerManager.startRoomTimer(
              room.id,
              socket.id,
              BOT_ID,
              (id) => {
                roomCleanup(id);
                timerManager.scheduleRoomClose(id);
              }
            );
          } else if (room.players.length === 2) {
            const [p0, p1] = room.players as [string, string];
            timerManager.startRoomTimer(room.id, p0, p1, (id) => {
              rejoinManager.cleanupRoom(id);
              timerManager.scheduleRoomClose(id);
            });
          }

          for (const pid of room.players) {
            const opponentSocketId = room.players.find((p) => p !== pid) ?? BOT_ID;
            io.to(pid).emit("match_found", {
              roomId: room.id,
              seed: room.seed,
              opponentId: isBotOpponent ? BOT_ID : opponentSocketId,
              myPlayerId: pid,
              firstPlayerId: room.activePlayer,
              mode: "turn_based",
            });
          }

          if (isBotOpponent && room.activePlayer === BOT_ID) {
            botManager.scheduleBotTurn(room.id, socket.id);
          }
        }
      }
    }

    socket.on("matchmake", () => {
      if (waitingQueue.size > 0) {
        const entry = waitingQueue.shift();
        if (!entry) return;

        const room = roomManager.joinRoom(entry.roomId, socket.id);
        if (room === null) {
          const newRoom = roomManager.createRoom(socket.id);
          logEvent("match_created", { matchId: newRoom.id, seed: newRoom.seed });
          logEvent("player_joined", { matchId: newRoom.id, playerId: socket.id });
          socket.join(newRoom.id);
          waitingQueue.enqueue(newRoom.id, socket.id);
          startBotFallback(newRoom.id, socket);
          return;
        }

        const roomId = room.id;
        logEvent("player_joined", { matchId: roomId, playerId: socket.id });
        socket.join(roomId);

        const [player1Id, player2Id] = room.players as [string, string];
        const firstPlayerId = Math.random() < 0.5 ? player1Id : player2Id;
        room.activePlayer = firstPlayerId;

        timerManager.startRoomTimer(roomId, player1Id, player2Id, (id) => {
          rejoinManager.cleanupRoom(id);
          timerManager.scheduleRoomClose(id);
        });

        const token1 = rejoinManager.generate(roomId, player1Id);
        const token2 = rejoinManager.generate(roomId, player2Id);

        io.to(player1Id).emit("match_found", {
          roomId,
          seed: room.seed,
          opponentId: player2Id,
          myPlayerId: player1Id,
          firstPlayerId,
          mode: "turn_based",
          rejoinToken: token1,
        });
        io.to(player2Id).emit("match_found", {
          roomId,
          seed: room.seed,
          opponentId: player1Id,
          myPlayerId: player2Id,
          firstPlayerId,
          mode: "turn_based",
          rejoinToken: token2,
        });
      } else {
        const room = roomManager.createRoom(socket.id);
        logEvent("match_created", { matchId: room.id, seed: room.seed });
        logEvent("player_joined", { matchId: room.id, playerId: socket.id });
        socket.join(room.id);
        waitingQueue.enqueue(room.id, socket.id);
        startBotFallback(room.id, socket);
      }
    });

    socket.on("rejoin", (data: { token: string }) => {
      const entry = rejoinManager.verify(data.token);
      if (!entry) {
        socket.emit("rejoin_failed", { reason: "invalid or expired token" });
        return;
      }

      const { roomId, playerId: oldPlayerId } = entry;
      const room = roomManager.getRoom(roomId);
      if (!room || room.status === "over") {
        socket.emit("rejoin_failed", { reason: "game already ended" });
        rejoinManager.delete(data.token);
        logEvent("rejoin", {
          matchId: roomId,
          playerId: socket.id,
          oldPlayerId,
          ok: false,
          reason: "game already ended",
        });
        return;
      }

      const gracePending = disconnectedPlayers.get(oldPlayerId);
      if (gracePending) {
        clearTimeout(gracePending);
        disconnectedPlayers.delete(oldPlayerId);
      }

      const updatedRoom = roomManager.replacePlayer(oldPlayerId, socket.id);
      if (!updatedRoom) {
        socket.emit("rejoin_failed", { reason: "could not rejoin room" });
        return;
      }

      socket.join(roomId);

      rejoinManager.delete(data.token);
      const newToken = rejoinManager.generate(roomId, socket.id);

      const times = timerManager.getTimes(roomId);
      const opponentId = updatedRoom.players.find((p) => p !== socket.id) ?? null;

      const remappedMoves = updatedRoom.moves.map((m) =>
        m.playerId === oldPlayerId ? { ...m, playerId: socket.id } : m
      );

      logEvent("rejoin", {
        matchId: roomId,
        playerId: socket.id,
        oldPlayerId,
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
        rejoinToken: newToken,
      });

      socket.to(roomId).emit("opponent_reconnected");
    });

    socket.on(
      "move",
      (data: { roomId: string; r1: number; c1: number; r2: number; c2: number }) => {
        const move = {
          playerId: socket.id,
          r1: data.r1,
          c1: data.c1,
          r2: data.r2,
          c2: data.c2,
          timestamp: Date.now(),
        };

        if (!isValidMove(move)) {
          socket.emit("move_rejected", { reason: "invalid move", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "invalid move" });
          return;
        }

        const room = roomManager.getRoom(data.roomId);
        if (!room) {
          socket.emit("move_rejected", { reason: "room not found", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "room not found" });
          return;
        }

        if (!room.players.includes(socket.id)) {
          socket.emit("move_rejected", { reason: "not in room", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not in room" });
          return;
        }

        if (room.activePlayer && room.activePlayer !== socket.id) {
          socket.emit("move_rejected", { reason: "not your turn", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not your turn" });
          return;
        }

        if (!roomManager.addMove(data.roomId, move)) {
          socket.emit("move_rejected", { reason: "room not found", move });
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

        if (botManager.isBotRoom(data.roomId)) {
          botManager.applyMove(data.roomId, data.r1, data.c1, data.r2, data.c2);
        }

        const nextPlayer = room.players.find((p) => p !== socket.id);
        if (nextPlayer) {
          room.activePlayer = nextPlayer;
          const times = timerManager.getTimes(data.roomId);
          io.to(data.roomId).emit("turn_changed", {
            activePlayerId: nextPlayer,
            times: times ?? {},
          });

          if (nextPlayer === BOT_ID) {
            botManager.scheduleBotTurn(data.roomId, socket.id);
          }
        }
      }
    );

    socket.on("disconnect", () => {
      console.log(`[disconnect] ${socket.id}`);
      logEvent("disconnect", { playerId: socket.id });

      waitingQueue.removeBySocket(socket.id);

      const activeRoom = roomManager.getRoomByPlayer(socket.id);
      if (activeRoom) {
        if (botManager.isBotRoom(activeRoom.id)) {
          timerManager.stopTimer(activeRoom.id);
          roomCleanup(activeRoom.id);
          timerManager.scheduleRoomClose(activeRoom.id);
          roomManager.removePlayer(socket.id);
          logEvent("match_ended", { matchId: activeRoom.id, reason: "human_left_bot_room" });
        } else {
          socket.to(activeRoom.id).emit("opponent_reconnecting", {
            timeoutMs: REJOIN_WINDOW_MS,
          });

          const gracePending = setTimeout(() => {
            disconnectedPlayers.delete(socket.id);
            const room = roomManager.getRoom(activeRoom.id);
            if (room && room.players.includes(socket.id)) {
              timerManager.stopTimer(activeRoom.id);
              room.status = "over";
              io.to(activeRoom.id).emit("game_over", {});
              timerManager.scheduleRoomClose(activeRoom.id, (id) =>
                rejoinManager.cleanupRoom(id)
              );
              roomManager.removePlayer(socket.id);
              logEvent("match_ended", { matchId: activeRoom.id, reason: "rejoin_window_expired" });
            }
          }, REJOIN_WINDOW_MS);

          disconnectedPlayers.set(socket.id, gracePending);
        }
      } else {
        roomManager.removePlayer(socket.id);
      }
    });
  });

  return {
    io,
    httpServer,
    roomManager,
    rejoinManager,
    timerManager,
    botManager,
    idleSweeper,
    matchmaking,
    get port(): number {
      const addr = httpServer.address();
      if (addr && typeof addr === "object") return addr.port;
      return 0;
    },
    async close(): Promise<void> {
      idleSweeper.stop();
      matchmaking.shutdown();
      for (const handle of disconnectedPlayers.values()) clearTimeout(handle);
      disconnectedPlayers.clear();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

/**
 * Starts the server on the given port (0 = random free port). Returns the
 * handle once the server is listening.
 */
export function startServer(port: number): Promise<ServerHandle> {
  const handle = createMatch3Server();
  return new Promise((resolve) => {
    handle.httpServer.listen(port, () => resolve(handle));
  });
}

if (require.main === module) {
  const PORT = Number(process.env.PORT ?? 3001);
  startServer(PORT).then(() => {
    console.log(`Match-3 backend listening on port ${PORT}`);
  });
}
