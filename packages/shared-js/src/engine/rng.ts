/**
 * Core mulberry32 step: advances one integer state and returns the float [0,1)
 * and the new state. All RNG factories share this to guarantee identical output.
 */
function mulberry32Step(s: number): { next: number; value: number } {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { next: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/**
 * Seeded PRNG using the mulberry32 algorithm.
 * Returns floats in [0, 1).
 */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    const r = mulberry32Step(s);
    s = r.next;
    return r.value;
  };
}

/**
 * Stateful PRNG — same mulberry32 algorithm as createRng but exposes the
 * internal integer state so callers can snapshot and restore it.
 *
 * Used by the server-authoritative PvP path so each Room can persist its RNG
 * position and resume from a snapshot on rejoin.
 *
 * Existing createRng callers (game-view, BotPlayer) are unchanged.
 */
export function createStatefulRng(initialState: number): {
  next: () => number;
  state: () => number;
} {
  let s = initialState >>> 0;
  return {
    next(): number {
      const r = mulberry32Step(s);
      s = r.next;
      return r.value;
    },
    state(): number {
      return s >>> 0;
    },
  };
}

/**
 * Returns a random integer in [min, max] inclusive.
 */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
