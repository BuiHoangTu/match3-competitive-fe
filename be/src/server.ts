import { createServer } from "http";
import { createHmac, randomBytes } from "crypto";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import { isValidMove } from "./validator";
import { BotPlayer } from "@match3/shared/bot/BotPlayer";
import { createBoard, swapTiles, type Board } from "@match3/shared/engine/Board";
import { createRng } from "@match3/shared/engine/rng";
import { resolveBoard } from "@match3/shared/engine/MatchEngine";

const PORT = Number(process.env.PORT ?? 3001);
const PLAYER_TIME_MS = 5 * 60 * 1000;
const BOT_ID = "BOT";
const BOT_WAIT_MS = 5_000;
const BOT_THINK_MS = 700;

// B1: HMAC secret — stable across restarts via env var
const REJOIN_SECRET =
  process.env.REJOIN_SECRET ?? randomBytes(32).toString("hex");
const REJOIN_WINDOW_MS = 60_000;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// C1: optional Redis adapter for horizontal scaling
// Set REDIS_URL env var to enable (e.g. REDIS_URL=redis://localhost:6379)
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
const botPlayer = new BotPlayer();

interface TimerState {
  intervalId: ReturnType<typeof setInterval>;
  times: Record<string, number>;
}

interface BotBoardState {
  board: Board;
  rng: () => number;
}

// B1: rejoin token store — token → { roomId, playerId, expiresAt }
interface RejoinEntry {
  roomId: string;
  playerId: string;
  expiresAt: number;
}

const roomTimers = new Map<string, TimerState>();
const botStates = new Map<string, BotBoardState>();
const rejoinTokens = new Map<string, RejoinEntry>();
// B1: grace-period timeouts — old socketId → timeout handle
const disconnectedPlayers = new Map<string, ReturnType<typeof setTimeout>>();

// ── B1: Token helpers ─────────────────────────────────────────────────────────

function generateRejoinToken(roomId: string, playerId: string): string {
  const expiresAt = Date.now() + REJOIN_WINDOW_MS;
  const sig = createHmac("sha256", REJOIN_SECRET)
    .update(`${roomId}:${playerId}:${expiresAt}`)
    .digest("hex");
  const token = `${sig}:${expiresAt}`;
  rejoinTokens.set(token, { roomId, playerId, expiresAt });
  return token;
}

function verifyRejoinToken(token: string): RejoinEntry | null {
  const entry = rejoinTokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rejoinTokens.delete(token);
    return null;
  }
  // Re-verify HMAC to guard against memory tampering
  const { roomId, playerId, expiresAt } = entry;
  const expected = createHmac("sha256", REJOIN_SECRET)
    .update(`${roomId}:${playerId}:${expiresAt}`)
    .digest("hex");
  const [sig] = token.split(":");
  if (sig !== expected) {
    rejoinTokens.delete(token);
    return null;
  }
  return entry;
}

// ── A1: WaitingQueue ─────────────────────────────────────────────────────────

interface WaitingEntry {
  roomId: string;
  socketId: string;
  botTimeoutId: ReturnType<typeof setTimeout> | null;
}

class WaitingQueue {
  private entries: WaitingEntry[] = [];

  enqueue(roomId: string, socketId: string): void {
    this.entries.push({ roomId, socketId, botTimeoutId: null });
  }

  shift(): WaitingEntry | null {
    const entry = this.entries.shift() ?? null;
    if (entry?.botTimeoutId) clearTimeout(entry.botTimeoutId);
    return entry;
  }

  // Returns true if found and removed
  removeBySocket(socketId: string): boolean {
    const idx = this.entries.findIndex((e) => e.socketId === socketId);
    if (idx === -1) return false;
    const [entry] = this.entries.splice(idx, 1);
    if (entry?.botTimeoutId) clearTimeout(entry.botTimeoutId);
    return true;
  }

  setBotTimeout(socketId: string, timeoutId: ReturnType<typeof setTimeout>): void {
    const entry = this.entries.find((e) => e.socketId === socketId);
    if (entry) entry.botTimeoutId = timeoutId;
  }

  get size(): number {
    return this.entries.length;
  }
}

const waitingQueue = new WaitingQueue();

// ── Timer helpers ─────────────────────────────────────────────────────────────

function stopRoomTimer(roomId: string): void {
  const t = roomTimers.get(roomId);
  if (t) {
    clearInterval(t.intervalId);
    roomTimers.delete(roomId);
  }
}

// A6: schedule cleanup 30 s after game ends
function scheduleRoomClose(roomId: string): void {
  setTimeout(() => {
    const room = roomManager.getRoom(roomId);
    if (room) {
      // B1: remove any rejoin tokens for this room's players
      for (const [token, entry] of rejoinTokens) {
        if (entry.roomId === roomId) rejoinTokens.delete(token);
      }
    }
    roomManager.closeRoom(roomId);
    botStates.delete(roomId);
    stopRoomTimer(roomId);
  }, 30_000);
}

