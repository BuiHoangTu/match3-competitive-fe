import { randomUUID } from "crypto";
import type { Move } from "@match3/shared/protocol";

export type { Move };

export type Room = {
  id: string;
  players: string[];
  seed: number;
  moves: Move[];
  activePlayer: string | null;
  status: "active" | "over";
  /** Epoch ms of the last event that should reset the idle-match timer. */
  lastActivityAt: number;
};

function generateId(): string {
  return randomUUID();
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRoom: Map<string, string> = new Map();

  createRoom(playerId: string): Room {
    const room: Room = {
      id: generateId(),
      players: [playerId],
      seed: Math.floor(Math.random() * 2 ** 31),
      moves: [],
      activePlayer: null,
      status: "active",
      lastActivityAt: Date.now(),
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
    if (room.moves.length > 200) room.moves.splice(0, room.moves.length - 200);
    room.lastActivityAt = Date.now();
    return true;
  }

  /**
   * Returns all active rooms whose last activity is older than `cutoffMs` ago.
   * Does not mutate room state — caller decides how to close them.
   */
  findIdleRooms(cutoffMs: number, now: number = Date.now()): Room[] {
    const idle: Room[] = [];
    for (const room of this.rooms.values()) {
      if (room.status !== "active") continue;
      if (now - room.lastActivityAt >= cutoffMs) idle.push(room);
    }
    return idle;
  }

  getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) ?? null;
  }

  getRoomByPlayer(playerId: string): Room | null {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return null;
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

  replacePlayer(oldPlayerId: string, newPlayerId: string): Room | null {
    const roomId = this.playerRoom.get(oldPlayerId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const idx = room.players.indexOf(oldPlayerId);
    if (idx === -1) return null;

    room.players[idx] = newPlayerId;
    this.playerRoom.delete(oldPlayerId);
    this.playerRoom.set(newPlayerId, roomId);

    if (room.activePlayer === oldPlayerId) {
      room.activePlayer = newPlayerId;
    }

    return room;
  }

  closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const playerId of [...room.players]) {
      this.playerRoom.delete(playerId);
    }
    this.rooms.delete(roomId);
  }
}
