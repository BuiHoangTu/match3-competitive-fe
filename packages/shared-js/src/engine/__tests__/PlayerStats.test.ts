import { describe, it, expect } from "vitest";
import {
  DEFAULTS,
  applyTileEffects,
  countTilesByType,
  createDefaultStats,
  isDead,
  levelUpIfReady,
  tickStamina,
  type PlayerStats,
} from "../PlayerStats.js";
import { ALL_TILE_TYPES, TileType, type TileTypeValue } from "../TileType.js";

function bucket(partial: Partial<Record<TileTypeValue, number>>): Record<TileTypeValue, number> {
  const out = {} as Record<TileTypeValue, number>;
  for (const t of ALL_TILE_TYPES) out[t] = partial[t] ?? 0;
  return out;
}

describe("createDefaultStats", () => {
  it("returns the documented defaults", () => {
    const s = createDefaultStats();
    expect(s.health).toBe(100);
    expect(s.maxHealth).toBe(100);
    expect(s.stamina).toBe(300_000);
    expect(s.maxStamina).toBe(300_000);
    expect(s.mana).toBe(0);
    expect(s.maxMana).toBe(100);
    expect(s.lv).toBe(1);
    expect(s.exp).toBe(0);
    expect(s.expToNext).toBe(100);
    expect(s.atk).toBe(10);
  });

  it("returns a fresh object each call", () => {
    const a = createDefaultStats();
    const b = createDefaultStats();
    expect(a).not.toBe(b);
    a.health = 1;
    expect(b.health).toBe(100);
  });
});

describe("DEFAULTS sanity", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});

describe("countTilesByType", () => {
  it("buckets removed cells by symbol", () => {
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: TileType.ATTACK },
      { row: 0, col: 1, symbol: TileType.ATTACK },
      { row: 0, col: 2, symbol: TileType.HEAL },
      { row: 1, col: 0, symbol: TileType.EXP },
    ]);
    expect(counts[TileType.ATTACK]).toBe(2);
    expect(counts[TileType.HEAL]).toBe(1);
    expect(counts[TileType.EXP]).toBe(1);
    expect(counts[TileType.ENERGY]).toBe(0);
    expect(counts[TileType.FOOD]).toBe(0);
  });

  it("returns all-zero bucket for empty input", () => {
    const counts = countTilesByType([]);
    for (const t of ALL_TILE_TYPES) expect(counts[t]).toBe(0);
  });

  it("ignores out-of-range symbols", () => {
    const counts = countTilesByType([
      { row: 0, col: 0, symbol: 99 },
      { row: 0, col: 1, symbol: TileType.HEAL },
    ]);
    expect(counts[TileType.HEAL]).toBe(1);
    let total = 0;
    for (const t of ALL_TILE_TYPES) total += counts[t];
    expect(total).toBe(1);
  });
});

describe("applyTileEffects — ATTACK", () => {
  it("damage = count × atk; opponent.health clamped at 0", () => {
    const self = createDefaultStats(); // atk=10
    const opp = createDefaultStats();  // health=100
    const r = applyTileEffects(self, opp, bucket({ [TileType.ATTACK]: 3 }));
    expect(r.damageDealt).toBe(30);
    expect(r.opponent.health).toBe(70);
    expect(r.self.health).toBe(100); // self unchanged
  });

  it("clamps opponent.health at 0 (no negative)", () => {
    const self = createDefaultStats();
    const opp: PlayerStats = { ...createDefaultStats(), health: 5 };
    const r = applyTileEffects(self, opp, bucket({ [TileType.ATTACK]: 3 }));
    expect(r.damageDealt).toBe(30);
    expect(r.opponent.health).toBe(0);
  });

  it("zero attack tiles → zero damage, opponent unchanged", () => {
    const self = createDefaultStats();
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({}));
    expect(r.damageDealt).toBe(0);
    expect(r.opponent.health).toBe(100);
  });
});

describe("applyTileEffects — HEAL", () => {
  it("heals self, capped at maxHealth", () => {
    const self: PlayerStats = { ...createDefaultStats(), health: 80 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.HEAL]: 2 }));
    expect(r.self.health).toBe(80 + 2 * DEFAULTS.HEAL_PER_TILE);
  });

  it("does not exceed maxHealth", () => {
    const self: PlayerStats = { ...createDefaultStats(), health: 98 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.HEAL]: 10 }));
    expect(r.self.health).toBe(self.maxHealth); // 100
  });
});

describe("applyTileEffects — ENERGY", () => {
  it("adds mana, capped at maxMana", () => {
    const self: PlayerStats = { ...createDefaultStats(), mana: 90 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.ENERGY]: 1 }));
    expect(r.self.mana).toBe(95);
  });

  it("does not exceed maxMana", () => {
    const self: PlayerStats = { ...createDefaultStats(), mana: 90 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.ENERGY]: 10 }));
    expect(r.self.mana).toBe(self.maxMana); // 100
  });
});

describe("applyTileEffects — FOOD", () => {
  it("restores stamina, capped at maxStamina", () => {
    const self: PlayerStats = { ...createDefaultStats(), stamina: 200_000 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.FOOD]: 4 }));
    expect(r.self.stamina).toBe(200_000 + 4 * DEFAULTS.FOOD_PER_TILE_MS);
  });

  it("does not exceed maxStamina", () => {
    const self: PlayerStats = { ...createDefaultStats(), stamina: 295_000 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.FOOD]: 10 }));
    expect(r.self.stamina).toBe(self.maxStamina); // 300_000
  });
});

