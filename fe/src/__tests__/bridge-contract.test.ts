/**
 * Asserts that the TypeScript bridge message-name constants match the canonical
 * fixture at shared/src/__tests__/bridge-messages.txt.
 *
 * This test is the guard that prevents TS↔Dart message-name drift: the same
 * fixture is read by the Dart test (shell/test/bridge/bridge_messages_test.dart).
 * If a name is added/removed/renamed on either side without updating the fixture,
 * one of the two tests will fail.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { BridgeMessageType } from "@match3/shared/bridge.js";

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../shared/src/__tests__/bridge-messages.txt"
);

describe("bridge contract — message name parity", () => {
  it("BridgeMessageType values exactly match the canonical fixture", () => {
    const raw = fs.readFileSync(FIXTURE_PATH, "utf-8");
    const fixtureNames = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort();

    const tsNames = Object.values(BridgeMessageType).slice().sort();

    expect(tsNames).toEqual(fixtureNames);
  });

  it("has exactly six messages (three shell→game, three game→shell)", () => {
    expect(Object.keys(BridgeMessageType)).toHaveLength(6);
  });

  it("shell→game names are present", () => {
    expect(Object.values(BridgeMessageType)).toContain("startMatch");
    expect(Object.values(BridgeMessageType)).toContain("appLifecycle");
    expect(Object.values(BridgeMessageType)).toContain("requestLeaveMatch");
  });

  it("game→shell names are present", () => {
    expect(Object.values(BridgeMessageType)).toContain("ready");
    expect(Object.values(BridgeMessageType)).toContain("authTokenRejected");
    expect(Object.values(BridgeMessageType)).toContain("matchEnded");
  });
});
