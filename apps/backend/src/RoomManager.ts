import { randomUUID } from "crypto";
import type { Move } from "@match3/shared-js/protocol";
import { createBoard } from "@match3/shared-js/engine/Board";

export type { Move };

export type Room = {
  id: string;
  players: string[];
  /** Per-slot userId; index 0 = slot 0, index 1 = slot 1. Empty string for unfilled/legacy slots. */
  userIds: [string, string];
  seed: number;
  moves: Move[];
  activePlayer: string | null;
  status: "active" | "over";
  /** Epoch ms of the last event that should reset the idle-match timer. */
  lastActivityAt: number;
  /** Game mode — determines whether server-authoritative board state is used. */
  gameMode: "turn_based" | "pve";
  // ── Server-authoritative fields (turn_based rooms only) ──────────────────
  /** The seed used to generate the initial board. Immutable; useful for debug. */
  originalSeed?: number;
  /** Authoritative board grid for turn_based rooms. Updated after every move. */
  boardGrid?: number[][];
  /** mulberry32 integer state after the last resolution. Advances each move. */
  rngState?: number;
  /** Per-player running score totals (socket ID → points). turn_based only. */
  scores?: { [playerId: string]: number };
};

function generateId(): string {
  return randomUUID();
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRoom: Map<string, string> = new Map();
  private userRoom: Map<string, string> = new Map();

  createRoom(playerId: string, gameMode: "turn_based" | "pve" = "turn_based"): Room {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const room: Room = {
      id: generateId(),
      players: [playerId],
      userIds: ["", ""],
      seed,
      moves: [],
      activePlayer: null,
      status: "active",
      lastActivityAt: Date.now(),
      gameMode,
    };
    if (gameMode === "turn_based") {
      room.originalSeed = seed;
      room.boardGrid = createBoard(seed).grid;
      room.rngState = seed;
      room.scores = {};
    }
    this.rooms.set(room.id, room);
    this.playerRoom.set(playerId, room.id);
    return room;
  }

  /**
   * Create a room with both slots pre-populated with userIds. Socket IDs are
   * attached later when the clients connect using their room tokens.
   * T-v0.6-D09.
   */
  createRoomForMatch(
    userIdSlot0: string,
    userIdSlot1: string,
    gameMode: "turn_based" | "pve" = "turn_based"
  ): Room {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const isBotMatch = userIdSlot1 === "bot:default" || userIdSlot0 === "bot:default";
    const effectiveMode = isBotMatch ? "pve" : gameMode;
    const room: Room = {
      id: generateId(),
      players: [],
      userIds: [userIdSlot0, userIdSlot1],
      seed,
      moves: [],
      activePlayer: null,
      status: "active",
      lastActivityAt: Date.now(),
      gameMode: effectiveMode,
    };
    if (effectiveMode === "turn_based") {
      room.originalSeed = seed;
      room.boardGrid = createBoard(seed).grid;
      room.rngState = seed;
      room.scores = {};
    }
    this.rooms.set(room.id, room);
    if (userIdSlot0) this.userRoom.set(userIdSlot0, room.id);
    if (userIdSlot1) this.userRoom.set(userIdSlot1, room.id);
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

  /**
   * Bind a socket ID to a slot in an existing room. Used when a client
   * connects via Socket.IO with a room token after HTTP matchmaking.
   * T-v0.6-D02.
   */
  attachSocketToSlot(roomId: string, slot: 0 | 1, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!room.players.includes(socketId)) room.players.push(socketId);
    this.playerRoom.set(socketId, roomId);
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

  /**
   * Look up the active room for a userId. Returns null if no active room.
   * T-v0.6-D09 (AR-7 one-active-match-per-user enforcement).
   */
  getRoomByUserId(userId: string): Room | null {
    const roomId = this.userRoom.get(userId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId) ?? null;
    if (!room || room.status !== "active") {
      this.userRoom.delete(userId);
      return null;
    }
    return room;
  }

  removePlayer(playerId: string): void {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return;
    this.playerRoom.delete(playerId);

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.players = room.players.filter((p) => p !== playerId);
    if (room.players.length === 0 && room.userIds.every((u) => !u)) {
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
    for (const userId of room.userIds) {
      if (userId) this.userRoom.delete(userId);
    }
    this.rooms.delete(roomId);
  }
}
