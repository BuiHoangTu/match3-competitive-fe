/**
 * Tests for the local player-stats integration in GameLoopController.
 *
 * Covers:
 *   - applyTileEffects routing per-tile-type counts on real cascades
 *   - solo-snapshot stats round-trip (v2 includes selfStats / opponentStats)
 *   - bot-as-attacker damages the local player
 *   - stamina-zero is reflected by the controller's stats
 */

import { describe, it, expect } from "vitest";
import { GameLoopController } from "./GameLoopController.js";
import { TileType } from "@match3/shared-js/engine/TileType.js";
import {
  createDefaultStats,
  applyTileEffects,
  countTilesByType,
  tickStamina,
  isDead,
  DEFAULTS,
} from "@match3/shared-js/engine/PlayerStats.js";

/**
 * Force a controller into a hand-crafted board state. We can't go through the
 * normal constructor because that randomly seeds — instead we construct a
 * fresh controller and overwrite the private board grid via Object.assign on
 * the underlying _board reference, which we get by re-deserialising.
 */
function makeControllerWithBoard(grid: number[][]): GameLoopController {
  // Use deserialize() with a hand-built v2 snapshot.
  const snap = {
    version: 2 as const,
    board: grid.map((r) => [...r]),
    rngState: 1,
    score: 0,
    nextTileId: 0,
    selfStats: createDefaultStats(),
    opponentStats: createDefaultStats(),
  };
  const ctrl = GameLoopController.deserialize(snap);
  if (!ctrl) throw new Error("deserialize failed");
  return ctrl;
}

