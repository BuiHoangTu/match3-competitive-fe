import {
  boardFromGrid,
  createBoard,
  swapTiles,
  type Board,
} from "@match3/shared-js/engine/Board.js";
import {
  findMatches,
  resolveBoardAnimated,
  type AnimatedResolveStep,
} from "@match3/shared-js/engine/MatchEngine.js";
import { createStatefulRng } from "@match3/shared-js/engine/rng.js";
import {
  applyTileEffects,
  countTilesByType,
  createDefaultStats,
  type PlayerStats,
} from "@match3/shared-js/engine/PlayerStats.js";

export interface ResolvedStep {
  engineStep: AnimatedResolveStep;
  /** Maps "row,col" → new tile ID assigned during refill for this step. */
  refillIds: Map<string, number>;
  /**
   * Snapshot of the swap-maker's stats AFTER this cascade step's effects
   * (heal/exp/attack/...) have been applied. Lets the renderer push the bars
   * forward in lockstep with each cascade's flash, so a 3-heal first match
   * visibly heals before the cascade's exp/attack tiles flash.
   */
  selfStatsAfter: PlayerStats;
  /** Same, for the opposing side. */
  opponentStatsAfter: PlayerStats;
}

export type SwapResult =
  | { kind: "no_match" }
  | {
      kind: "resolved";
      steps: ResolvedStep[];
      pointsEarned: number;
      /**
       * Stats of the player who made the swap, AFTER all cascades resolved.
       * For "self" moves the caller mutates from `getSelfStats()` directly.
       */
      attackerStats: PlayerStats;
      /** Stats of the opposing side, after damage applied. */
      defenderStats: PlayerStats;
      /** Total damage dealt to the defender across all cascades. */
      damageDealt: number;
    };

/**
 * Wire-format snapshot of a GameLoopController, suitable for JSON.stringify
 * into localStorage. Used for solo-mode auto-resume across page reloads.
 *
 * `version` is bumped if the layout of this struct ever changes; callers are
 * expected to discard older snapshots and restart fresh on mismatch.
 */
export interface SoloSnapshot {
  /** v1 — board/rng/score only. v2 adds selfStats/opponentStats. */
  version: 2;
  board: number[][];
  rngState: number;
  score: number;
  nextTileId: number;
  selfStats: PlayerStats;
  opponentStats: PlayerStats;
}

let nextTileId = 0;

/**
 * Identifies which side made the swap, so applyTileEffects routes damage to
 * the correct opponent. "self" = local player; "opponent" = remote/bot
 * playing against the local player.
 */
export type SwapAttacker = "self" | "opponent";

export class GameLoopController {
  private _board: Board;
  private _rng: { next: () => number; state: () => number };
  private _tileIds: number[][];
  private _score = 0;
  private _selfStats: PlayerStats = createDefaultStats();
  private _opponentStats: PlayerStats = createDefaultStats();

  constructor(seed: number) {
    this._board = createBoard(seed);
    this._rng = createStatefulRng(seed + 1);
    this._tileIds = this._board.grid.map((row) => row.map(() => nextTileId++));
  }

  /**
   * Serialise the controller's mutable state into a plain JSON-safe object.
   *
   * Used by the solo-mode auto-resume path: GameScene calls this after every
   * settled cascade and persists the result under `match3:solo:${userId}`. On
   * page reload, the shell hands the snapshot back via the StartLocalMatch
   * bridge message and the caller restores via [deserialize].
   */
  serialize(): SoloSnapshot {
    return {
      version: 2,
      board: this._board.grid.map((row) => [...row]),
      rngState: this._rng.state(),
      score: this._score,
      nextTileId,
      selfStats: { ...this._selfStats },
      opponentStats: { ...this._opponentStats },
    };
  }

  /**
   * Restore a controller from a previously-saved snapshot. Returns null when
   * the snapshot's `version` is not understood by this build — callers should
   * treat that as "discard the save and start fresh".
   *
   * Tile IDs are minted fresh from the current `nextTileId` counter; the
   * snapshot's stored `nextTileId` is honoured by advancing the counter past
   * any IDs that were live at save time, so we never collide with IDs from a
   * previously-running session.
   */
  static deserialize(snapshot: SoloSnapshot): GameLoopController | null {
    if (!snapshot || snapshot.version !== 2) return null;
    if (!snapshot.selfStats || !snapshot.opponentStats) return null;

    // Construct an empty controller cheaply, then overwrite its internals.
    // Static methods can read private fields on instances of the same class.
    const ctrl = Object.create(GameLoopController.prototype) as GameLoopController;
    ctrl._board = boardFromGrid(snapshot.board);
    ctrl._rng = createStatefulRng(snapshot.rngState);
    ctrl._score = snapshot.score;
    ctrl._selfStats = { ...snapshot.selfStats };
    ctrl._opponentStats = { ...snapshot.opponentStats };

    // Mint a fresh tile-ID grid; sprite identity is reset on restore (the
    // renderer rebuilds its sprite map from these IDs).
    if (snapshot.nextTileId > nextTileId) {
      nextTileId = snapshot.nextTileId;
    }
    ctrl._tileIds = ctrl._board.grid.map((row) => row.map(() => nextTileId++));

    return ctrl;
  }