function startRoomTimer(
  roomId: string,
  player1Id: string,
  player2Id: string
): void {
  const times: Record<string, number> = {
    [player1Id]: PLAYER_TIME_MS,
    [player2Id]: PLAYER_TIME_MS,
  };

  const intervalId = setInterval(() => {
    const room = roomManager.getRoom(roomId);
    const timerState = roomTimers.get(roomId);
    if (!room || !timerState || !room.activePlayer) return;

    // Don't drain bot's clock — it always moves fast
    if (room.activePlayer === BOT_ID) return;

    timerState.times[room.activePlayer] -= 1000;

    if ((timerState.times[room.activePlayer] ?? 0) <= 0) {
      stopRoomTimer(roomId);
      room.status = "over";
      io.to(roomId).emit("game_over", {
        loserTimeUp: room.activePlayer,
        times: { ...timerState.times },
      });
      // A4: clean up bot state on game_over
      botStates.delete(roomId);
      // A6: schedule room close
      scheduleRoomClose(roomId);
    }
  }, 1000);

  roomTimers.set(roomId, { intervalId, times });
}

// ── A2: Bot logic uses humanSocketId (string), not captured Socket ─────────────

function scheduleBotTurn(roomId: string, humanSocketId: string): void {
  setTimeout(() => {
    // A2: look up the socket at call time
    const humanSocket = io.sockets.sockets.get(humanSocketId);
    if (!humanSocket || !humanSocket.connected) {
      stopRoomTimer(roomId);
      botStates.delete(roomId);
      scheduleRoomClose(roomId);
      return;
    }

    const botState = botStates.get(roomId);
    const room = roomManager.getRoom(roomId);
    if (!botState || !room || room.activePlayer !== BOT_ID) return;

    const move = botPlayer.findBestMove(botState.board.grid);
    if (!move) return;

    const { r1, c1, r2, c2 } = move;

    // Apply move to bot's board (resolveBoard is a no-op if no matches)
    const swapped = swapTiles(botState.board, r1, c1, r2, c2);
    const { grid: finalGrid } = resolveBoard(swapped.grid, botState.rng);
    botState.board = { ...swapped, grid: finalGrid };

    const botMove = { playerId: BOT_ID, r1, c1, r2, c2, timestamp: Date.now() };
    roomManager.addMove(roomId, botMove);

    humanSocket.emit("opponent_move", botMove);

    room.activePlayer = humanSocketId;
    const timerState = roomTimers.get(roomId);
    io.to(roomId).emit("turn_changed", {
      activePlayerId: humanSocketId,
      times: timerState ? { ...timerState.times } : {},
    });
  }, BOT_THINK_MS);
}

function startBotGame(roomId: string, humanSocketId: string): void {
  // A2: look up socket at call time
  const humanSocket = io.sockets.sockets.get(humanSocketId);
  if (!humanSocket || !humanSocket.connected) {
    scheduleRoomClose(roomId);
    return;
  }

  const room = roomManager.joinRoom(roomId, BOT_ID);
  if (!room) return;

  const { seed } = room;
  botStates.set(roomId, {
    board: createBoard(seed),
    rng: createRng(seed + 1),
  });

  const humanId = humanSocketId;
  const firstPlayerId = Math.random() < 0.5 ? humanId : BOT_ID;
  room.activePlayer = firstPlayerId;

  startRoomTimer(roomId, humanId, BOT_ID);

  const rejoinToken = generateRejoinToken(roomId, humanId);

  humanSocket.emit("match_found", {
    roomId,
    seed,
    opponentId: BOT_ID,
    myPlayerId: humanId,
    firstPlayerId,
    mode: "turn_based",
    rejoinToken,
  });

  if (firstPlayerId === BOT_ID) {
    scheduleBotTurn(roomId, humanId);
  }
}

// A1: extract startBotFallback helper
function startBotFallback(roomId: string, socket: Socket): void {
  const timeoutId = setTimeout(() => {
    // Confirm the entry is still in the queue before proceeding
    const removed = waitingQueue.removeBySocket(socket.id);
    if (removed) {
      startBotGame(roomId, socket.id);
    }
  }, BOT_WAIT_MS);

  waitingQueue.setBotTimeout(socket.id, timeoutId);
}

