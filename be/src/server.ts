import { createServer } from "http";
import { Server } from "socket.io";
import { RoomManager } from "./RoomManager";
import { isValidMove } from "./validator";

const PORT = 3001;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const roomManager = new RoomManager();

// Holds the single waiting room id (if any player is waiting for a match)
let waitingRoomId: string | null = null;

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("matchmake", () => {
    if (waitingRoomId !== null) {
      // A room already exists — join it
      const room = roomManager.joinRoom(waitingRoomId, socket.id);
      if (room === null) {
        // Room became full or disappeared; create a new one instead
        const newRoom = roomManager.createRoom(socket.id);
        waitingRoomId = newRoom.id;
        socket.join(newRoom.id);
        return;
      }

      const roomId = room.id;
      waitingRoomId = null;

      socket.join(roomId);

      const [player1Id, player2Id] = room.players;

      // Notify both players
      io.to(player1Id).emit("match_found", {
        roomId,
        seed: room.seed,
        opponentId: player2Id,
      });
      io.to(player2Id).emit("match_found", {
        roomId,
        seed: room.seed,
        opponentId: player1Id,
      });

      // End game after 90 seconds
      setTimeout(() => {
        io.to(roomId).emit("game_over");
      }, 90_000);
    } else {
      // No waiting room — create one and wait
      const room = roomManager.createRoom(socket.id);
      waitingRoomId = room.id;
      socket.join(room.id);
    }
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

      const added = roomManager.addMove(data.roomId, move);
      if (!added) {
        socket.emit("move_rejected", { reason: "room not found", move });
        return;
      }

      // Broadcast to the other player in the room
      socket.to(data.roomId).emit("opponent_move", move);
    }
  );

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);

    // If this socket was the only one waiting, clear the waiting slot
    const room = roomManager.getRoom(waitingRoomId ?? "");
    if (room && room.players.includes(socket.id)) {
      waitingRoomId = null;
    }

    roomManager.removePlayer(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Match-3 backend listening on port ${PORT}`);
});
