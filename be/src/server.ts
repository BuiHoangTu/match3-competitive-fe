import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import { isValidMove } from "./validator";
import { BotPlayer } from "@match3/shared/bot/BotPlayer";
import { createBoard, swapTiles, type Board } from "@match3/shared/engine/Board";
import { createRng } from "@match3/shared/engine/rng";
import { resolveBoard } from "@match3/shared/engine/MatchEngine";

const PORT = 3001;
const PLAYER_TIME_MS = 5 * 60 * 1000;
const BOT_ID = "BOT";
const BOT_WAIT_MS = 5_000;
const BOT_THINK_MS = 700;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

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

const roomTimers = new Map<string, TimerState>();
const botStates = new Map<string, BotBoardState>();

let waitingRoomId: string | null = null;
let waitingBotTimeoutId: ReturnType<typeof setTimeout> | null = null;

function stopRoomTimer(roomId: string): void {
  const t = roomTimers.get(roomId);
  if (t) {
    clearInterval(t.intervalId);
    roomTimers.delete(roomId);
  }
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
      io.to(roomId).emit("game_over", {
        loserTimeUp: room.activePlayer,
        times: { ...timerState.times },
      });
    }
  }, 1000);

  roomTimers.set(roomId, { intervalId, times });
}

function scheduleBotTurn(roomId: string, humanSocket: Socket): void {
  setTimeout(() => {
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

    room.activePlayer = humanSocket.id;
    const timerState = roomTimers.get(roomId);
    io.to(roomId).emit("turn_changed", {
      activePlayerId: humanSocket.id,
      times: timerState ? { ...timerState.times } : {},
    });
  }, BOT_THINK_MS);
}

function startBotGame(roomId: string, humanSocket: Socket): void {
  const room = roomManager.joinRoom(roomId, BOT_ID);
  if (!room) return;
  waitingRoomId = null;

  const { seed } = room;
  botStates.set(roomId, {
    board: createBoard(seed),
    rng: createRng(seed + 1),
  });

  const humanId = humanSocket.id;
  const firstPlayerId = Math.random() < 0.5 ? humanId : BOT_ID;
  room.activePlayer = firstPlayerId;

  startRoomTimer(roomId, humanId, BOT_ID);

  humanSocket.emit("match_found", {
    roomId,
    seed,
    opponentId: BOT_ID,
    myPlayerId: humanId,
    firstPlayerId,
    mode: "turn_based",
  });

  if (firstPlayerId === BOT_ID) {
    scheduleBotTurn(roomId, humanSocket);
  }
}

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("matchmake", () => {
    if (waitingRoomId !== null) {
      // Cancel bot fallback — a human arrived
      if (waitingBotTimeoutId !== null) {
        clearTimeout(waitingBotTimeoutId);
        waitingBotTimeoutId = null;
      }

      const room = roomManager.joinRoom(waitingRoomId, socket.id);
      if (room === null) {
        const newRoom = roomManager.createRoom(socket.id);
        waitingRoomId = newRoom.id;
        socket.join(newRoom.id);
        return;
      }

      const roomId = room.id;
      waitingRoomId = null;
      socket.join(roomId);

      const [player1Id, player2Id] = room.players as [string, string];
      const firstPlayerId = Math.random() < 0.5 ? player1Id : player2Id;
      room.activePlayer = firstPlayerId;

      startRoomTimer(roomId, player1Id, player2Id);

      io.to(player1Id).emit("match_found", {
        roomId,
        seed: room.seed,
        opponentId: player2Id,
        myPlayerId: player1Id,
        firstPlayerId,
        mode: "turn_based",
      });
      io.to(player2Id).emit("match_found", {
        roomId,
        seed: room.seed,
        opponentId: player1Id,
        myPlayerId: player2Id,
        firstPlayerId,
        mode: "turn_based",
      });
    } else {
      const room = roomManager.createRoom(socket.id);
      waitingRoomId = room.id;
      socket.join(room.id);

      waitingBotTimeoutId = setTimeout(() => {
        waitingBotTimeoutId = null;
        if (waitingRoomId === room.id) {
          startBotGame(room.id, socket);
        }
      }, BOT_WAIT_MS);
    }
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
          scheduleBotTurn(data.roomId, socket);
        }
      }
    }
  );

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);

    if (waitingRoomId !== null) {
      const waitingRoom = roomManager.getRoom(waitingRoomId);
      if (waitingRoom && waitingRoom.players.includes(socket.id)) {
        waitingRoomId = null;
        if (waitingBotTimeoutId !== null) {
          clearTimeout(waitingBotTimeoutId);
          waitingBotTimeoutId = null;
        }
      }
    }

    const activeRoom = roomManager.getRoomByPlayer(socket.id);
    if (activeRoom) {
      stopRoomTimer(activeRoom.id);
      botStates.delete(activeRoom.id);
      socket.to(activeRoom.id).emit("opponent_disconnected");
    }

    roomManager.removePlayer(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Match-3 backend listening on port ${PORT}`);
});