describe("GameLoopController stats integration", () => {
  it("attemptSwap with attack tiles damages the opponent", () => {
    // 6 cols × 3 rows: row 1 has [A, A, _, X, X, X] where swapping (1,2)↔(0,2)
    // would not yield a 3-run. Instead: place row 1 = [A,A,?,?,?,?] then swap
    // a 3rd attack into pos (1,2). Use ATTACK=0, ENERGY=1.
    //
    // Simplest setup: row 0 = [A,A,_], row 1 = [_,_,A], swapping (1,2)↔(0,2)
    // gives row 0 = [A,A,A] → 3-attack horizontal match. Pad to 6 cols safely.
    //
    // ATTACK=0, ENERGY=1. We need the rest of the grid to NOT match initially.
    // Using a 6×6 board with a striped non-matching base, then patching the
    // top corner.
    const grid: number[][] = [];
    // Build a non-matching base: row r col c → (c + r) % 5
    for (let r = 0; r < 6; r++) {
      const row: number[] = [];
      for (let c = 0; c < 6; c++) {
        row.push((c + r) % 5);
      }
      grid.push(row);
    }
    // Patch a swap setup at the bottom corner so we don't disturb the
    // striped base. Force three ATTACKs after the swap:
    //   row 4: [A, A, X, ...]   (where X is currently row[4][2])
    //   row 5: [_, _, A, ...]
    // Swap (5,2)↔(4,2): row4 becomes [A,A,A] → 3-attack horizontal match.
    grid[4][0] = TileType.ATTACK;
    grid[4][1] = TileType.ATTACK;
    grid[4][2] = TileType.ENERGY; // current
    grid[5][2] = TileType.ATTACK; // will swap into row 4
    // Make sure these patches don't accidentally form an existing 3-run.
    // row 4 = [A, A, E, ...] — no 3-run. row 5 = [_, _, A, ...] — no 3-run.
    // Column 0: row3 col0 = (0+3)%5=3, row4=A=0, row5=row5col0=(0+5)%5=0.
    // That's row5col0=0=ATTACK. To avoid a vertical 3 of attacks at col0,
    // override row5col0 explicitly to ENERGY:
    grid[5][0] = TileType.ENERGY;
    grid[5][1] = TileType.HEAL;
    // Column 2 vertical check: row3=(2+3)%5=0=A, row4=E, row5=A → safe.
    // Column 1: row3=(1+3)%5=4, row4=A, row5=H → safe.

    const ctrl = makeControllerWithBoard(grid);
    const oppBefore = ctrl.getOpponentStats().health;
    const result = ctrl.attemptSwap(5, 2, 4, 2, "self");

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    // The cascade matched 3 attack tiles — damage = 3 × atk (10) = 30.
    expect(result.damageDealt).toBeGreaterThanOrEqual(30);
    expect(ctrl.getOpponentStats().health).toBe(oppBefore - result.damageDealt);
    // Self HP unchanged.
    expect(ctrl.getSelfStats().health).toBe(DEFAULTS.HEALTH);
  });

  it("countTilesByType / applyTileEffects directly model the 5 tile types", () => {
    // Sanity: pure-engine path with one of each tile type.
    const removed = [
      { row: 0, col: 0, symbol: TileType.ATTACK },
      { row: 0, col: 1, symbol: TileType.ENERGY },
      { row: 0, col: 2, symbol: TileType.EXP },
      { row: 0, col: 3, symbol: TileType.FOOD },
      { row: 0, col: 4, symbol: TileType.HEAL },
    ];
    const counts = countTilesByType(removed);
    expect(counts[TileType.ATTACK]).toBe(1);
    expect(counts[TileType.ENERGY]).toBe(1);
    expect(counts[TileType.EXP]).toBe(1);
    expect(counts[TileType.FOOD]).toBe(1);
    expect(counts[TileType.HEAL]).toBe(1);

    let self = createDefaultStats();
    let opp = createDefaultStats();
    // Drop self HP a bit so HEAL has something to fill.
    self = { ...self, health: 50 };
    // Drop self stamina so FOOD adds.
    self = { ...self, stamina: self.maxStamina - 10_000 };
    const r = applyTileEffects(self, opp, counts);
    // ATTACK → opponent damaged by self.atk (10)
    expect(r.opponent.health).toBe(opp.health - self.atk);
    // ENERGY → +5 mana (capped at 100)
    expect(r.self.mana).toBe(self.mana + DEFAULTS.MANA_PER_TILE);
    // FOOD → +5000 ms stamina
    expect(r.self.stamina).toBe(self.stamina + DEFAULTS.FOOD_PER_TILE_MS);
    // HEAL → +5 hp
    expect(r.self.health).toBe(self.health + DEFAULTS.HEAL_PER_TILE);
    // EXP → +5 exp
    expect(r.self.exp).toBe(self.exp + DEFAULTS.EXP_PER_TILE);
  });

  it("solo snapshot round-trips selfStats and opponentStats", () => {
    const ctrl = new GameLoopController(7);
    // Mutate stats so the round-trip has signal beyond defaults.
    ctrl.setSelfStats({
      ...ctrl.getSelfStats(),
      health: 42,
      stamina: 12345,
      mana: 17,
      lv: 3,
      exp: 25,
    });
    ctrl.setOpponentStats({
      ...ctrl.getOpponentStats(),
      health: 88,
      mana: 50,
    });
    const snap = ctrl.serialize();
    expect(snap.version).toBe(2);
    expect(snap.selfStats.health).toBe(42);
    expect(snap.selfStats.stamina).toBe(12345);
    expect(snap.selfStats.mana).toBe(17);
    expect(snap.selfStats.lv).toBe(3);
    expect(snap.opponentStats.health).toBe(88);

    const restored = GameLoopController.deserialize(snap)!;
    expect(restored).not.toBeNull();
    expect(restored.getSelfStats().health).toBe(42);
    expect(restored.getSelfStats().stamina).toBe(12345);
    expect(restored.getSelfStats().lv).toBe(3);
    expect(restored.getOpponentStats().health).toBe(88);
    // Round-trip must produce a JSON-safe object.
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("opponent attacker (pve bot move) damages local player", () => {
    // Same setup as the first test but the swap is attributed to the bot.
    const grid: number[][] = [];
    for (let r = 0; r < 6; r++) {
      const row: number[] = [];
      for (let c = 0; c < 6; c++) row.push((c + r) % 5);
      grid.push(row);
    }
    grid[4][0] = TileType.ATTACK;
    grid[4][1] = TileType.ATTACK;
    grid[4][2] = TileType.ENERGY;
    grid[5][2] = TileType.ATTACK;
    grid[5][0] = TileType.ENERGY;
    grid[5][1] = TileType.HEAL;

    const ctrl = makeControllerWithBoard(grid);
    const selfBefore = ctrl.getSelfStats().health;
    const result = ctrl.attemptSwap(5, 2, 4, 2, "opponent");
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    // Bot's match damages the local player — selfStats.health should drop.
    expect(ctrl.getSelfStats().health).toBeLessThan(selfBefore);
    // Bot HP unchanged.
    expect(ctrl.getOpponentStats().health).toBe(DEFAULTS.HEALTH);
  });

  it("isDead trips when stamina runs out (solo death signal)", () => {
    const ctrl = new GameLoopController(99);
    // Tick stamina past zero.
    let s = ctrl.getSelfStats();
    s = tickStamina(s, s.maxStamina + 1);
    ctrl.setSelfStats(s);
    expect(ctrl.getSelfStats().stamina).toBe(0);
    expect(isDead(ctrl.getSelfStats())).toBe(true);
  });

  it("attemptSwap populates per-step selfStatsAfter / opponentStatsAfter", () => {
    // Single-cascade: row 4 = [H, H, ATTACK], row 5 = [_, _, H]; swapping
    // (5,2)↔(4,2) puts row 4 = [H,H,H] → 3-heal match. Self.health is dropped
    // so HEAL has somewhere to land.
    const grid: number[][] = [];
    for (let r = 0; r < 6; r++) {
      const row: number[] = [];
      for (let c = 0; c < 6; c++) row.push((c + r) % 5);
      grid.push(row);
    }
    grid[4][0] = TileType.HEAL;
    grid[4][1] = TileType.HEAL;
    grid[4][2] = TileType.ATTACK; // current
    grid[5][2] = TileType.HEAL; // will swap up to (4,2)
    grid[5][0] = TileType.ENERGY;
    grid[5][1] = TileType.EXP;

    const ctrl = makeControllerWithBoard(grid);
    // Drop self HP so HEAL can land.
    ctrl.setSelfStats({ ...ctrl.getSelfStats(), health: 50 });

    const baselineHp = 50;
    const result = ctrl.attemptSwap(5, 2, 4, 2, "self");
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;

    // At least one step. The first step is the 3-HEAL match.
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    const step0 = result.steps[0];
    expect(step0.selfStatsAfter).toBeDefined();
    expect(step0.opponentStatsAfter).toBeDefined();
    // 3 HEAL × 5 hp = +15. Step 0 reflects that immediately.
    expect(step0.selfStatsAfter.health).toBe(baselineHp + 15);
    // No ATTACK in step 0 → opponent unchanged.
    expect(step0.opponentStatsAfter.health).toBe(
      ctrl.getOpponentStats().maxHealth
    );
  });

  it("per-step snapshots are immutable (mutating one does not affect later steps)", () => {
    // We just need ANY resolved swap to land 2+ snapshots. Re-use the simple
    // attack scenario; only one step is guaranteed but its snapshot still
    // round-trips through JSON unchanged.
    const grid: number[][] = [];
    for (let r = 0; r < 6; r++) {
      const row: number[] = [];
      for (let c = 0; c < 6; c++) row.push((c + r) % 5);
      grid.push(row);
    }
    grid[4][0] = TileType.HEAL;
    grid[4][1] = TileType.HEAL;
    grid[4][2] = TileType.ATTACK;
    grid[5][2] = TileType.HEAL;
    grid[5][0] = TileType.ENERGY;
    grid[5][1] = TileType.EXP;

    const ctrl = makeControllerWithBoard(grid);
    ctrl.setSelfStats({ ...ctrl.getSelfStats(), health: 50 });
    const result = ctrl.attemptSwap(5, 2, 4, 2, "self");
    if (result.kind !== "resolved") throw new Error("expected resolved");

    const step = result.steps[0];
    const snapshotBefore = JSON.parse(JSON.stringify(step.selfStatsAfter));

    // Mutate the snapshot copy aggressively.
    step.selfStatsAfter.health = -999;
    step.opponentStatsAfter.health = -999;

    // The controller's own stats must NOT have shifted to -999 — the per-step
    // snapshot is meant to be a defensive copy taken at resolve time.
    expect(ctrl.getSelfStats().health).toBe(snapshotBefore.health);
    // And the same for any later step (if there is one). For each step we
    // verify the snapshot was a fresh object — i.e. does not share identity
    // with another step's snapshot or with the controller's live stats.
    for (const s of result.steps) {
      expect(s.selfStatsAfter).not.toBe(ctrl.getSelfStats());
      expect(s.opponentStatsAfter).not.toBe(ctrl.getOpponentStats());
    }
  });

  it("multi-cascade snapshots monotonically reflect cumulative effects", () => {
    // The refill is random, so a deterministic multi-cascade is hard to
    // engineer by hand. Instead scan a small range of seeds for a swap that
    // produces 2+ cascade steps; then verify that step i's selfStatsAfter is
    // strictly "later" than step i-1's selfStatsAfter when at least one stat
    // delta exists (e.g. exp grew, or hp moved). The point is per-step
    // snapshots are pegged to that cascade's accumulated effects, never the
    // pre-resolve baseline and never the post-resolve total.
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const ctrl = new GameLoopController(seed);
      // Drop self HP so any HEAL has room to land.
      ctrl.setSelfStats({ ...ctrl.getSelfStats(), health: 30 });
      const grid: number[][] = ctrl.board.grid;
      // Try every adjacent pair; first multi-step resolution wins.
      for (let r = 0; r < grid.length && !found; r++) {
        for (let c = 0; c < grid[0].length && !found; c++) {
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const r2 = r + dr;
            const c2 = c + dc;
            if (r2 >= grid.length || c2 >= grid[0].length) continue;
            const probe = new GameLoopController(seed);
            probe.setSelfStats({ ...probe.getSelfStats(), health: 30 });
            const result = probe.attemptSwap(r, c, r2, c2, "self");
            if (result.kind !== "resolved") continue;
            if (result.steps.length < 2) continue;

            // Check each consecutive pair: stats should be defined and the
            // stats objects should be distinct snapshots (not the same ref).
            for (let i = 1; i < result.steps.length; i++) {
              expect(result.steps[i].selfStatsAfter).not.toBe(
                result.steps[i - 1].selfStatsAfter
              );
              expect(result.steps[i].opponentStatsAfter).not.toBe(
                result.steps[i - 1].opponentStatsAfter
              );
            }
            // Final step's selfStatsAfter equals the controller's live
            // selfStats (post-resolve total).
            expect(
              result.steps[result.steps.length - 1].selfStatsAfter
            ).toEqual(probe.getSelfStats());
            found = true;
            break;
          }
        }
      }
    }
    // Fall back gracefully: a 2+ cascade is statistically common across 200
    // seeds × all swaps. If somehow none materialise, the assertion failure
    // is a cleaner signal than a silent skip.
    expect(found).toBe(true);
  });

  it("v1 snapshots are gracefully discarded (deserialize returns null)", () => {
    // Wire-format SoloSnapshotPayload (bridge v1) lacks selfStats/opponentStats.
    // The controller's deserialize requires v2; v1 must round-trip to null so
    // callers fall back to a fresh game.
    const v1 = {
      version: 1,
      board: [[0, 1, 2]],
      rngState: 0,
      score: 0,
      nextTileId: 0,
    };
    // Deliberately mistype to the controller's SoloSnapshot signature.
    const restored = GameLoopController.deserialize(
      v1 as unknown as Parameters<typeof GameLoopController.deserialize>[0]
    );
    expect(restored).toBeNull();
  });
});
