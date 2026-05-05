/**
 * T-v0.6-I06 · Bridge-surface regression test
 *
 * Asserts that the TypeScript bridge message-name constants match the canonical
 * fixture at shared/src/__tests__/bridge-messages.txt.
 *
 * This test is the guard that prevents TS↔Dart message-name drift: the same
 * fixture is read by the Dart test (shell/test/bridge/bridge_messages_test.dart).
 * If a name is added/removed/renamed on either side without updating the fixture,
 * one of the two tests will fail.
 *
 * Guard direction: fails in BOTH directions —
 *   - A new BridgeMessageType entry not in the fixture → test fails ("extra in TS").
 *   - A fixture entry not in BridgeMessageType → test fails ("missing from TS").
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { BridgeMessageType } from "@match3/shared-js/bridge.js";

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../shared-js/src/__tests__/bridge-messages.txt"
);

function readFixture(): string[] {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

describe("bridge contract — message name parity (T-v0.6-I06)", () => {
  it("BridgeMessageType values exactly match the canonical fixture", () => {
    const fixtureNames = readFixture();
    const tsNames = Object.values(BridgeMessageType).slice().sort();
    expect(tsNames).toEqual(fixtureNames);
  });

  it("no BridgeMessageType entry is missing from the fixture — adding without fixture update fails", () => {
    const fixtureSet = new Set(readFixture());
    const extra = Object.values(BridgeMessageType).filter(
      (name) => !fixtureSet.has(name)
    );
    expect(
      extra,
      `These BridgeMessageType entries are not in bridge-messages.txt: ${extra.join(", ")}. ` +
        "Update shared/src/__tests__/bridge-messages.txt and shell/test/bridge/bridge-messages.txt."
    ).toEqual([]);
  });

  it("no fixture entry is missing from BridgeMessageType — removing without TS update fails", () => {
    const tsSet = new Set(Object.values(BridgeMessageType)) as Set<string>;
    const missing = readFixture().filter((name) => !tsSet.has(name));
    expect(
      missing,
      `These fixture names are not in BridgeMessageType: ${missing.join(", ")}. ` +
        "Update shared/src/bridge.ts to add the missing entries."
    ).toEqual([]);
  });

  it("has exactly seven messages (four shell→game, three game→shell)", () => {
    expect(Object.keys(BridgeMessageType)).toHaveLength(7);
  });

  it("shell→game names are present", () => {
    expect(Object.values(BridgeMessageType)).toContain("startMatch");
    expect(Object.values(BridgeMessageType)).toContain("startLocalMatch");
    expect(Object.values(BridgeMessageType)).toContain("appLifecycle");
    expect(Object.values(BridgeMessageType)).toContain("requestLeaveMatch");
  });

  it("game→shell names are present", () => {
    expect(Object.values(BridgeMessageType)).toContain("ready");
    expect(Object.values(BridgeMessageType)).toContain("authTokenRejected");
    expect(Object.values(BridgeMessageType)).toContain("matchEnded");
  });
});
