import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import { WaitingQueue } from "./WaitingQueue";
import { RejoinManager } from "./RejoinManager";
import { TimerManager } from "./TimerManager";
import { BotManager } from "./BotManager";
import { isValidMove } from "./validator";
import { BOT_ID, BOT_WAIT_MS, REJOIN_WINDOW_MS } from "./constants";

const PORT = Number(process.env.PORT ?? 3001);

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// Optional Redis adapter for horizontal scaling (set REDIS_URL env var to enable)
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

// Grace-period timeouts for disconnected PvP players: socketId → timeout handle
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

// ── Socket.IO handlers ────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("matchmake", () => {
    if (waitingQueue.size > 0) {
      const entry = waitingQueue.shift();
      if (!entry) return;

      const room = roomManager.joinRoom(entry.roomId, socket.id);
      if (room === null) {
        const newRoom = roomManager.createRoom(socket.id);
        socket.join(newRoom.id);
        waitingQueue.enqueue(newRoom.id, socket.id);
        startBotFallback(newRoom.id, socket);
        return;
      }

      const roomId = room.id;
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
        return;
      }

      const room = roomManager.getRoom(data.roomId);
      if (!room) {
        socket.emit("move_rejected", { reason: "room not found", move });
        return;
      }

      if (!room.players.includes(socket.id)) {
        socket.emit("move_rejected", { reason: "not in room", move });
        return;
      }

      if (room.activePlayer && room.activePlayer !== socket.id) {
        socket.emit("move_rejected", { reason: "not your turn", move });
        return;
      }

      if (!roomManager.addMove(data.roomId, move)) {
        socket.emit("move_rejected", { reason: "room not found", move });
        return;
      }

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

    waitingQueue.removeBySocket(socket.id);

    const activeRoom = roomManager.getRoomByPlayer(socket.id);
    if (activeRoom) {
      if (botManager.isBotRoom(activeRoom.id)) {
        timerManager.stopTimer(activeRoom.id);
        roomCleanup(activeRoom.id);
        timerManager.scheduleRoomClose(activeRoom.id);
        roomManager.removePlayer(socket.id);
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
          }
        }, REJOIN_WINDOW_MS);

        disconnectedPlayers.set(socket.id, gracePending);
      }
    } else {
      roomManager.removePlayer(socket.id);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Match-3 backend listening on port ${PORT}`);
});
