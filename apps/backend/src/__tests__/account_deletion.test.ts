/**
 * T-v0.6-F05 · Deletion integration test — real Postgres required.
 *
 * Skipped when DATABASE_URL is not set (unit-only environments).
 *
 * Scenario:
 *   (a) Two users play a match.
 *   (b) User X requests account deletion.
 *   (c) Assert:
 *       - users row for X is gone.
 *       - match_history row has X's slot tombstoned.
 *       - User Y's row intact.
 *       - User Y's history still shows the match (opponent slot shows tombstone).
 *
 * Each test uses a unique ID suffix so rows can be cleaned up deterministically.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgUserStore } from "../persistence/UserStore";
import { PgMatchHistoryStore } from "../persistence/MatchHistoryStore";
import { PgUserProgressStore } from "../persistence/UserProgressStore";
import { deleteAccount, tombstoneFor } from "../persistence/AccountDeletion";
import { _setPool } from "../db";

const DB_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DB_URL);

let pool: Pool;
// Accumulated IDs to clean up after all tests.
const cleanupUserIds: string[] = [];
const cleanupMatchIds: string[] = [];

beforeAll(async () => {
  if (!hasDb) return;
  pool = new Pool({ connectionString: DB_URL });
  _setPool(pool);
});

afterAll(async () => {
  if (!hasDb) return;
  // Best-effort cleanup: delete any rows we inserted.
  if (cleanupMatchIds.length) {
    await pool.query(
      `DELETE FROM match_history WHERE match_id = ANY($1::text[])`,
      [cleanupMatchIds]
    );
  }
  if (cleanupUserIds.length) {
    await pool.query(
      `DELETE FROM users WHERE user_id = ANY($1::text[])`,
      [cleanupUserIds]
    );
  }
  _setPool(null);
  await pool.end();
});

/** Register an ID for cleanup and return it. */
function trackUser(id: string): string { cleanupUserIds.push(id); return id; }
function trackMatch(id: string): string { cleanupMatchIds.push(id); return id; }

describe.skipIf(!hasDb)("Account deletion — real Postgres (T-v0.6-F05)", () => {
  const userStore = new PgUserStore();
  const matchHistoryStore = new PgMatchHistoryStore();

  it("(a)+(b)+(c): X deleted, history tombstoned, Y intact", async () => {
    const ts = Date.now();
    const aliceId = trackUser(`test-alice-${ts}`);
    const bobId = trackUser(`test-bob-${ts}`);
    const matchId = trackMatch(`test-match-${ts}`);

    // (a) Insert both users and a shared match.
    await userStore.upsert({ userId: aliceId, displayName: "Alice", provider: "google.com" });
    await userStore.upsert({ userId: bobId, displayName: "Bob", provider: "apple.com" });

    await matchHistoryStore.insert({
      matchId,
      p1UserId: aliceId,
      p2UserId: bobId,
      p1Score: 150,
      p2Score: 100,
      outcome: "P1_WIN",
      durationMs: 90_000,
    });

    // Verify setup.
    expect(await userStore.findById(aliceId)).not.toBeNull();
    expect(await userStore.findById(bobId)).not.toBeNull();

    // (b) Alice requests deletion.
    const result = await deleteAccount(aliceId, { userStore, matchHistoryStore });

    expect(result.deleted).toBe(true);

    // (c) Assert alice's row is gone.
    const aliceRow = await userStore.findById(aliceId);
    expect(aliceRow).toBeNull();

    // Bob's row is intact.
    const bobRow = await userStore.findById(bobId);
    expect(bobRow).not.toBeNull();
    expect(bobRow?.displayName).toBe("Bob");

    // Match row: alice's slot tombstoned, bob's slot intact.
    const aliceTombstone = tombstoneFor(aliceId);
    const rows = await matchHistoryStore.listForUser(bobId, 20, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchId).toBe(matchId);
    expect(rows[0].p1UserId).toBe(aliceTombstone);
    expect(rows[0].p2UserId).toBe(bobId);

    // Bob's history still shows the match.
    const bobView = await matchHistoryStore.listForUser(bobId, 20, 0);
    expect(bobView).toHaveLength(1);
  }, 15_000);

  it("idempotent: deleting already-deleted user is a no-op", async () => {
    const userId = trackUser(`test-idem-${Date.now()}`);
    await userStore.upsert({ userId, displayName: "Idem" });

    const r1 = await deleteAccount(userId, { userStore, matchHistoryStore });
    expect(r1.deleted).toBe(true);

    const r2 = await deleteAccount(userId, { userStore, matchHistoryStore });
    // Second call: row already gone.
    expect(r2.deleted).toBe(false);
  }, 15_000);

  it("upsert twice produces one row with updated displayName (T-v0.6-E06 PG)", async () => {
    const userId = trackUser(`test-upsert-${Date.now()}`);

    await userStore.upsert({ userId, displayName: "First", provider: "google.com" });
    await userStore.upsert({ userId, displayName: "Second" });

    const row = await userStore.findById(userId);
    expect(row?.displayName).toBe("Second");
    expect(row?.provider).toBe("google.com"); // preserved
  }, 15_000);

  it("user_progress row removed via ON DELETE CASCADE (T-v0.8-F03)", async () => {
    const progressStore = new PgUserProgressStore(pool);
    const ts = Date.now();
    const userId = trackUser(`test-progress-cascade-${ts}`);

    // Insert user, then add XP to create a user_progress row.
    await userStore.upsert({ userId, displayName: "ProgressUser", provider: "local" });
    await progressStore.addXp(userId, 50);

    // Confirm the progress row exists.
    const before = await progressStore.get(userId);
    expect(before).not.toBeNull();
    expect(before?.xp).toBe(50);

    // Delete the account — cascade should drop user_progress automatically.
    const result = await deleteAccount(userId, { userStore, matchHistoryStore });
    expect(result.deleted).toBe(true);

    // The users row is gone (hard-deleted), so querying user_progress should return null.
    const after = await progressStore.get(userId);
    expect(after).toBeNull();
  }, 15_000);

  it("match history listForUser returns only caller rows (T-v0.6-E08 PG)", async () => {
    const ts = Date.now();
    const u1 = trackUser(`test-hist-u1-${ts}`);
    const u2 = trackUser(`test-hist-u2-${ts}`);
    const m1 = trackMatch(`test-hist-m1-${ts}`);
    const m2 = trackMatch(`test-hist-m2-${ts}`);

    await matchHistoryStore.insert({
      matchId: m1,
      p1UserId: u1,
      p2UserId: u2,
      p1Score: 10,
      p2Score: 5,
      outcome: "P1_WIN",
      durationMs: 1000,
    });
    await matchHistoryStore.insert({
      matchId: m2,
      p1UserId: "other",
      p2UserId: "other2",
      p1Score: 5,
      p2Score: 10,
      outcome: "P2_WIN",
      durationMs: 1000,
    });

    const rows = await matchHistoryStore.listForUser(u1, 20, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchId).toBe(m1);
  }, 15_000);
});
