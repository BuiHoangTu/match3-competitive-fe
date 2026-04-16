export type Move = {
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  timestamp: number;
};

export type Room = {
  id: string;
  players: string[];
  seed: number;
  moves: Move[];
};

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  // Map from playerId to roomId for fast lookup
  private playerRoom: Map<string, string> = new Map();

  createRoom(playerId: string): Room {
    const room: Room = {
      id: generateId(),
      players: [playerId],
      seed: Math.floor(Math.random() * 2 ** 31),
      moves: [],
    };
    this.rooms.set(room.id, room);
    this.playerRoom.set(playerId, room.id);
    return room;
  }

  joinRoom(roomId: string, playerId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.players.length >= 2) return null;
    room.players.push(playerId);
    this.playerRoom.set(playerId, roomId);
    return room;
  }

  addMove(roomId: string, move: Move): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.moves.push(move);
    return true;
  }

  getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) ?? null;
  }

  removePlayer(playerId: string): void {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return;
    this.playerRoom.delete(playerId);

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.players = room.players.filter((p) => p !== playerId);
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
    }
  }
}