  get board(): Board {
    return this._board;
  }

  get score(): number {
    return this._score;
  }

  getTileId(row: number, col: number): number {
    return this._tileIds[row][col];
  }

  getSelfStats(): PlayerStats {
    return this._selfStats;
  }

  getOpponentStats(): PlayerStats {
    return this._opponentStats;
  }

  /**
   * Replace selfStats — used by external tickers (stamina) and by the
   * MultiplayerSync layer when authoritative server state arrives.
   */
  setSelfStats(stats: PlayerStats): void {
    this._selfStats = { ...stats };
  }

  setOpponentStats(stats: PlayerStats): void {
    this._opponentStats = { ...stats };
  }

  /**
   * Attempt a swap. When `attacker` is supplied, the resulting per-step
   * matches are bucketed and `applyTileEffects` is run so this controller's
   * internal `_selfStats` / `_opponentStats` reflect the post-cascade values.
   * For server-authoritative modes (turn_based) callers can pass undefined to
   * skip local stat math.
   */
  attemptSwap(
    r1: number,
    c1: number,
    r2: number,
    c2: number,
    attacker: SwapAttacker = "self"
  ): SwapResult {
    let swapped: Board;
    try {
      swapped = swapTiles(this._board, r1, c1, r2, c2);
    } catch {
      return { kind: "no_match" };
    }

    if (findMatches(swapped.grid).length === 0) return { kind: "no_match" };

    // Commit swap
    this._board = swapped;
    const tmp = this._tileIds[r1][c1];
    this._tileIds[r1][c1] = this._tileIds[r2][c2];
    this._tileIds[r2][c2] = tmp;

    const { grid: finalGrid, steps: engineSteps } = resolveBoardAnimated(
      this._board.grid,
      () => this._rng.next()
    );

    let pointsEarned = 0;
    const resolvedSteps: ResolvedStep[] = [];

    // Track the grid that each step's matches were sampled from. For step 0
    // this is the post-swap grid (this._board.grid). For step i>0 it is the
    // previous step's afterRefill, since resolveBoardAnimated feeds each
    // iteration from the prior cascade's refilled grid.
    let preRemovalGrid: number[][] = this._board.grid;
    let totalDamage = 0;

    for (let i = 0; i < engineSteps.length; i++) {
      const step = engineSteps[i];
      const cascadeMultiplier = i + 1;

      for (const match of step.matches) {
        pointsEarned += match.cells.length * 10 * cascadeMultiplier;
      }

      // Per-step removed-cell symbols: sample from the pre-removal grid at
      // the matched coordinates BEFORE removeMatches blanks them. This is
      // what countTilesByType expects (raw {row,col,symbol} list).
      const removedCells: Array<{ row: number; col: number; symbol: number }> = [];
      for (const match of step.matches) {
        for (const [r, c] of match.cells) {
          removedCells.push({
            row: r,
            col: c,
            symbol: preRemovalGrid[r][c],
          });
        }
      }
      const counts = countTilesByType(removedCells);

      // Route damage according to who swapped: attacker.atk damages defender.
      if (attacker === "self") {
        const r = applyTileEffects(this._selfStats, this._opponentStats, counts);
        this._selfStats = r.self;
        this._opponentStats = r.opponent;
        totalDamage += r.damageDealt;
      } else {
        const r = applyTileEffects(this._opponentStats, this._selfStats, counts);
        this._opponentStats = r.self;
        this._selfStats = r.opponent;
        totalDamage += r.damageDealt;
      }

      // 1. Clear matched IDs
      for (const match of step.matches) {
        for (const [r, c] of match.cells) {
          this._tileIds[r][c] = -1;
        }
      }

      // 2. Apply gravity movements (order-independent via snapshot)
      const snapshot = this._tileIds.map((row) => [...row]);
      const updated = snapshot.map((row) => [...row]);
      for (const { col, fromRow } of step.movements) {
        updated[fromRow][col] = -1;
      }
      for (const { col, fromRow, toRow } of step.movements) {
        updated[toRow][col] = snapshot[fromRow][col];
      }
      this._tileIds = updated;

      // 3. Assign new IDs to refill positions
      const refillIds = new Map<string, number>();
      for (const pos of step.newTilePositions) {
        const id = nextTileId++;
        this._tileIds[pos.row][pos.col] = id;
        refillIds.set(`${pos.row},${pos.col}`, id);
      }

      resolvedSteps.push({
        engineStep: step,
        refillIds,
        selfStatsAfter: { ...this._selfStats },
        opponentStatsAfter: { ...this._opponentStats },
      });

      // Next cascade samples from this step's afterRefill.
      preRemovalGrid = step.afterRefill;
    }

    this._board = { ...this._board, grid: finalGrid };
    this._score += pointsEarned;

    return {
      kind: "resolved",
      steps: resolvedSteps,
      pointsEarned,
      attackerStats: attacker === "self" ? this._selfStats : this._opponentStats,
      defenderStats: attacker === "self" ? this._opponentStats : this._selfStats,
      damageDealt: totalDamage,
    };
  }
}
