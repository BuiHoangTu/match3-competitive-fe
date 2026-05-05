/**
 * MatchEngineService — the "judge" for turn_based rooms.
 *
 * Pure-ish service: no socket I/O, no console.log, no module-level setTimeout.
 * Owns all in-memory state for turn_based rooms and exposes typed events that
 * SocketBridge subscribes to and rebroadcasts over Socket.IO.
 *
 * Bot rooms always use gameMode "pve" (see MatchmakingService.createBotMatch);
 * the judge only handles human-vs-human turn_based rooms.
 *
 * Room board state (boardGrid, rngState, originalSeed, scores) is co-located
 * here in the service's private MatchState map rather than on the Room object.
 * The Room object in RoomManager continues to carry its own copy so that
 * handler code that reads from room.boardGrid / room.scores still works —
 * the service keeps them in sync after every move.
 */

import { TypedEmitter } from "../lib/TypedEmitter";
import { createBoard, swapTiles } from "@match3/shared-js/engine/Board";
import { createStatefulRng } from "@match3/shared-js/engine/rng";
import {
  resolveBoardAnimated,
  type AnimatedResolveStep,
} from "@match3/shared-js/engine/MatchEngine";
import { isValidMove, validateProducesMatch } from "../validator";
import { PLAYER_TIME_MS } from "../constants";
import type { ResolvedStepWire } from "@match3/shared-js/protocol";

// ─── PlayerState ─────────────────────────────────────────────────────────────

export interface PlayerState {
  /** Stamina = remaining turn time in ms. Ticks down while player is active. */
  stamina: number;
  /** Health placeholder — seeded at 100, not mutated by the judge. */
  health: number;
  /** Mana placeholder — seeded at 100, not mutated by the judge. */
  mana: number;
}

export function defaultPlayerState(): PlayerState {
  return {
    stamina: PLAYER_TIME_MS, // 5 * 60 * 1000
    health: 100,
    mana: 100,
  };
}

// ─── Event map ───────────────────────────────────────────────────────────────

export interface MatchEngineEvents extends Record<string, unknown> {
  match_started: {
    roomId: string;
    playerIds: [string, string];
    gameMode: string;
    snapshot: MatchSnapshot;
  };
  move_resolved: {
    roomId: string;
    playerId: string;
    r1: number;
    c1: number;
    r2: number;
    c2: number;
    steps: ResolvedStepWire[];
    finalGrid: number[][];
    rngState: number;
    pointsEarned: number;
    scores: { [playerId: string]: number };
    playerStates: { [playerId: string]: PlayerState };
  };
  move_rejected: {
    roomId: string;
    playerId: string;
    reason: "no_match" | "not_your_turn" | "out_of_bounds" | "non_adjacent";
  };
  turn_changed: {
    roomId: string;
    activePlayer: string;
    playerStates: { [playerId: string]: PlayerState };
  };
  match_ended: {
    roomId: string;
    loserId: string | null;
    outcome: "P1_WIN" | "P2_WIN" | "DRAW";
    scores: { [playerId: string]: number };
    durationMs: number;
    playerStates: { [playerId: string]: PlayerState };
  };
}

export interface MatchSnapshot {
  boardGrid: number[][];
  rngState: number;
  originalSeed: number;
  scores: { [playerId: string]: number };
  activePlayer: string | null;
  playerStates: { [playerId: string]: PlayerState };
}

// ─── Internal room state ─────────────────────────────────────────────────────

