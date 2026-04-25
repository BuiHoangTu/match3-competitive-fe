import { afterEach, describe, expect, it } from "vitest";
import { Writable } from "stream";
import {
  counterNames,
  emitJsonLine,
  increment,
  reset,
  snapshot,
} from "../metrics";

afterEach(() => reset());

describe("T-v1.0-09 · metrics", () => {
  it("starts every counter at zero", () => {
    const s = snapshot();
    for (const n of counterNames) {
      expect(s[n]).toBe(0);
    }
  });

  it("increment bumps the named counter", () => {
    increment("match_count");
    increment("match_count", 4);
    expect(snapshot().match_count).toBe(5);
  });

  it("increment leaves other counters untouched", () => {
    increment("bridge_error_count", 2);
    expect(snapshot().match_count).toBe(0);
    expect(snapshot().bridge_error_count).toBe(2);
  });

  it("emitJsonLine writes a JSON line containing every counter + ts + event", () => {
    increment("match_count", 7);
    let captured = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        captured += chunk.toString();
        cb();
      },
    });
    emitJsonLine(sink);
    const parsed = JSON.parse(captured.trim());
    expect(parsed.event).toBe("metrics");
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.match_count).toBe(7);
    for (const n of counterNames) {
      expect(parsed).toHaveProperty(n);
    }
  });

  it("reset zeros all counters (for tests)", () => {
    increment("match_count", 3);
    increment("account_deletion_count", 2);
    reset();
    const s = snapshot();
    for (const n of counterNames) {
      expect(s[n]).toBe(0);
    }
  });

  it("counter set is closed (compile-time enum-like guard)", () => {
    // This is a compile-time guarantee enforced by the CounterName union.
    // Confirm at runtime that the published list is exactly six names.
    expect(counterNames).toHaveLength(6);
    expect(counterNames).toContain("match_count");
    expect(counterNames).toContain("match_history_buffer_dropped_total");
  });
});
