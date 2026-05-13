/**
 * Unit tests for MatchEngineService (the judge).
 *
 * No Socket.IO — pure service-level event assertions.
 *
 * Covers:
 * - startMatch emits match_started with correct snapshot
 * - submitMove valid move → move_resolved + turn_changed
 * - submitMove no-match swap → move_rejected { no_match }
 * - submitMove out-of-turn → move_rejected { not_your_turn }
 * - submitMove out-of-bounds → move_rejected { out_of_bounds }
 * - forfeit → match_ended { loserId }
 * - stamina ticks down and fires match_ended when zero
 * - getSnapshot returns correct shape including health/mana defaults
 * - cleanup removes state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MatchEngineService, defaultPlayerState, type PlayerState } from "../services/MatchEngineService";
import { findMatches } from "@match3/shared-js/engine/MatchEngine";
import { DEFAULTS, createDefaultStats, countTilesByType, applyTileEffects } from "@match3/shared-js/engine/PlayerStats";
import { TileType } from "@match3/shared-js/engine/TileType";

// Re-export for type narrowing in assertions
type MatchEndedPayload = {
  roomId: string;
  loserId: string | null;
  loserReason: string | null;
  outcome: string;
  scores: Record<string, number>;
  durationMs: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROOM_ID = "test-room";
const P1 = "player-1";
const P2 = "player-2";
const SEED = 42;

/** Find the first adjacent swap that produces a match. */
function findMatchingSwap(grid: number[][]): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r][c + 1]] = [cand[r][c + 1], cand[r][c]];
        if (findMatches(cand).length > 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r + 1][c]] = [cand[r + 1][c], cand[r][c]];
        if (findMatches(cand).length > 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

/** Find the first adjacent swap that produces NO match. */
function findNonMatchingSwap(grid: number[][]): { r1: number; c1: number; r2: number; c2: number } | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (c + 1 < w) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r][c + 1]] = [cand[r][c + 1], cand[r][c]];
        if (findMatches(cand).length === 0) return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < h) {
        const cand = grid.map((row) => [...row]);
        [cand[r][c], cand[r + 1][c]] = [cand[r + 1][c], cand[r][c]];
        if (findMatches(cand).length === 0) return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MatchEngineService", () => {
  let service: MatchEngineService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new MatchEngineService();
  });

  afterEach(() => {
    service.cleanup(ROOM_ID);
    vi.useRealTimers();
  });

  // ── startMatch ─────────────────────────────────────────────────────────────

  it("startMatch emits match_started with correct snapshot shape", () => {
    const payloads: unknown[] = [];
    service.on("match_started", (p) => payloads.push(p));

    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as ReturnType<typeof service.getSnapshot> & { roomId: string; playerIds: string[]; gameMode: string };
    expect((payload as { roomId: string }).roomId).toBe(ROOM_ID);
    expect((payload as { gameMode: string }).gameMode).toBe("turn_based");
  });

  it("startMatch is idempotent — calling twice does not double-emit", () => {
    const payloads: unknown[] = [];
    service.on("match_started", (p) => payloads.push(p));

    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    expect(payloads).toHaveLength(1);
  });

  // ── getSnapshot ────────────────────────────────────────────────────────────

  it("getSnapshot returns null before startMatch", () => {
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
  });

  it("getSnapshot returns correct defaults with full PlayerStats shape", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;

    expect(snap).not.toBeNull();
    expect(snap.activePlayer).toBe(P1);
    // Full PlayerStats shape from createDefaultStats()
    const expectedPs: PlayerState = {
      health: DEFAULTS.HEALTH,
      maxHealth: DEFAULTS.HEALTH,
      stamina: DEFAULTS.STAMINA_MS,
      maxStamina: DEFAULTS.STAMINA_MS,
      mana: DEFAULTS.STARTING_MANA,
      maxMana: DEFAULTS.MANA,
      lv: 1,
      exp: 0,
      expToNext: DEFAULTS.EXP_TO_NEXT_BASE,
      atk: DEFAULTS.ATK,
    };
    expect(snap.playerStates[P1]).toEqual(expectedPs);
    expect(snap.playerStates[P2]).toEqual(expectedPs);
    expect(snap.originalSeed).toBe(SEED);
    expect(snap.boardVersion).toBe(1);
    expect(Array.isArray(snap.boardGrid)).toBe(true);
    expect(snap.boardGrid.length).toBe(8);
    expect(snap.scores[P1]).toBe(0);
    expect(snap.scores[P2]).toBe(0);
  });

  it("replacePlayerId preserves turn and player state for reconnect", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const before = service.getSnapshot(ROOM_ID)!;
    const reconnected = "player-1-reconnected";

    service.replacePlayerId(ROOM_ID, P1, reconnected);

    const after = service.getSnapshot(ROOM_ID)!;
    expect(after.activePlayer).toBe(reconnected);
    expect(after.playerStates[reconnected]).toEqual(before.playerStates[P1]);
    expect(after.playerStates[P1]).toBeUndefined();
    expect(after.scores[reconnected]).toBe(before.scores[P1]);
    expect(after.scores[P1]).toBeUndefined();

    const swap = findMatchingSwap(after.boardGrid);
    if (!swap) throw new Error("No matching swap on initial board");
    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));
    service.submitMove(
      ROOM_ID,
      reconnected,
      swap.r1,
      swap.c1,
      swap.r2,
      swap.c2
    );
    expect(rejected).toHaveLength(0);
  });

  // ── submitMove — valid ──────────────────────────────────────────────────────

  it("valid move emits move_resolved with correct fields", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(snap.boardGrid);
    if (!swap) throw new Error("No matching swap on initial board");

    const resolved: unknown[] = [];
    const changed: unknown[] = [];
    service.on("move_resolved", (p) => resolved.push(p));
    service.on("turn_changed", (p) => changed.push(p));

    service.submitMove(ROOM_ID, P1, swap.r1, swap.c1, swap.r2, swap.c2);

    expect(resolved).toHaveLength(1);
    const r = resolved[0] as {
      playerId: string;
      roomId: string;
      boardVersion: number;
      steps: Array<{ newTilePositions: Array<{ row: number; col: number }> }>;
      generatedTiles: number[];
      finalGrid: number[][];
      rngState: number;
      pointsEarned: number;
      scores: Record<string, number>;
      playerStates: Record<string, PlayerState>;
      boardHash: string;
    };
    expect(r.roomId).toBe(ROOM_ID);
    expect(r.playerId).toBe(P1);
    expect(r.boardVersion).toBe(2);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.generatedTiles.length).toBeGreaterThan(0);
    expect(r.generatedTiles.every(Number.isInteger)).toBe(true);
    expect(r.generatedTiles).toHaveLength(
      r.steps.flatMap((step) => step.newTilePositions).length
    );
    expect(r.boardHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.pointsEarned).toBeGreaterThan(0);
    expect(r.scores[P1]).toBe(r.pointsEarned);
    expect(r.finalGrid.length).toBe(8);
    expect(r.playerStates[P1]).toBeDefined();
    // health starts at DEFAULTS.HEALTH (100). ATTACK tiles reduce it; HEAL tiles
    // restore it. On seed 42's first move we just check it's in valid range.
    expect(r.playerStates[P1]!.health).toBeGreaterThan(0);
    expect(r.playerStates[P1]!.health).toBeLessThanOrEqual(DEFAULTS.HEALTH);
    // mana starts at DEFAULTS.STARTING_MANA (0) and grows via ENERGY tiles.
    expect(r.playerStates[P1]!.mana).toBeGreaterThanOrEqual(0);
    expect(r.playerStates[P1]!.mana).toBeLessThanOrEqual(DEFAULTS.MANA);

    expect(changed).toHaveLength(1);
    const c = changed[0] as { activePlayer: string; playerStates: Record<string, PlayerState> };
    expect(c.activePlayer).toBe(P2);
  });

  it("valid move advances rngState and boardGrid", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const before = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(before.boardGrid);
    if (!swap) throw new Error("No matching swap");

    service.submitMove(ROOM_ID, P1, swap.r1, swap.c1, swap.r2, swap.c2);
    const after = service.getSnapshot(ROOM_ID)!;

    expect(after.rngState).not.toBe(before.rngState);
    expect(after.boardVersion).toBeGreaterThan(before.boardVersion);
    expect(JSON.stringify(after.boardGrid)).not.toBe(JSON.stringify(before.boardGrid));
  });

  // ── submitMove — rejected ──────────────────────────────────────────────────

  it("no-match swap emits move_rejected { no_match }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const badSwap = findNonMatchingSwap(snap.boardGrid);
    if (!badSwap) {
      console.warn("All swaps produce matches — test vacuous");
      return;
    }

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    service.submitMove(ROOM_ID, P1, badSwap.r1, badSwap.c1, badSwap.r2, badSwap.c2);

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("no_match");
  });

  it("out-of-turn move emits move_rejected { not_your_turn }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(snap.boardGrid);
    if (!swap) throw new Error("No matching swap");

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    // P2 tries to move but it's P1's turn
    service.submitMove(ROOM_ID, P2, swap.r1, swap.c1, swap.r2, swap.c2);

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("not_your_turn");
  });

  it("out-of-bounds move emits move_rejected { out_of_bounds }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    service.submitMove(ROOM_ID, P1, 9, 0, 9, 1); // row 9 is out of bounds

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("out_of_bounds");
  });

  it("non-adjacent move emits move_rejected { non_adjacent }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const rejected: unknown[] = [];
    service.on("move_rejected", (p) => rejected.push(p));

    service.submitMove(ROOM_ID, P1, 0, 0, 0, 3); // 3 apart, not adjacent

    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe("non_adjacent");
  });

  // ── forfeit ────────────────────────────────────────────────────────────────

  it("forfeit emits match_ended with correct loserId and outcome", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    service.forfeit(ROOM_ID, P1);

    expect(ended).toHaveLength(1);
    const e = ended[0] as { roomId: string; loserId: string; outcome: string; scores: Record<string, number>; durationMs: number };
    expect(e.roomId).toBe(ROOM_ID);
    expect(e.loserId).toBe(P1);
    expect(e.outcome).toBe("P2_WIN");
    expect(typeof e.durationMs).toBe("number");
  });

  it("forfeit clears room state", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.forfeit(ROOM_ID, P1);
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
    expect(service.hasRoom(ROOM_ID)).toBe(false);
  });

  // ── stamina tick ───────────────────────────────────────────────────────────

  it("stamina decrements by 1000 ms per second", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const before = service.getSnapshot(ROOM_ID)!.playerStates[P1]!.stamina;

    vi.advanceTimersByTime(3000);

    const after = service.getSnapshot(ROOM_ID)!.playerStates[P1]!.stamina;
    expect(after).toBe(before - 3000);
  });

  it("stamina reaching zero fires match_ended { loserId = activePlayer }", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    // Advance past the full 5-minute stamina
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    expect(ended).toHaveLength(1);
    const e = ended[0] as { loserId: string; outcome: string };
    expect(e.loserId).toBe(P1); // P1 is active at match start
    expect(e.outcome).toBe("P2_WIN");
  });

  it("stamina only ticks for the active player", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    vi.advanceTimersByTime(5000);
    const snap = service.getSnapshot(ROOM_ID)!;
    // P2 stamina should be unchanged (P1 is active)
    expect(snap.playerStates[P2]!.stamina).toBe(5 * 60 * 1000);
    expect(snap.playerStates[P1]!.stamina).toBe(5 * 60 * 1000 - 5000);
  });

  // ── cleanup ────────────────────────────────────────────────────────────────

  it("cleanup removes state and is idempotent", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.cleanup(ROOM_ID);
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
    service.cleanup(ROOM_ID); // should not throw
  });

  // ── defaultPlayerState ────────────────────────────────────────────────────

  it("defaultPlayerState returns full PlayerStats from createDefaultStats()", () => {
    const ps = defaultPlayerState();
    expect(ps.health).toBe(DEFAULTS.HEALTH);
    expect(ps.maxHealth).toBe(DEFAULTS.HEALTH);
    expect(ps.mana).toBe(DEFAULTS.STARTING_MANA);
    expect(ps.maxMana).toBe(DEFAULTS.MANA);
    expect(ps.stamina).toBe(DEFAULTS.STAMINA_MS);
    expect(ps.maxStamina).toBe(DEFAULTS.STAMINA_MS);
    expect(ps.lv).toBe(1);
    expect(ps.exp).toBe(0);
    expect(ps.expToNext).toBe(DEFAULTS.EXP_TO_NEXT_BASE);
    expect(ps.atk).toBe(DEFAULTS.ATK);
  });

  // ── stamina tick uses tickStamina ─────────────────────────────────────────

  it("stamina tick emits match_ended with loserReason='time' on timeout", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    vi.advanceTimersByTime(DEFAULTS.STAMINA_MS + 1000);

    expect(ended).toHaveLength(1);
    const e = ended[0] as { loserId: string; loserReason: string; outcome: string };
    expect(e.loserId).toBe(P1);
    expect(e.loserReason).toBe("time");
    expect(e.outcome).toBe("P2_WIN");
  });

  // ── tile effect unit tests (pure functions) ───────────────────────────────

  it("applyTileEffects: ATTACK tiles reduce opponent HP by count*atk", () => {
    const self = createDefaultStats();
    const opp = createDefaultStats();
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: TileType.ATTACK },
      { row: 0, col: 1, symbol: TileType.ATTACK },
      { row: 0, col: 2, symbol: TileType.ATTACK },
    ]);
    const { opponent, damageDealt } = applyTileEffects(self, opp, counts);
    expect(damageDealt).toBe(3 * DEFAULTS.ATK);
    expect(opponent.health).toBe(DEFAULTS.HEALTH - 3 * DEFAULTS.ATK);
  });

  it("applyTileEffects: HEAL tiles restore self HP, capped at maxHealth", () => {
    // Start at half HP
    const self = { ...createDefaultStats(), health: 50 };
    const opp = createDefaultStats();
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: TileType.HEAL },
      { row: 0, col: 1, symbol: TileType.HEAL },
    ]);
    const { self: nextSelf } = applyTileEffects(self, opp, counts);
    expect(nextSelf.health).toBe(Math.min(50 + 2 * DEFAULTS.HEAL_PER_TILE, DEFAULTS.HEALTH));
  });

  it("applyTileEffects: HEAL tiles do not exceed maxHealth", () => {
    const self = createDefaultStats(); // full HP
    const opp = createDefaultStats();
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: TileType.HEAL },
    ]);
    const { self: nextSelf } = applyTileEffects(self, opp, counts);
    expect(nextSelf.health).toBe(DEFAULTS.HEALTH); // already capped
  });

  it("applyTileEffects: ENERGY tiles increase self mana, capped at maxMana", () => {
    const self = createDefaultStats(); // mana starts at 0
    const opp = createDefaultStats();
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: TileType.ENERGY },
      { row: 0, col: 1, symbol: TileType.ENERGY },
    ]);
    const { self: nextSelf } = applyTileEffects(self, opp, counts);
    expect(nextSelf.mana).toBe(Math.min(2 * DEFAULTS.MANA_PER_TILE, DEFAULTS.MANA));
  });

  it("applyTileEffects: FOOD tiles restore self stamina, capped at maxStamina", () => {
    const self = { ...createDefaultStats(), stamina: DEFAULTS.STAMINA_MS - 30_000 };
    const opp = createDefaultStats();
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: TileType.FOOD },
    ]);
    const { self: nextSelf } = applyTileEffects(self, opp, counts);
    expect(nextSelf.stamina).toBe(
      Math.min(DEFAULTS.STAMINA_MS - 30_000 + DEFAULTS.FOOD_PER_TILE_MS, DEFAULTS.STAMINA_MS)
    );
  });

  it("applyTileEffects: EXP tiles add exp and trigger level-up when threshold met", () => {
    // Give self enough exp to level up: expToNext = EXP_TO_NEXT_BASE = 100
    // Each EXP tile gives EXP_PER_TILE = 5. Need 20 tiles to level.
    const self = createDefaultStats();
    const cells = Array.from({ length: 20 }, (_, i) => ({
      row: 0,
      col: i,
      symbol: TileType.EXP as number,
    }));
    const counts = countTilesByType(cells);
    const { self: nextSelf, leveledUp } = applyTileEffects(self, createDefaultStats(), counts);
    expect(leveledUp).toBe(true);
    expect(nextSelf.lv).toBe(2);
    expect(nextSelf.atk).toBe(DEFAULTS.ATK + DEFAULTS.LV_ATK_GAIN);
    expect(nextSelf.maxHealth).toBe(DEFAULTS.HEALTH + DEFAULTS.LV_HP_GAIN);
    // HP and mana should be refilled on level-up
    expect(nextSelf.health).toBe(nextSelf.maxHealth);
    expect(nextSelf.mana).toBe(nextSelf.maxMana);
  });

  // ── HP-zero ends match with loserReason='hp' ──────────────────────────────

  it("endMatchByHpDeath emits match_ended with loserReason='hp'", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    service.endMatchByHpDeath(ROOM_ID, P2);

    expect(ended).toHaveLength(1);
    const e = ended[0] as MatchEndedPayload;
    expect(e.loserId).toBe(P2);
    expect(e.loserReason).toBe("hp");
    expect(e.outcome).toBe("P1_WIN");
  });

  it("endMatchByHpDeath clears room state", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    service.endMatchByHpDeath(ROOM_ID, P1);
    expect(service.getSnapshot(ROOM_ID)).toBeNull();
    expect(service.hasRoom(ROOM_ID)).toBe(false);
  });

  it("endMatchByTimeout emits loserReason='time'", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");

    const ended: unknown[] = [];
    service.on("match_ended", (p) => ended.push(p));

    service.endMatchByTimeout(ROOM_ID, P2);

    expect(ended).toHaveLength(1);
    const e = ended[0] as { loserId: string; loserReason: string; outcome: string };
    expect(e.loserId).toBe(P2);
    expect(e.loserReason).toBe("time");
    expect(e.outcome).toBe("P1_WIN");
  });

  // ── playerStates updated on move (tile effects applied) ───────────────────

  it("after a valid move, playerStates reflect potential stat changes", () => {
    service.startMatch(ROOM_ID, [P1, P2], SEED, "turn_based");
    const snap = service.getSnapshot(ROOM_ID)!;
    const swap = findMatchingSwap(snap.boardGrid);
    if (!swap) throw new Error("No matching swap on initial board");

    const resolved: unknown[] = [];
    service.on("move_resolved", (p) => resolved.push(p));

    service.submitMove(ROOM_ID, P1, swap.r1, swap.c1, swap.r2, swap.c2);

    const r = resolved[0] as { playerStates: Record<string, PlayerState> };
    // Verify all fields of full PlayerStats shape are present
    for (const [, ps] of Object.entries(r.playerStates)) {
      expect(typeof ps.health).toBe("number");
      expect(typeof ps.maxHealth).toBe("number");
      expect(typeof ps.mana).toBe("number");
      expect(typeof ps.maxMana).toBe("number");
      expect(typeof ps.stamina).toBe("number");
      expect(typeof ps.maxStamina).toBe("number");
      expect(typeof ps.lv).toBe("number");
      expect(typeof ps.exp).toBe("number");
      expect(typeof ps.expToNext).toBe("number");
      expect(typeof ps.atk).toBe("number");
      // Bounds
      expect(ps.health).toBeGreaterThan(0);
      expect(ps.health).toBeLessThanOrEqual(ps.maxHealth);
      expect(ps.mana).toBeGreaterThanOrEqual(0);
      expect(ps.mana).toBeLessThanOrEqual(ps.maxMana);
    }
  });
});
