import { describe, it, expect, beforeEach } from "vitest";
import { RoomManager } from "../RoomManager";

describe("RoomManager", () => {
  let rm: RoomManager;

  beforeEach(() => {
    rm = new RoomManager();
  });

  it("createRoom returns a room with the creator as first player", () => {
    const room = rm.createRoom("player1");
    expect(room.players).toEqual(["player1"]);
    expect(typeof room.seed).toBe("number");
    expect(room.id).toBeTruthy();
  });

  it("joinRoom adds a second player", () => {
    const room = rm.createRoom("player1");
    const joined = rm.joinRoom(room.id, "player2");
    expect(joined).not.toBeNull();
    expect(joined!.players).toEqual(["player1", "player2"]);
  });

  it("joinRoom returns null when room is full", () => {
    const room = rm.createRoom("player1");
    rm.joinRoom(room.id, "player2");
    const result = rm.joinRoom(room.id, "player3");
    expect(result).toBeNull();
  });

  it("joinRoom returns null for unknown room", () => {
    const result = rm.joinRoom("no-such-room", "player1");
    expect(result).toBeNull();
  });

  it("addMove appends a move and returns true", () => {
    const room = rm.createRoom("player1");
    const move = { playerId: "player1", r1: 0, c1: 0, r2: 0, c2: 1, timestamp: 1000 };
    const ok = rm.addMove(room.id, move);
    expect(ok).toBe(true);
    expect(rm.getRoom(room.id)!.moves).toHaveLength(1);
  });

  it("addMove returns false for unknown room", () => {
    const move = { playerId: "player1", r1: 0, c1: 0, r2: 0, c2: 1, timestamp: 1000 };
    expect(rm.addMove("ghost", move)).toBe(false);
  });

  it("getRoom returns the room by id", () => {
    const room = rm.createRoom("player1");
    expect(rm.getRoom(room.id)).toBe(room);
  });

  it("getRoom returns null for unknown id", () => {
    expect(rm.getRoom("nope")).toBeNull();
  });

  it("removePlayer removes the player and cleans up empty room", () => {
    const room = rm.createRoom("player1");
    rm.removePlayer("player1");
    expect(rm.getRoom(room.id)).toBeNull();
  });

  it("removePlayer keeps room alive when one player remains", () => {
    const room = rm.createRoom("player1");
    rm.joinRoom(room.id, "player2");
    rm.removePlayer("player1");
    const remaining = rm.getRoom(room.id);
    expect(remaining).not.toBeNull();
    expect(remaining!.players).toEqual(["player2"]);
  });

  it("removePlayer is a no-op for unknown player", () => {
    expect(() => rm.removePlayer("ghost")).not.toThrow();
  });
});
