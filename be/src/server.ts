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
import { checkTokenExpiry } from "./AuthMiddleware";
import { isValidMove, checkUserIdOwnsSlot } from "./validator";
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

export interface ServerOptions {
  /**
   * T-v0.6-D07 · When true (default in non-test environments), reject any
   * Socket.IO connection that does not carry a room token in
   * `socket.handshake.auth.token`. Set to false only in v0.5 legacy test
   * contexts (latency harness, rejoin latency) that drive the deprecated
   * `matchmake` socket event path.
   */
  requireRoomToken?: boolean;
}

/**
 * Build (but do not start) a fully wired Match-3 server. Handlers are bound
 * during construction; listening happens when the caller awaits `close()`-able
 * listen via the returned `httpServer.listen(...)`. For the default CLI
 * bootstrap, use {@link startServer} which listens on a port and returns the
 * handle.
 */
export function createMatch3Server(opts: ServerOptions = {}): ServerHandle {
  // D07: in test environments the legacy matchmake path is still in use;
  // outside tests (and when callers don't opt out) we enforce room tokens.
  const requireRoomToken = opts.requireRoomToken ?? (process.env.NODE_ENV !== "test");
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

  // T-v0.6-D02 / D07 — Room-token handshake middleware.
  // If requireRoomToken is true (production default), reject any connection
  // that arrives without a token (code: no_token). Otherwise (legacy test
  // mode), allow tokenless connections through to the matchmake event path.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      if (requireRoomToken) {
        next(new Error("no_token"));
        return;
      }
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
    // T-v0.6-D06: store room token expiry in seconds so checkTokenExpiry works.
    socket.data.tokenExpSec = Math.floor(payload.exp / 1000);
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

    humanSocket.emit("match_found", {
      roomId,
      seed: room.seed,
      opponentId: BOT_ID,
      myPlayerId: humanSocketId,
      firstPlayerId,
      mode: "turn_based",
      rejoinToken: "", // legacy path — rejoin via /matchmaking/resume instead
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

        io.to(player1Id).emit("match_found", {
          roomId,
          seed: room.seed,
          opponentId: player2Id,
          myPlayerId: player1Id,
          firstPlayerId,
          mode: "turn_based",
          rejoinToken: "", // legacy path — rejoin via /matchmaking/resume instead
        });
        io.to(player2Id).emit("match_found", {
          roomId,
          seed: room.seed,
          opponentId: player1Id,
          myPlayerId: player2Id,
          firstPlayerId,
          mode: "turn_based",
          rejoinToken: "", // legacy path — rejoin via /matchmaking/resume instead
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

    // T-v0.6-G02/G03 · userId-keyed rejoin via verified socket identity.
    // The socket's userId is set by the D02 room-token handshake middleware.
    // Legacy clients that connected via the `matchmake` event do not have a
    // userId on the socket and will receive rejoin_failed immediately; they
    // should reconnect via POST /matchmaking/resume → room token instead.
    socket.on("rejoin", (_data: unknown) => {
      const userId = socket.data.userId as string | undefined;
      if (!userId) {
        socket.emit("rejoin_failed", { reason: "no verified identity — use /matchmaking/resume" });
        return;
      }

      const entry = rejoinManager.lookup(userId);
      if (!entry) {
        socket.emit("rejoin_failed", { reason: "no active rejoin window for this identity" });
        return;
      }

      const { roomId } = entry;
      const room = roomManager.getRoom(roomId);
      if (!room || room.status === "over") {
        socket.emit("rejoin_failed", { reason: "game already ended" });
        rejoinManager.delete(userId);
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
        const gracePending = disconnectedPlayers.get(oldPlayerId);
        if (gracePending) {
          clearTimeout(gracePending);
          disconnectedPlayers.delete(oldPlayerId);
        }
      }

      // Attach the new socket to the slot (replaces old socket ID in room).
      let updatedRoom = room;
      if (oldPlayerId) {
        const replaced = roomManager.replacePlayer(oldPlayerId, socket.id);
        if (replaced) updatedRoom = replaced;
      } else {
        roomManager.attachSocketToSlot(roomId, slotIndex as 0 | 1, socket.id);
      }

      socket.join(roomId);
      rejoinManager.delete(userId);

      const times = timerManager.getTimes(roomId);
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

    socket.on(
      "move",
      async (data: { roomId: string; r1: number; c1: number; r2: number; c2: number }) => {
        // T-v0.6-D06: re-check token expiry on every move event.
        if (!(await checkTokenExpiry(socket))) return;

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

        // T-v0.6-D04 · userId slot check: the socket's verified userId must
        // own a slot in the room. Sockets that connected via room token always
        // have socket.data.userId populated; legacy sockets via matchmake have
        // empty userIds slots ("") which we skip to preserve backward compat.
        const socketUserId = socket.data.userId as string | undefined;
        if (socketUserId) {
          const slotCheck = checkUserIdOwnsSlot(socketUserId, room);
          if (!slotCheck.ok) {
            socket.emit("move_rejected", { reason: slotCheck.reason, move });
            logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: slotCheck.reason });
            return;
          }
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
export function startServer(port: number, opts: ServerOptions = {}): Promise<ServerHandle> {
  const handle = createMatch3Server(opts);
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
