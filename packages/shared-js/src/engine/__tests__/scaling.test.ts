import { describe, it, expect } from "vitest";
import { scaledStats, xpToNext, levelFromXp } from "../scaling.js";

const CAT_BASE = {
  baseMaxHealth: 100,
  baseMaxMana: 100,
  baseMaxStamina: 300_000,
  baseAtk: 10,
};

describe("scaledStats (CR-6)", () => {
  it("level 0 returns base values unchanged", () => {
    const s = scaledStats(CAT_BASE, 0);
    expect(s.maxHealth).toBe(100);
    expect(s.maxMana).toBe(100);
    expect(s.maxStamina).toBe(300_000);
    expect(s.atk).toBe(10);
  });

  it("level 5 → +50% on health and atk", () => {
    const s = scaledStats(CAT_BASE, 5);
    expect(s.maxHealth).toBeCloseTo(150);
    expect(s.atk).toBeCloseTo(15);
  });

  it("mana and stamina pass through unchanged at any level", () => {
    const s = scaledStats(CAT_BASE, 7);
    expect(s.maxMana).toBe(100);
    expect(s.maxStamina).toBe(300_000);
  });

  it("does not mutate the input", () => {
    const base = { ...CAT_BASE };
    scaledStats(base, 3);
    expect(base).toEqual(CAT_BASE);
  });

  it("returns a fresh object each call", () => {
    const a = scaledStats(CAT_BASE, 2);
    const b = scaledStats(CAT_BASE, 2);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("xpToNext (CR-7)", () => {
  it("level 0 needs 100 xp to reach level 1", () => {
    expect(xpToNext(0)).toBe(100);
  });

  it("level 1 needs 200 xp to reach level 2", () => {
    expect(xpToNext(1)).toBe(200);
  });

  it("level 5 needs 600 xp to reach level 6", () => {
    expect(xpToNext(5)).toBe(600);
  });
});

describe("levelFromXp (CR-7)", () => {
  it("0 xp → level 0", () => {
    expect(levelFromXp(0)).toBe(0);
  });

  it("99 xp → level 0", () => {
    expect(levelFromXp(99)).toBe(0);
  });

  it("100 xp → level 1 (exactly at threshold)", () => {
    expect(levelFromXp(100)).toBe(1);
  });

  it("299 xp → level 1 (one below the next threshold)", () => {
    expect(levelFromXp(299)).toBe(1);
  });

  it("300 xp → level 2 (cumulative 100+200)", () => {
    expect(levelFromXp(300)).toBe(2);
  });

  it("599 xp → level 2", () => {
    expect(levelFromXp(599)).toBe(2);
  });

  it("600 xp → level 3 (cumulative 100+200+300)", () => {
    expect(levelFromXp(600)).toBe(3);
  });

  it("1000 xp → level 4 (cumul 1000=100+200+300+400)", () => {
    expect(levelFromXp(1000)).toBe(4);
  });

  it("inverse round-trip: levelFromXp(cumul(N)) === N for N up to 50", () => {
    for (let n = 0; n <= 50; n++) {
      const cumul = 50 * n * (n + 1);
      expect(levelFromXp(cumul)).toBe(n);
      if (cumul > 0) expect(levelFromXp(cumul - 1)).toBe(n - 1);
    }
  });
});
