/**
 * RootSeedSource — single rotating seed generator for the server process.
 *
 * Replaces ad-hoc Math.random() calls in RoomManager. The initial state is
 * drawn from `crypto.randomBytes(4)` at construction (native CSPRNG entropy).
 * Each call to nextSeed() returns a 31-bit integer AND advances the internal
 * state via mulberry32 — i.e. the root self-rotates, never repeating until
 * the full 2^32 cycle is exhausted.
 *
 * This gives:
 *   - cryptographically-seeded match seeds (no Math.random predictability)
 *   - per-process sequence determinism (same initial state → same seeds);
 *     useful for replay/debug if the initial state is captured
 *   - automatic rotation on every consumption, no manual bookkeeping
 *
 * One singleton lives on ServerContext for the lifetime of the process.
 */

import { randomBytes } from "crypto";
import { createStatefulRng } from "@match3/shared-js/engine/rng";

export class RootSeedSource {
  private rng: { next: () => number; state: () => number };
  private readonly initialState: number;

  constructor(initialState?: number) {
    if (initialState !== undefined) {
      this.initialState = initialState >>> 0;
    } else {
      // 4 bytes of CSPRNG entropy → uint32 initial state.
      this.initialState = randomBytes(4).readUInt32BE(0);
    }
    this.rng = createStatefulRng(this.initialState);

    // Ops repro: log the initial state only when explicitly requested.
    // Logging unconditionally would leak entropy into stdout.
    if (process.env.DEBUG?.includes("match3:seed")) {
      console.log(
        `[RootSeedSource] initialState=0x${this.initialState.toString(16).padStart(8, "0")}`
      );
    }
  }

  /**
   * Return the next 31-bit seed and rotate the internal state.
   * Output is in [0, 2^31 - 1] to match the existing seed conventions.
   */
  nextSeed(): number {
    return Math.floor(this.rng.next() * 2 ** 31);
  }

  /** Read-only view of the current state. For ops/debug logs only. */
  currentState(): number {
    return this.rng.state();
  }
}
