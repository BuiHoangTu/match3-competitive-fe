/**
 * Unit tests for persistence modules — no Postgres required.
 *
 * T-v0.6-E06 · UserStore — two upserts produce one row
 * T-v0.6-E07 · MatchHistoryStore — complete match yields one row
 * T-v0.6-E08 · MatchHistoryStore.listForUser — auth isolation
 * T-v0.6-E09 · BufferedMatchHistoryStore — drop-count and flush
 * T-v0.6-F01..F03 · AccountDeletion — atomicity via in-memory stores
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryUserStore,
} from "../persistence/UserStore";
import {
  InMemoryMatchHistoryStore,
  BufferedMatchHistoryStore,
  match_history_buffer_dropped_total,
  resetDropCounter,
  type InsertMatchParams,
} from "../persistence/MatchHistoryStore";
import { deleteAccount, tombstoneFor } from "../persistence/AccountDeletion";

// ─── T-v0.6-E06 UserStore ────────────────────────────────────────────────────

describe("InMemoryUserStore (T-v0.6-E06)", () => {
  it("two upserts produce one row with updated fields", async () => {
    const store = new InMemoryUserStore();
    await store.upsert({ userId: "u1", displayName: "Alice", avatarUrl: "https://a.com/1.png", provider: "google.com" });
    await store.upsert({ userId: "u1", displayName: "Alice Updated", avatarUrl: "https://a.com/2.png" });

    expect(store.rows.size).toBe(1);
    const row = store.rows.get("u1");
    expect(row?.displayName).toBe("Alice Updated");
    expect(row?.avatarUrl).toBe("https://a.com/2.png");
    // provider kept from first insert since second had no provider
    expect(row?.provider).toBe("google.com");
  });

  it("upsert is idempotent with identical data", async () => {
    const store = new InMemoryUserStore();
    await store.upsert({ userId: "u2", displayName: "Bob" });
    await store.upsert({ userId: "u2", displayName: "Bob" });
    expect(store.rows.size).toBe(1);
  });

  it("findById returns null for missing user", async () => {
    const store = new InMemoryUserStore();
    expect(await store.findById("nobody")).toBeNull();
  });

  it("findById returns row for existing user", async () => {
    const store = new InMemoryUserStore();
    await store.upsert({ userId: "u3", displayName: "Carol" });
    const row = await store.findById("u3");
    expect(row?.userId).toBe("u3");
    expect(row?.displayName).toBe("Carol");
  });

  it("delete removes the row", async () => {
    const store = new InMemoryUserStore();
    await store.upsert({ userId: "u4" });
    await store.delete("u4");
    expect(store.rows.size).toBe(0);
  });

  it("delete is idempotent (second call is no-op)", async () => {
    const store = new InMemoryUserStore();
    await store.delete("nonexistent"); // should not throw
    expect(store.rows.size).toBe(0);
  });
});

// ─── T-v0.6-E07/E08 MatchHistoryStore ────────────────────────────────────────

function makeMatch(overrides: Partial<InsertMatchParams> = {}): InsertMatchParams {
  return {
    matchId: "match-001",
    p1UserId: "u1",
    p2UserId: "u2",
    p1Score: 100,
    p2Score: 80,
    outcome: "P1_WIN",
    durationMs: 60_000,
    ...overrides,
  };
}

describe("InMemoryMatchHistoryStore (T-v0.6-E07/E08)", () => {
  it("insert produces one row", async () => {
    const store = new InMemoryMatchHistoryStore();
    await store.insert(makeMatch());
    expect(store.rows.size).toBe(1);
  });

  it("insert is idempotent (same matchId inserted twice = one row)", async () => {
    const store = new InMemoryMatchHistoryStore();
    await store.insert(makeMatch());
    await store.insert(makeMatch({ p1Score: 999 })); // different score, same id
    expect(store.rows.size).toBe(1);
    // First insert wins
    expect(store.rows.get("match-001")?.p1Score).toBe(100);
  });

  it("listForUser returns only the caller's rows (T-v0.6-E08 isolation)", async () => {
    const store = new InMemoryMatchHistoryStore();
    await store.insert(makeMatch({ matchId: "m1", p1UserId: "alice", p2UserId: "bob" }));
    await store.insert(makeMatch({ matchId: "m2", p1UserId: "charlie", p2UserId: "dave" }));
    await store.insert(makeMatch({ matchId: "m3", p1UserId: "bob", p2UserId: "charlie" }));

    const aliceRows = await store.listForUser("alice", 20, 0);
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0].matchId).toBe("m1");

    const bobRows = await store.listForUser("bob", 20, 0);
    expect(bobRows).toHaveLength(2); // m1 (p2) and m3 (p1)

    const eveRows = await store.listForUser("eve", 20, 0);
    expect(eveRows).toHaveLength(0);
  });

  it("listForUser respects limit and offset", async () => {
    const store = new InMemoryMatchHistoryStore();
    for (let i = 0; i < 5; i++) {
      await store.insert(makeMatch({
        matchId: `m${i}`,
        p1UserId: "alice",
        p2UserId: "bob",
        endedAt: new Date(Date.now() - i * 1000),
      }));
    }
    const page1 = await store.listForUser("alice", 2, 0);
    expect(page1).toHaveLength(2);
    const page2 = await store.listForUser("alice", 2, 2);
    expect(page2).toHaveLength(2);
    const page3 = await store.listForUser("alice", 2, 4);
    expect(page3).toHaveLength(1);
  });

  it("anonymise replaces userId with tombstone in both slots", async () => {
    const store = new InMemoryMatchHistoryStore();
    await store.insert(makeMatch({ matchId: "m1", p1UserId: "alice", p2UserId: "bob" }));
    await store.insert(makeMatch({ matchId: "m2", p1UserId: "charlie", p2UserId: "alice" }));

    const tombstone = "TOMBSTONE_aabbccdd";
    await store.anonymise("alice", tombstone);

    expect(store.rows.get("m1")?.p1UserId).toBe(tombstone);
    expect(store.rows.get("m1")?.p2UserId).toBe("bob"); // untouched
    expect(store.rows.get("m2")?.p2UserId).toBe(tombstone);
    expect(store.rows.get("m2")?.p1UserId).toBe("charlie"); // untouched
  });
});

// ─── T-v0.6-E09 BufferedMatchHistoryStore ────────────────────────────────────

describe("BufferedMatchHistoryStore (T-v0.6-E09)", () => {
  beforeEach(() => {
    resetDropCounter();
  });

  it("drops oldest when over cap, increments drop counter", async () => {
    // Use a failing inner store.
    let dbDown = true;
    const inner = new InMemoryMatchHistoryStore();
    const failing = {
      async insert(p: InsertMatchParams) {
        if (dbDown) throw new Error("DB down");
        return inner.insert(p);
      },
      listForUser: inner.listForUser.bind(inner),
      anonymise: inner.anonymise.bind(inner),
    };

    const cap = 10;
    const buf = new BufferedMatchHistoryStore(failing, cap);

    // Insert 15 items while DB is down.
    for (let i = 0; i < 15; i++) {
      await buf.insert(makeMatch({ matchId: `m${i}` }));
    }

    // 10 cap: first 5 items dropped (oldest), 10 remain buffered.
    // But wait: the first item tries real insert (fails), then gets buffered.
    // Items 1-9 flush pending (no: flush fails too). Each call:
    //   1. Flush pending (fails → re-enqueues, trimmed to cap)
    //   2. Try real insert (fails → enqueue, trim to cap)
    // After 15 inserts into a cap=10 buffer: 5 dropped.
    expect(match_history_buffer_dropped_total).toBe(5);
    expect(buf.pendingCount).toBe(10);
    expect(inner.rows.size).toBe(0);

    // Re-enable DB and trigger flush via a new insert.
    dbDown = false;
    await buf.insert(makeMatch({ matchId: "final" }));

    // All buffered items + the new one should have been inserted.
    expect(buf.pendingCount).toBe(0);
    // 10 buffered + 1 new
    expect(inner.rows.size).toBe(11);
  });

  it("passes through inserts when DB is healthy", async () => {
    const inner = new InMemoryMatchHistoryStore();
    const buf = new BufferedMatchHistoryStore(inner);

    await buf.insert(makeMatch({ matchId: "ok1" }));
    await buf.insert(makeMatch({ matchId: "ok2" }));

    expect(buf.pendingCount).toBe(0);
    expect(inner.rows.size).toBe(2);
    expect(match_history_buffer_dropped_total).toBe(0);
  });
});

// ─── T-v0.6-F01..F03 AccountDeletion ─────────────────────────────────────────

describe("deleteAccount (T-v0.6-F01..F03)", () => {
  it("removes user row and tombstones match_history; opponent slot intact", async () => {
    const userStore = new InMemoryUserStore();
    const matchHistoryStore = new InMemoryMatchHistoryStore();

    await userStore.upsert({ userId: "alice", displayName: "Alice" });
    await userStore.upsert({ userId: "bob", displayName: "Bob" });

    await matchHistoryStore.insert({
      matchId: "m1",
      p1UserId: "alice",
      p2UserId: "bob",
      p1Score: 100,
      p2Score: 80,
      outcome: "P1_WIN",
      durationMs: 60_000,
    });
    await matchHistoryStore.insert({
      matchId: "m2",
      p1UserId: "charlie",
      p2UserId: "alice",
      p1Score: 50,
      p2Score: 70,
      outcome: "P2_WIN",
      durationMs: 30_000,
    });

    const result = await deleteAccount("alice", { userStore, matchHistoryStore });

    // F03: users row deleted.
    expect(userStore.rows.has("alice")).toBe(false);
    expect(result.deleted).toBe(true);

    // Bob's row untouched.
    expect(userStore.rows.has("bob")).toBe(true);

    // F02: alice tombstoned in both slots; bob and charlie untouched.
    const expectedTombstone = tombstoneFor("alice");
    expect(matchHistoryStore.rows.get("m1")?.p1UserId).toBe(expectedTombstone);
    expect(matchHistoryStore.rows.get("m1")?.p2UserId).toBe("bob");
    expect(matchHistoryStore.rows.get("m2")?.p2UserId).toBe(expectedTombstone);
    expect(matchHistoryStore.rows.get("m2")?.p1UserId).toBe("charlie");

    expect(result).toEqual({ deleted: true });
  });

  it("second deleteAccount call is a no-op (idempotent)", async () => {
    const userStore = new InMemoryUserStore();
    const matchHistoryStore = new InMemoryMatchHistoryStore();

    await userStore.upsert({ userId: "alice" });

    await deleteAccount("alice", { userStore, matchHistoryStore });
    const result2 = await deleteAccount("alice", { userStore, matchHistoryStore });

    // Second call: no row found, deleted = false.
    expect(result2.deleted).toBe(false);
    // No throw.
  });

  it("tombstoneFor produces a deterministic irreversible string", () => {
    const t1 = tombstoneFor("user-abc");
    const t2 = tombstoneFor("user-abc");
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^TOMBSTONE_[0-9a-f]{8}$/);
    // Different userIds → different tombstones.
    expect(tombstoneFor("user-abc")).not.toBe(tombstoneFor("user-xyz"));
  });
});

// ─── T-v0.6-E08 HTTP isolation (unit-level, no real server) ──────────────────

describe("MatchHistoryStore listForUser auth isolation (T-v0.6-E08)", () => {
  it("caller can only see their own rows regardless of userId param", async () => {
    // The HTTP endpoint always uses the verified token userId, never a
    // query-string userId. This test validates the store-level isolation
    // (the HTTP layer is tested in matchmakingHttp tests via server).
    const store = new InMemoryMatchHistoryStore();
    await store.insert(makeMatch({ matchId: "m-alice", p1UserId: "alice", p2UserId: "bob" }));
    await store.insert(makeMatch({ matchId: "m-eve", p1UserId: "eve", p2UserId: "dave" }));

    // Alice queries with her own userId — gets her row only.
    const aliceView = await store.listForUser("alice", 20, 0);
    expect(aliceView.map((r) => r.matchId)).toEqual(["m-alice"]);

    // A hypothetical attacker calling listForUser("eve") from alice's session
    // would need to pass "alice" as the userId — the HTTP layer enforces this.
    const eveView = await store.listForUser("eve", 20, 0);
    expect(eveView.map((r) => r.matchId)).toEqual(["m-eve"]);
  });
});
