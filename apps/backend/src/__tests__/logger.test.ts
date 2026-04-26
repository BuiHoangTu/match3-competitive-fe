import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logEvent, type LifecycleEvent } from "../logger";

describe("logger", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let writeSpy: any;
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    writeSpy = vi
      .spyOn(process.stdout, "write")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(((chunk: any) => {
        const text = typeof chunk === "string" ? chunk : String(chunk);
        for (const part of text.split("\n")) {
          if (part.length > 0) lines.push(part);
        }
        return true;
      }) as never);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("emits one JSON-parsable line per call", () => {
    logEvent("match_created", { matchId: "r1", seed: 42 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.event).toBe("match_created");
    expect(parsed.matchId).toBe("r1");
    expect(parsed.seed).toBe(42);
    expect(typeof parsed.ts).toBe("string");
    expect(() => new Date(parsed.ts)).not.toThrow();
  });

  it("emits all seven lifecycle event names", () => {
    const events: LifecycleEvent[] = [
      "match_created",
      "player_joined",
      "move_submitted",
      "move_rejected",
      "disconnect",
      "rejoin",
      "match_ended",
    ];
    for (const ev of events) {
      logEvent(ev, { matchId: "r1" });
    }
    expect(lines).toHaveLength(events.length);
    const parsedEvents = lines.map((l) => JSON.parse(l).event);
    expect(parsedEvents).toEqual(events);
  });

  it("produces a valid ISO timestamp", () => {
    logEvent("disconnect", { playerId: "p1" });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
