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
  findMatches,
  type AnimatedResolveStep,
} from "@match3/shared-js/engine/MatchEngine";
import {
  createDefaultStats,
  applyTileEffects,
  countTilesByType,
  tickStamina,
  isDead,
  type PlayerStats,
} from "@match3/shared-js/engine/PlayerStats";
import { isValidMove, validateProducesMatch } from "../validator";
import type {
  ResolvedStepWire,
  LoseReason,
  GeneratedTileWire,
} from "@match3/shared-js/protocol";

// ─── PlayerState (re-exported for SocketBridge / test imports) ───────────────

/** Wire-compatible alias for PlayerStats. Same shape — all fields shared. */
export type PlayerState = PlayerStats;

export function defaultPlayerState(): PlayerState {
  return createDefaultStats();
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
    serverReceivedAt: number;
    boardVersion: number;
    steps: ResolvedStepWire[];
    generatedTiles: GeneratedTileWire[];
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
    serverReceivedAt: number;
    playerStates: { [playerId: string]: PlayerState };
  };
  board_replaced: {
    roomId: string;
    reason: "no_legal_moves";
    boardVersion: number;
    board: number[];
    boardGrid: number[][];
    rngState: number;
    playerStates: { [playerId: string]: PlayerState };
  };
  match_ended: {
    roomId: string;
    loserId: string | null;
    /** Why the loser lost. "time" = stamina zero, "hp" = health zero. */
    loserReason: LoseReason | null;
    outcome: "P1_WIN" | "P2_WIN" | "DRAW";
    scores: { [playerId: string]: number };
    durationMs: number;
    playerStates: { [playerId: string]: PlayerState };
  };
}

export interface MatchSnapshot {
  boardGrid: number[][];
  boardVersion: number;
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
  boardVersion: number;
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

function generatedTilesFromSteps(steps: AnimatedResolveStep[]): GeneratedTileWire[] {
  const generated: GeneratedTileWire[] = [];
  for (const step of steps) {
    for (const pos of step.newTilePositions) {
      generated.push({
        row: pos.row,
        col: pos.col,
        tile: step.afterRefill[pos.row]![pos.col]!,
      });
    }
  }
  return generated;
}

function flattenGrid(grid: number[][]): number[] {
  return grid.flatMap((row) => row);
}

function hasLegalMove(grid: number[][]): boolean {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const candidates = [
        [r + 1, c],
        [r, c + 1],
      ] as const;
      for (const [r2, c2] of candidates) {
        if (r2 >= height || c2 >= width) continue;
        const board = { grid, width, height };
        const swapped = swapTiles(board, r, c, r2, c2);
        if (findMatches(swapped.grid).length > 0) return true;
      }
    }
  }
  return false;
}

