import { describe, it, expect } from "vitest";
import { isValidMove } from "../validator";
import type { Move } from "../RoomManager";

function move(overrides: Partial<Move> = {}): Move {
  return {
    playerId: "player1",
    r1: 3,
    c1: 3,
    r2: 3,
    c2: 4,
    timestamp: 1000,
    ...overrides,
  };
}

describe("isValidMove", () => {
  it("accepts a valid horizontal swap", () => {
    expect(isValidMove(move({ r1: 2, c1: 2, r2: 2, c2: 3 }))).toBe(true);
  });

  it("accepts a valid vertical swap", () => {
    expect(isValidMove(move({ r1: 4, c1: 4, r2: 5, c2: 4 }))).toBe(true);
  });

  it("accepts moves on the board boundary (0 and 7)", () => {
    expect(isValidMove(move({ r1: 0, c1: 0, r2: 0, c2: 1 }))).toBe(true);
    expect(isValidMove(move({ r1: 7, c1: 6, r2: 7, c2: 7 }))).toBe(true);
  });

  it("rejects a diagonal swap", () => {
    expect(isValidMove(move({ r1: 2, c1: 2, r2: 3, c2: 3 }))).toBe(false);
  });

  it("rejects a non-adjacent swap (gap of 2)", () => {
    expect(isValidMove(move({ r1: 0, c1: 0, r2: 0, c2: 2 }))).toBe(false);
  });

  it("rejects a swap with the same tile (no movement)", () => {
    expect(isValidMove(move({ r1: 3, c1: 3, r2: 3, c2: 3 }))).toBe(false);
  });

  it("rejects out-of-bounds coordinates (negative)", () => {
    expect(isValidMove(move({ r1: -1, c1: 0, r2: 0, c2: 0 }))).toBe(false);
  });

  it("rejects out-of-bounds coordinates (> 7)", () => {
    expect(isValidMove(move({ r1: 8, c1: 0, r2: 7, c2: 0 }))).toBe(false);
  });

  it("rejects empty playerId", () => {
    expect(isValidMove(move({ playerId: "" }))).toBe(false);
    expect(isValidMove(move({ playerId: "   " }))).toBe(false);
  });

  it("rejects non-integer coordinates", () => {
    expect(isValidMove(move({ r1: 1.5, c1: 0, r2: 2, c2: 0 }))).toBe(false);
  });
});
