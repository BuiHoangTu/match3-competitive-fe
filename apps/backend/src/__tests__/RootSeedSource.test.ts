import { describe, it, expect } from "vitest";
import { RootSeedSource } from "../lib/RootSeedSource";

describe("RootSeedSource", () => {
  it("seeded with a fixed initial state produces a deterministic sequence", () => {
    const a = new RootSeedSource(0xdeadbeef);
    const b = new RootSeedSource(0xdeadbeef);
    const seqA = Array.from({ length: 8 }, () => a.nextSeed());
    const seqB = Array.from({ length: 8 }, () => b.nextSeed());
    expect(seqA).toEqual(seqB);
  });

  it("two crypto-initialised sources yield different sequences (overwhelmingly)", () => {
    const a = new RootSeedSource();
    const b = new RootSeedSource();
    const seqA = Array.from({ length: 8 }, () => a.nextSeed());
    const seqB = Array.from({ length: 8 }, () => b.nextSeed());
    expect(seqA).not.toEqual(seqB);
  });

  it("nextSeed() returns 31-bit non-negative integers", () => {
    const r = new RootSeedSource(1);
    for (let i = 0; i < 1000; i++) {
      const s = r.nextSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 31);
    }
  });

  it("currentState() rotates after every nextSeed() call", () => {
    const r = new RootSeedSource(42);
    const states = new Set<number>();
    states.add(r.currentState());
    for (let i = 0; i < 16; i++) {
      r.nextSeed();
      states.add(r.currentState());
    }
    // 17 distinct states across 16 rotations (no immediate cycle from seed 42).
    expect(states.size).toBe(17);
  });
});