function createPlayableReplacement(seed: number): { grid: number[][]; rngState: number } {
  for (let attempt = 0; attempt < 100; attempt++) {
    const nextSeed = (seed + attempt + 1) >>> 0;
    const grid = createBoard(nextSeed).grid;
    if (hasLegalMove(grid)) return { grid, rngState: nextSeed };
  }
  return { grid: createBoard((seed + 101) >>> 0).grid, rngState: (seed + 101) >>> 0 };
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
      boardVersion: 1,
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
   * Remap a reconnecting player's socket id without resetting authoritative
   * board/player state.
   */
  replacePlayerId(roomId: string, oldPlayerId: string, newPlayerId: string): void {
    if (oldPlayerId === newPlayerId) return;
    const state = this.rooms.get(roomId);
    if (!state) return;

    const index = state.playerIds.indexOf(oldPlayerId);
    if (index !== -1) {
      state.playerIds[index] = newPlayerId;
    }

    if (state.activePlayer === oldPlayerId) {
      state.activePlayer = newPlayerId;
    }

    if (Object.prototype.hasOwnProperty.call(state.scores, oldPlayerId)) {
      state.scores[newPlayerId] = state.scores[oldPlayerId] ?? 0;
      delete state.scores[oldPlayerId];
    }

    if (Object.prototype.hasOwnProperty.call(state.playerStates, oldPlayerId)) {
      state.playerStates[newPlayerId] = state.playerStates[oldPlayerId]!;
      delete state.playerStates[oldPlayerId];
    }
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
    c2: number,
    serverReceivedAt: number = Date.now()
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

    // Advance board state
    state.boardGrid = finalGrid;
    state.boardVersion += 1;
    state.rngState = rng.state();
    const pointsEarned = computePoints(steps);
    state.scores[playerId] = (state.scores[playerId] ?? 0) + pointsEarned;

    // ── Apply per-step tile effects ──────────────────────────────────────────
    // For each cascade step, sample the symbols that were matched BEFORE removal.
    // The pre-step grid for step 0 is the post-swap grid; for step N it is
    // steps[N-1].afterRefill. We use these grids to read the symbol at each
    // matched cell before the engine blanked them to -1.
    const opponentId = state.playerIds.find((p) => p !== playerId) ?? playerId;
    let selfStats = state.playerStates[playerId]!;
    let oppStats = state.playerStates[opponentId]!;
    let hpKillOpponentId: string | null = null;

    // Build a list of pre-step grids indexed by cascade step.
    const preStepGrids: number[][][] = [];
    let prevGrid = swapped.grid;
    for (const step of steps) {
      preStepGrids.push(prevGrid);
      prevGrid = step.afterRefill;
    }

    // Per-step stats AFTER each cascade's effects, for the wire payload so
    // clients can animate HUD bars in lockstep with each cascade flash.
    const perStepStates: Array<Record<string, PlayerState>> = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const preGrid = preStepGrids[i]!;
      // Flatten all matched cells from this step with their pre-removal symbols.
      const removedCells = step.matches.flatMap((m) =>
        m.cells.map(([row, col]) => ({ row, col, symbol: preGrid[row]![col] ?? -1 }))
      );
      // Filter out any -1 symbols (shouldn't happen on a valid board).
      const validCells = removedCells.filter((c) => c.symbol >= 0);
      const counts = countTilesByType(validCells);
      const result = applyTileEffects(selfStats, oppStats, counts);
      selfStats = result.self;
      oppStats = result.opponent;

      perStepStates.push({
        [playerId]: { ...selfStats },
        [opponentId]: { ...oppStats },
      });

      if (isDead(oppStats)) {
        hpKillOpponentId = opponentId;
        break;
      }
      if (isDead(selfStats)) {
        // Self can't die from their own move in current design, but guard anyway.
        hpKillOpponentId = playerId;
        break;
      }
    }

    // Persist updated stats back into the room.
    state.playerStates[playerId] = selfStats;
    state.playerStates[opponentId] = oppStats;

    const wireSteps: ResolvedStepWire[] = steps.map((step, i) => ({
      ...toWireStep(step),
      ...(perStepStates[i] && { playerStatesAfter: perStepStates[i] }),
    }));

    this.emit("move_resolved", {
      roomId,
      playerId,
      r1,
      c1,
      r2,
      c2,
      serverReceivedAt,
      boardVersion: state.boardVersion,
      steps: wireSteps,
      generatedTiles: generatedTilesFromSteps(steps),
      finalGrid,
      rngState: state.rngState,
      pointsEarned,
      scores: { ...state.scores },
      playerStates: this._copyPlayerStates(state),
    });

    // If HP hit zero, end the match before switching turns.
    if (hpKillOpponentId !== null) {
      this._endMatchByHp(roomId, hpKillOpponentId);
      return;
    }

    if (!hasLegalMove(state.boardGrid)) {
      const replacement = createPlayableReplacement(state.rngState);
      state.boardGrid = replacement.grid;
      state.rngState = replacement.rngState;
      state.boardVersion += 1;
      this.emit("board_replaced", {
        roomId,
        reason: "no_legal_moves",
        boardVersion: state.boardVersion,
        board: flattenGrid(state.boardGrid),
        boardGrid: state.boardGrid,
        rngState: state.rngState,
        playerStates: this._copyPlayerStates(state),
      });
    }

    // Switch active player
    const nextPlayer = state.playerIds.find((p) => p !== playerId) ?? playerId;
    state.activePlayer = nextPlayer;

    this.emit("turn_changed", {
      roomId,
      activePlayer: nextPlayer,
      serverReceivedAt,
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
      loserReason: "time",
      outcome,
      scores: { ...state.scores },
      durationMs,
      playerStates: this._copyPlayerStates(state),
    });

    this._clearTick(state);
    this.rooms.delete(roomId);
  }

  /**
   * Exposed for testing and future GM use: forcibly end a match because a
   * player's HP hit zero. Emits `match_ended` with `loserReason: "hp"`.
   * No-op if the room doesn't exist or is already ended.
   */
  endMatchByHpDeath(roomId: string, loserId: string): void {
    this._endMatchByHp(roomId, loserId);
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
      loserReason: "time",
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

  // ── HP-death end ───────────────────────────────────────────────────────────

  private _endMatchByHp(roomId: string, loserId: string): void {
    const state = this.rooms.get(roomId);
    if (!state) return;

    const durationMs = Date.now() - state.startedAt;
    const outcome = computeOutcome(state.playerIds, state.scores, loserId);

    this.emit("match_ended", {
      roomId,
      loserId,
      loserReason: "hp",
      outcome,
      scores: { ...state.scores },
      durationMs,
      playerStates: this._copyPlayerStates(state),
    });

    this._clearTick(state);
    this.rooms.delete(roomId);
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  private _onTick(roomId: string): void {
    const state = this.rooms.get(roomId);
    if (!state) return;

    const activeState = state.playerStates[state.activePlayer];
    if (!activeState) return;

    // Pure update — tickStamina returns a new object; reassign into the map.
    const updated = tickStamina(activeState, 1000);
    state.playerStates[state.activePlayer] = updated;

    if (updated.stamina <= 0) {
      const loserId = state.activePlayer;
      this.endMatchByTimeout(roomId, loserId);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _snapshot(state: MatchState): MatchSnapshot {
    return {
      boardGrid: state.boardGrid,
      boardVersion: state.boardVersion,
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