// ── Socket.IO handlers ────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("matchmake", () => {
    if (waitingQueue.size > 0) {
      // A1: dequeue the waiting player
      const entry = waitingQueue.shift();
      if (!entry) return;

      const room = roomManager.joinRoom(entry.roomId, socket.id);
      if (room === null) {
        // Waiting room is gone — create a new room for this socket and enqueue it
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

      startRoomTimer(roomId, player1Id, player2Id);

      const token1 = generateRejoinToken(roomId, player1Id);
      const token2 = generateRejoinToken(roomId, player2Id);

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
      // Queue is empty — create a room and wait for an opponent
      const room = roomManager.createRoom(socket.id);
      socket.join(room.id);
      waitingQueue.enqueue(room.id, socket.id);
      startBotFallback(room.id, socket);
    }
  });

  // B1: rejoin handler
  socket.on("rejoin", (data: { token: string }) => {
    const entry = verifyRejoinToken(data.token);
    if (!entry) {
      socket.emit("rejoin_failed", { reason: "invalid or expired token" });
      return;
    }

    const { roomId, playerId: oldPlayerId } = entry;
    const room = roomManager.getRoom(roomId);
    if (!room || room.status === "over") {
      socket.emit("rejoin_failed", { reason: "game already ended" });
      rejoinTokens.delete(data.token);
      return;
    }

    // Cancel the grace-period timeout for the old socket
    const gracePending = disconnectedPlayers.get(oldPlayerId);
    if (gracePending) {
      clearTimeout(gracePending);
      disconnectedPlayers.delete(oldPlayerId);
    }

    // Swap old player ID → new socket ID
    const updatedRoom = roomManager.replacePlayer(oldPlayerId, socket.id);
    if (!updatedRoom) {
      socket.emit("rejoin_failed", { reason: "could not rejoin room" });
      return;
    }

    socket.join(roomId);

    // Invalidate old token, issue fresh one
    rejoinTokens.delete(data.token);
    const newToken = generateRejoinToken(roomId, socket.id);

    const timerState = roomTimers.get(roomId);
    const opponentId = updatedRoom.players.find((p) => p !== socket.id) ?? null;

    // Remap move history: old playerId → new socket.id
    const remappedMoves = updatedRoom.moves.map((m) =>
      m.playerId === oldPlayerId ? { ...m, playerId: socket.id } : m
    );

    socket.emit("rejoin_ok", {
      roomId,
      seed: updatedRoom.seed,
      moves: remappedMoves,
      myPlayerId: socket.id,
      activePlayerId: updatedRoom.activePlayer,
      times: timerState ? { ...timerState.times } : {},
      opponentId,
      rejoinToken: newToken,
    });

    // Notify opponent that player reconnected
    socket.to(roomId).emit("opponent_reconnected");
  });

  socket.on(
    "move",
    (data: {
      roomId: string;
      r1: number;
      c1: number;
      r2: number;
      c2: number;
    }) => {
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

      // A3: verify room membership
      if (!room.players.includes(socket.id)) {
        socket.emit("move_rejected", { reason: "not in room", move });
        return;
      }

      if (room.activePlayer && room.activePlayer !== socket.id) {
        socket.emit("move_rejected", { reason: "not your turn", move });
        return;
      }

      const added = roomManager.addMove(data.roomId, move);
      if (!added) {
        socket.emit("move_rejected", { reason: "room not found", move });
        return;
      }

      socket.to(data.roomId).emit("opponent_move", move);

      // In bot rooms, apply human's move to the shared board so the bot
      // always plays on the current state of the board
      const botState = botStates.get(data.roomId);
      if (botState) {
        try {
          const swapped = swapTiles(botState.board, data.r1, data.c1, data.r2, data.c2);
          const { grid: finalGrid } = resolveBoard(swapped.grid, botState.rng);
          botState.board = { ...swapped, grid: finalGrid };
        } catch {
          // Invalid swap — ignore (validator already checked adjacency)
        }
      }

      const nextPlayer = room.players.find((p) => p !== socket.id);
      if (nextPlayer) {
        room.activePlayer = nextPlayer;
        const timerState = roomTimers.get(data.roomId);
        io.to(data.roomId).emit("turn_changed", {
          activePlayerId: nextPlayer,
          times: timerState ? { ...timerState.times } : {},
        });

        if (nextPlayer === BOT_ID) {
          scheduleBotTurn(data.roomId, socket.id);
        }
      }
    }
  );

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);

    // A1: clean up from waiting queue if present
    waitingQueue.removeBySocket(socket.id);

    const activeRoom = roomManager.getRoomByPlayer(socket.id);
    if (activeRoom) {
      const isBotRoom = activeRoom.players.includes(BOT_ID);

      if (isBotRoom) {
        // Bot games: immediate cleanup, no reconnect
        stopRoomTimer(activeRoom.id);
        botStates.delete(activeRoom.id);
        scheduleRoomClose(activeRoom.id);
        roomManager.removePlayer(socket.id);
      } else {
        // B1: PvP games: 60s grace period for reconnect
        socket.to(activeRoom.id).emit("opponent_reconnecting", {
          timeoutMs: REJOIN_WINDOW_MS,
        });

        const gracePending = setTimeout(() => {
          disconnectedPlayers.delete(socket.id);
          const room = roomManager.getRoom(activeRoom.id);
          if (room && room.players.includes(socket.id)) {
            stopRoomTimer(activeRoom.id);
            room.status = "over";
            io.to(activeRoom.id).emit("game_over", {});
            scheduleRoomClose(activeRoom.id);
            roomManager.removePlayer(socket.id);
          }
        }, REJOIN_WINDOW_MS);

        disconnectedPlayers.set(socket.id, gracePending);
        // Keep player in room during grace period (do NOT call removePlayer yet)
      }
    } else {
      roomManager.removePlayer(socket.id);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Match-3 backend listening on port ${PORT}`);
});