describe("applyTileEffects — EXP / level-up", () => {
  it("gains exp, no level-up under threshold", () => {
    const self = createDefaultStats(); // exp=0, expToNext=100
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.EXP]: 3 }));
    expect(r.self.exp).toBe(15);
    expect(r.self.lv).toBe(1);
    expect(r.leveledUp).toBe(false);
  });

  it("levels up when exp ≥ expToNext", () => {
    const self: PlayerStats = { ...createDefaultStats(), exp: 95 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.EXP]: 1 }));
    // 95 + 5 = 100 ≥ 100 → level up to 2
    expect(r.leveledUp).toBe(true);
    expect(r.self.lv).toBe(2);
    expect(r.self.exp).toBe(0);
    expect(r.self.expToNext).toBe(200); // 100 * lv
    expect(r.self.atk).toBe(DEFAULTS.ATK + DEFAULTS.LV_ATK_GAIN); // 12
    expect(r.self.maxHealth).toBe(110);
    expect(r.self.health).toBe(110); // refilled
    expect(r.self.mana).toBe(self.maxMana); // refilled
  });

  it("chains multiple level-ups when a single grant crosses thresholds", () => {
    // Start at lv=1, exp=99. Grant huge exp.
    // lv1 → lv2 needs 100 exp; lv2 → lv3 needs 200; lv3 → lv4 needs 300.
    // Provide enough EXP tiles to cross multiple thresholds.
    // 99 + 60 * 5 = 99 + 300 = 399 exp.
    // Loop: 399 - 100 = 299 (lv2), 299 - 200 = 99 (lv3) — stop at lv3, exp=99.
    const self: PlayerStats = { ...createDefaultStats(), exp: 99 };
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.EXP]: 60 }));
    expect(r.leveledUp).toBe(true);
    expect(r.self.lv).toBe(3);
    expect(r.self.exp).toBe(99);
    expect(r.self.expToNext).toBe(300); // 100 * 3
    // atk grew twice: 10 + 2*2 = 14
    expect(r.self.atk).toBe(DEFAULTS.ATK + 2 * DEFAULTS.LV_ATK_GAIN);
    // maxHealth grew twice: 100 + 2*10 = 120; refilled
    expect(r.self.maxHealth).toBe(120);
    expect(r.self.health).toBe(120);
  });
});

describe("levelUpIfReady (direct)", () => {
  it("noop when exp below threshold", () => {
    const s = createDefaultStats();
    const r = levelUpIfReady(s);
    expect(r.leveledUp).toBe(false);
    expect(r.stats).toEqual(s);
    expect(r.stats).not.toBe(s); // immutable copy
  });

  it("expToNext follows 100 * lv after level-up", () => {
    const s: PlayerStats = { ...createDefaultStats(), exp: 100 };
    const r = levelUpIfReady(s);
    expect(r.leveledUp).toBe(true);
    expect(r.stats.lv).toBe(2);
    expect(r.stats.expToNext).toBe(200);
  });
});

describe("isDead", () => {
  it("true when health <= 0", () => {
    const s: PlayerStats = { ...createDefaultStats(), health: 0 };
    expect(isDead(s)).toBe(true);
  });

  it("true when stamina <= 0", () => {
    const s: PlayerStats = { ...createDefaultStats(), stamina: 0 };
    expect(isDead(s)).toBe(true);
  });

  it("true when health is negative", () => {
    const s: PlayerStats = { ...createDefaultStats(), health: -5 };
    expect(isDead(s)).toBe(true);
  });

  it("false when both positive", () => {
    const s = createDefaultStats();
    expect(isDead(s)).toBe(false);
  });
});

describe("tickStamina", () => {
  it("decrements stamina by deltaMs", () => {
    const s = createDefaultStats();
    const r = tickStamina(s, 1000);
    expect(r.stamina).toBe(s.stamina - 1000);
  });

  it("clamps at 0 (no negative)", () => {
    const s: PlayerStats = { ...createDefaultStats(), stamina: 500 };
    const r = tickStamina(s, 10_000);
    expect(r.stamina).toBe(0);
  });

  it("does not mutate input", () => {
    const s = createDefaultStats();
    const before = s.stamina;
    tickStamina(s, 1000);
    expect(s.stamina).toBe(before);
  });
});

describe("immutability", () => {
  it("applyTileEffects does not mutate self or opponent", () => {
    const self = createDefaultStats();
    const opp = createDefaultStats();
    const selfSnapshot = { ...self };
    const oppSnapshot = { ...opp };
    applyTileEffects(self, opp, bucket({
      [TileType.ATTACK]: 2,
      [TileType.HEAL]: 1,
      [TileType.ENERGY]: 1,
      [TileType.FOOD]: 1,
      [TileType.EXP]: 30, // triggers level up
    }));
    expect(self).toEqual(selfSnapshot);
    expect(opp).toEqual(oppSnapshot);
  });

  it("returns new object refs", () => {
    const self = createDefaultStats();
    const opp = createDefaultStats();
    const r = applyTileEffects(self, opp, bucket({ [TileType.ATTACK]: 1 }));
    expect(r.self).not.toBe(self);
    expect(r.opponent).not.toBe(opp);
  });
});
