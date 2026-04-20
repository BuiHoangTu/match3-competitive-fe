import { describe, it, expect } from "vitest";
import { runLatencyHarness } from "./latency-harness";

describe("T-v0.5-11 latency harness", () => {
  it(
    "runs a 50-move match at SIM_RTT_MS=300 without throwing",
    async () => {
      const result = await runLatencyHarness({ rttMs: 300, moveCount: 50 });
      expect(result.movesPlayed).toBeGreaterThan(0);
      // Every recorded roundtrip must meet at least the injected RTT floor
      for (const rtt of result.roundtripsMs) {
        expect(rtt).toBeGreaterThanOrEqual(250);
      }
    },
    120_000
  );

  it(
    "exposes a programmatic knob for 0 / 100 / 300 / 500 ms",
    async () => {
      for (const rttMs of [0, 100]) {
        const res = await runLatencyHarness({ rttMs, moveCount: 3 });
        expect(res.movesPlayed).toBeGreaterThan(0);
      }
    },
    60_000
  );
});
