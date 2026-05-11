import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const fixtureDir = resolve(__dirname, "../../../../specification/fixtures/board-delta");

function readFixture(file: string): { event: string; payload: Record<string, unknown> } {
  return JSON.parse(readFileSync(resolve(fixtureDir, file), "utf8"));
}

function assertNoForbiddenOnlineFields(value: unknown): void {
  const text = JSON.stringify(value);
  for (const field of ["seed", "originalSeed", "rngState", "score", "scores"]) {
    expect(text.includes(`"${field}"`), `${field} must not appear`).toBe(false);
  }
}

function assertFlatBoard(payload: Record<string, unknown>): void {
  expect(typeof payload.width).toBe("number");
  expect(typeof payload.height).toBe("number");
  expect(typeof payload.boardVersion).toBe("number");
  expect(Array.isArray(payload.board)).toBe(true);
  expect((payload.board as unknown[]).length).toBe(
    (payload.width as number) * (payload.height as number)
  );
}

describe("v0.9 board-delta fixtures", () => {
  it("all online fixtures avoid seed replay and competitive score fields", () => {
    for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith(".json"))) {
      assertNoForbiddenOnlineFields(readFixture(file));
    }
  });

  it("match_found, rejoin, and board_replaced carry flat 1D boards", () => {
    for (const file of ["match_found.json", "rejoin.json", "board_replaced.json"]) {
      assertFlatBoard(readFixture(file).payload);
    }
  });

  it("generatedTiles are ordered by column, then row", () => {
    const { payload } = readFixture("move_resolved.json");
    const generatedTiles = payload.generatedTiles as Array<{ row: number; col: number }>;

    const sorted = [...generatedTiles].sort((a, b) => a.col - b.col || a.row - b.row);
    expect(generatedTiles).toEqual(sorted);
  });
});
