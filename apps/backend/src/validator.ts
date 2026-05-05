import type { Move, Room } from "./RoomManager";
import { findMatches } from "@match3/shared-js/engine/MatchEngine";

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

/**
 * Engine-level validation for the server-authoritative PvP path.
 *
 * Applies the swap immutably to the provided grid and checks whether at least
 * one match would result. Returns true iff the swap produces a match.
 *
 * Pure function — no I/O, no state mutation.
 */
export function validateProducesMatch(
  grid: number[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number
): boolean {
  // Deep-copy the grid, swap, then run match detection.
  const candidate = grid.map((row) => [...row]);
  const tmp = candidate[r1][c1];
  candidate[r1][c1] = candidate[r2][c2];
  candidate[r2][c2] = tmp;
  return findMatches(candidate).length > 0;
}

/**
 * T-v0.6-D04 · Validator userId slot check
 *
 * Confirms the given userId owns a slot in the room. Returns the slot index
 * (0 or 1) on success, or a string reason code on failure.
 *
 * The check is deliberately separate from isValidMove so each concern has a
 * clear rejection reason.
 */
export function checkUserIdOwnsSlot(
  userId: string,
  room: Room
): { ok: true; slot: 0 | 1 } | { ok: false; reason: string } {
  const slot = room.userIds.indexOf(userId) as 0 | 1 | -1;
  if (slot === -1) {
    return { ok: false, reason: "user_not_in_room" };
  }
  return { ok: true, slot };
}
