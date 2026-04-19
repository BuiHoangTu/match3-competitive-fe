import { createServer } from "http";
import { Server } from "socket.io";
import { RoomManager } from "./RoomManager";
import { isValidMove } from "./validator";

const PORT = 3001;
const PLAYER_TIME_MS = 5 * 60 * 1000;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const roomManager = new RoomManager();

interface TimerState {
  intervalId: ReturnType<typeof setInterval>;
  times: Record<string, number>;
}

const roomTimers = new Map<string, TimerState>();

let waitingRoomId: string | null = null;

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

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("matchmake", () => {
    if (waitingRoomId !== null) {
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

      const [player1Id, player2Id] = room.players;
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

      // Switch active player and emit turn_changed
      const nextPlayer = room.players.find((p) => p !== socket.id);
      if (nextPlayer) {
        room.activePlayer = nextPlayer;
        const timerState = roomTimers.get(data.roomId);
        io.to(data.roomId).emit("turn_changed", {
          activePlayerId: nextPlayer,
          times: timerState ? { ...timerState.times } : {},
        });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);

    if (waitingRoomId !== null) {
      const waitingRoom = roomManager.getRoom(waitingRoomId);
      if (waitingRoom && waitingRoom.players.includes(socket.id)) {
        waitingRoomId = null;
      }
    }

    const activeRoom = roomManager.getRoomByPlayer(socket.id);
    if (activeRoom && roomTimers.has(activeRoom.id)) {
      stopRoomTimer(activeRoom.id);
      socket.to(activeRoom.id).emit("opponent_disconnected");
    }

    roomManager.removePlayer(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Match-3 backend listening on port ${PORT}`);
});
