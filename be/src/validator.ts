import type { Move } from "./RoomManager";

const BOARD_MIN = 0;
const BOARD_MAX = 7;

function inBounds(v: number): boolean {
  return Number.isInteger(v) && v >= BOARD_MIN && v <= BOARD_MAX;
}

export function isValidMove(move: Move): boolean {
  if (!move.playerId || move.playerId.trim() === "") return false;

  const { r1, c1, r2, c2 } = move;
  if (!inBounds(r1) || !inBounds(c1) || !inBounds(r2) || !inBounds(c2)) {
    return false;
  }

  const dr = Math.abs(r2 - r1);
  const dc = Math.abs(c2 - c1);

  // Exactly adjacent: one axis differs by 1, the other by 0
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}