interface MatchState {
  playerIds: [string, string];
  gameMode: string;
  boardGrid: number[][];
  rngState: number;
  originalSeed: number;
  scores: { [playerId: string]: number };
  activePlayer: string;
  playerStates: { [playerId: string]: PlayerState };
  /** Wall-clock ms when startMatch was called. */
  startedAt: number;
  /** setInterval handle for the stamina tick. Cleared on cleanup. */
  tickInterval: ReturnType<typeof setInterval>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toWireStep(step: AnimatedResolveStep): ResolvedStepWire {
  return {
    matchedCells: step.matches.flatMap((m) => m.cells),
    movements: step.movements,
    newTilePositions: step.newTilePositions,
    afterGravity: step.afterGravity,
    afterRefill: step.afterRefill,
  };
}

function computePoints(steps: AnimatedResolveStep[]): number {
  let total = 0;
  for (let i = 0; i < steps.length; i++) {
    const cascadeLevel = i + 1;
    const cellCount = steps[i].matches.reduce((acc, m) => acc + m.cells.length, 0);
    total += cellCount * 10 * cascadeLevel;
  }
  return total;
}

function computeOutcome(
  playerIds: [string, string],
  scores: { [pid: string]: number },
  loserId: string | null
): "P1_WIN" | "P2_WIN" | "DRAW" {
  if (loserId) {
    return loserId === playerIds[0] ? "P2_WIN" : "P1_WIN";
  }
  const s0 = scores[playerIds[0]] ?? 0;
  const s1 = scores[playerIds[1]] ?? 0;
  if (s0 > s1) return "P1_WIN";
  if (s1 > s0) return "P2_WIN";
  return "DRAW";
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class MatchEngineService extends TypedEmitter<MatchEngineEvents> {
  private rooms = new Map<string, MatchState>();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialize state for a turn_based room and emit `match_started`.
   * playerIds[0] is slot 0 (first to play), playerIds[1] is slot 1.
   */
  startMatch(
    roomId: string,
    playerIds: [string, string],
    originalSeed: number,
    gameMode: string
  ): void {
    // Idempotent: no-op if already started (prevents double-init on reconnect).
    if (this.rooms.has(roomId)) return;

    const boardGrid = createBoard(originalSeed).grid;
    const scores: { [pid: string]: number } = {
      [playerIds[0]]: 0,
      [playerIds[1]]: 0,
    };
    const playerStates: { [pid: string]: PlayerState } = {
      [playerIds[0]]: defaultPlayerState(),
      [playerIds[1]]: defaultPlayerState(),
    };
    const activePlayer = playerIds[0];

    const tickInterval = setInterval(() => {
      this._onTick(roomId);
    }, 1000);

    const state: MatchState = {
      playerIds,
      gameMode,
      boardGrid,
      rngState: originalSeed,
      originalSeed,
      scores,
      activePlayer,
      playerStates,
      startedAt: Date.now(),
      tickInterval,
    };
    this.rooms.set(roomId, state);

    const snapshot = this._snapshot(state);
    this.emit("match_started", { roomId, playerIds, gameMode, snapshot });
  }

  /**
   * Validate and apply a move. Emits `move_resolved` + `turn_changed` on
   * success, or `move_rejected` on any validation failure.
   */
  submitMove(
    roomId: string,
    playerId: string,
    r1: number,
    c1: number,
    r2: number,
    c2: number
  ): void {
    const state = this.rooms.get(roomId);
    if (!state) return;

    // Turn-order check
    if (state.activePlayer !== playerId) {
      this.emit("move_rejected", { roomId, playerId, reason: "not_your_turn" });
      return;
    }

    // Bounds + adjacency check (reuse isValidMove by constructing a minimal move)
    const pseudoMove = { playerId, r1, c1, r2, c2, timestamp: 0 };
    if (!isValidMove(pseudoMove)) {
      const inBounds = (v: number) => Number.isInteger(v) && v >= 0 && v <= 7;
      const reason =
        !inBounds(r1) || !inBounds(c1) || !inBounds(r2) || !inBounds(c2)
          ? "out_of_bounds"
          : "non_adjacent";
      this.emit("move_rejected", { roomId, playerId, reason });
      return;
    }

    // Engine-level: must produce a match
    if (!validateProducesMatch(state.boardGrid, r1, c1, r2, c2)) {
      this.emit("move_rejected", { roomId, playerId, reason: "no_match" });
      return;
    }

    // Apply the move
    const boardObj = {
      grid: state.boardGrid,
      width: state.boardGrid[0]!.length,
      height: state.boardGrid.length,
    };
    const swapped = swapTiles(boardObj, r1, c1, r2, c2);
    const rng = createStatefulRng(state.rngState);
    const { grid: finalGrid, steps } = resolveBoardAnimated(swapped.grid, rng.next);

    // Advance state
    state.boardGrid = finalGrid;
    state.rngState = rng.state();
    const pointsEarned = computePoints(steps);
    state.scores[playerId] = (state.scores[playerId] ?? 0) + pointsEarned;

    const wireSteps: ResolvedStepWire[] = steps.map(toWireStep);

    this.emit("move_resolved", {
      roomId,
      playerId,
      r1,
      c1,
      r2,
      c2,
      steps: wireSteps,
      finalGrid,
      rngState: state.rngState,
      pointsEarned,
      scores: { ...state.scores },
      playerStates: this._copyPlayerStates(state),
    });

    // Switch active player
    const nextPlayer = state.playerIds.find((p) => p !== playerId) ?? playerId;
    state.activePlayer = nextPlayer;

    this.emit("turn_changed", {
      roomId,
      activePlayer: nextPlayer,
      playerStates: this._copyPlayerStates(state),
    });
  }

  /**
   * Forfeit — the named player loses. Emits `match_ended` and clears state.
   */
  forfeit(roomId: string, playerId: string): void {
    const state = this.rooms.get(roomId);
    if (!state) return;

    const durationMs = Date.now() - state.startedAt;
    const outcome = computeOutcome(state.playerIds, state.scores, playerId);

    this.emit("match_ended", {
      roomId,
      loserId: playerId,
      outcome,
      scores: { ...state.scores },
      durationMs,
      playerStates: this._copyPlayerStates(state),
    });

    this._clearTick(state);
    this.rooms.delete(roomId);
  }

  /**
   * Return the current snapshot for rejoin.
   * Returns null if the room is not managed by this service.
   */
  getSnapshot(roomId: string): MatchSnapshot | null {
    const state = this.rooms.get(roomId);
    if (!state) return null;
    return this._snapshot(state);
  }

  /**
   * Called when the active player's stamina hits zero.
   * Emits `match_ended` and clears state.
   */
  endMatchByTimeout(roomId: string, loserId: string): void {
    const state = this.rooms.get(roomId);
    if (!state) return;

    const durationMs = Date.now() - state.startedAt;
    const outcome = computeOutcome(state.playerIds, state.scores, loserId);

    this.emit("match_ended", {
      roomId,
      loserId,
      outcome,
      scores: { ...state.scores },
      durationMs,
      playerStates: this._copyPlayerStates(state),
    });

    this._clearTick(state);
    this.rooms.delete(roomId);
  }

  /**
   * Remove in-memory state for a room (called after all side-effects are
   * done). Idempotent.
   */
  cleanup(roomId: string): void {
    const state = this.rooms.get(roomId);
    if (state) {
      this._clearTick(state);
      this.rooms.delete(roomId);
    }
  }

  /**
   * Returns true if this service currently manages the given room.
   * Used by SocketBridge to route move/forfeit events.
   */
  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  private _onTick(roomId: string): void {
    const state = this.rooms.get(roomId);
    if (!state) return;

    const activeState = state.playerStates[state.activePlayer];
    if (!activeState) return;

    activeState.stamina -= 1000;

    if (activeState.stamina <= 0) {
      activeState.stamina = 0;
      const loserId = state.activePlayer;
      this.endMatchByTimeout(roomId, loserId);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _snapshot(state: MatchState): MatchSnapshot {
    return {
      boardGrid: state.boardGrid,
      rngState: state.rngState,
      originalSeed: state.originalSeed,
      scores: { ...state.scores },
      activePlayer: state.activePlayer,
      playerStates: this._copyPlayerStates(state),
    };
  }

  private _copyPlayerStates(state: MatchState): { [pid: string]: PlayerState } {
    const copy: { [pid: string]: PlayerState } = {};
    for (const [pid, ps] of Object.entries(state.playerStates)) {
      copy[pid] = { ...ps };
    }
    return copy;
  }

  private _clearTick(state: MatchState): void {
    clearInterval(state.tickInterval);
  }
}
