import { describe, it, expect } from "vitest";
import { createRng, randInt } from "./rng.js";

describe("createRng", () => {
  it("same seed produces the same sequence", () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("different seeds produce different sequences", () => {
    const rng1 = createRng(1);
    const rng2 = createRng(2);
    const vals1 = Array.from({ length: 10 }, () => rng1());
    const vals2 = Array.from({ length: 10 }, () => rng2());
    expect(vals1).not.toEqual(vals2);
  });

  it("values are in [0, 1)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("randInt", () => {
  it("returns integers within [min, max] inclusive", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const v = randInt(rng, 0, 4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4);
    }
  });

  it("can return both min and max values", () => {
    const rng = createRng(13);
    const values = new Set<number>();
    for (let i = 0; i < 500; i++) {
      values.add(randInt(rng, 0, 4));
    }
    expect(values.has(0)).toBe(true);
    expect(values.has(4)).toBe(true);
  });
});
