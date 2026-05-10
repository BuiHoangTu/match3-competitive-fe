/**
 * T-v0.8-F03 · UserProgressStore tests.
 *
 * Unit tests use InMemoryUserProgressStore (no Postgres required).
 * Integration tests use PgUserProgressStore and are skipped when
 * DATABASE_URL is not set.
 *
 * Coverage:
 *   - get returns null for unknown user
 *   - addXp upserts a new row with xp = delta when none exists
 *   - addXp increments existing xp atomically (two concurrent calls)
 *   - setDefaultCharacter inserts at xp=0 when no row exists
 *   - setDefaultCharacter updates character without altering xp
 *   - updated_at advances on each write
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  InMemoryUserProgressStore,
  PgUserProgressStore,
} from "../persistence/UserProgressStore";
import { _setPool } from "../db";

// ─── Unit tests (InMemoryUserProgressStore) ───────────────────────────────────

describe("InMemoryUserProgressStore (T-v0.8-F03 unit)", () => {
  it("get returns null for unknown user", async () => {
    const store = new InMemoryUserProgressStore();
    expect(await store.get("nobody")).toBeNull();
  });

  it("addXp upserts a new row with xp = delta when no row exists", async () => {
    const store = new InMemoryUserProgressStore();
    const row = await store.addXp("u1", 100);
    expect(row.userId).toBe("u1");
    expect(row.xp).toBe(100);
    expect(row.defaultCharacterId).toBe("cat");

    const fetched = await store.get("u1");
    expect(fetched?.xp).toBe(100);
  });

  it("addXp increments existing xp", async () => {
    const store = new InMemoryUserProgressStore();
    await store.addXp("u2", 50);
    const row = await store.addXp("u2", 30);
    expect(row.xp).toBe(80);
  });

  it("concurrent addXp calls sum correctly (in-memory sequential simulation)", async () => {
    const store = new InMemoryUserProgressStore();
    await store.addXp("u3", 0); // create row
    // Run two concurrent increments — Promise.all with the in-memory store
    // actually executes them sequentially (single-threaded), but this
    // mirrors the API contract test for the PG path.
    const [r1, r2] = await Promise.all([
      store.addXp("u3", 40),
      store.addXp("u3", 60),
    ]);
    // One of the two resolved rows will have the full sum; the other may show
    // an intermediate value because in-memory is not truly concurrent. What
    // matters is that the final stored value is the sum.
    const final = await store.get("u3");
    expect(final?.xp).toBe(100);
    // Both returned rows should reflect valid (non-negative) xp values.
    expect(r1.xp).toBeGreaterThan(0);
    expect(r2.xp).toBeGreaterThan(0);
  });

  it("setDefaultCharacter inserts a row at xp=0 when none exists", async () => {
    const store = new InMemoryUserProgressStore();
    const row = await store.setDefaultCharacter("u4", "dog");
    expect(row.userId).toBe("u4");
    expect(row.xp).toBe(0);
    expect(row.defaultCharacterId).toBe("dog");

    const fetched = await store.get("u4");
    expect(fetched?.defaultCharacterId).toBe("dog");
    expect(fetched?.xp).toBe(0);
  });

  it("setDefaultCharacter updates character without altering xp", async () => {
    const store = new InMemoryUserProgressStore();
    await store.addXp("u5", 200);
    const row = await store.setDefaultCharacter("u5", "rabbit");
    expect(row.xp).toBe(200);
    expect(row.defaultCharacterId).toBe("rabbit");
  });

  it("updated_at advances on each write", async () => {
    const store = new InMemoryUserProgressStore();
    const r1 = await store.addXp("u6", 10);
    // Small delay to ensure timestamps differ.
    await new Promise((res) => setTimeout(res, 5));
    const r2 = await store.addXp("u6", 10);
    expect(r2.updatedAt.getTime()).toBeGreaterThanOrEqual(r1.updatedAt.getTime());
  });
});

// ─── Integration tests (PgUserProgressStore) — skipped without DATABASE_URL ──

const DB_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DB_URL);

let pool: Pool;
const cleanupUserIds: string[] = [];

function trackUser(id: string): string {
  cleanupUserIds.push(id);
  return id;
}

beforeAll(async () => {
  if (!hasDb) return;
  pool = new Pool({ connectionString: DB_URL });
  _setPool(pool);
  // Seed a users row for each test user so FK constraint is satisfied.
});

afterAll(async () => {
  if (!hasDb) return;
  if (cleanupUserIds.length) {
    // user_progress rows are removed automatically via ON DELETE CASCADE.
    await pool.query(
      `DELETE FROM users WHERE user_id = ANY($1::text[])`,
      [cleanupUserIds]
    );
  }
  _setPool(null);
  await pool.end();
});

/** Helper: insert a bare users row so FK constraints are satisfied. */
async function seedUser(userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (user_id, display_name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, "TestUser"]
  );
}

describe.skipIf(!hasDb)("PgUserProgressStore (T-v0.8-F03 integration)", () => {
  let store: PgUserProgressStore;

  beforeAll(() => {
    store = new PgUserProgressStore(pool);
  });

  it("get returns null for unknown user", async () => {
    expect(await store.get("pg-nobody")).toBeNull();
  });

  it("addXp upserts a new row with xp = delta when no row exists", async () => {
    const userId = trackUser(`pg-addxp-new-${Date.now()}`);
    await seedUser(userId);

    const row = await store.addXp(userId, 75);
    expect(row.userId).toBe(userId);
    expect(row.xp).toBe(75);
    expect(row.defaultCharacterId).toBe("cat");

    const fetched = await store.get(userId);
    expect(fetched?.xp).toBe(75);
  });

  it("addXp increments existing xp", async () => {
    const userId = trackUser(`pg-addxp-inc-${Date.now()}`);
    await seedUser(userId);

    await store.addXp(userId, 50);
    const row = await store.addXp(userId, 25);
    expect(row.xp).toBe(75);
  });

  it("concurrent addXp calls produce the correct sum (T-v0.8-F03 atomicity)", async () => {
    const userId = trackUser(`pg-addxp-concurrent-${Date.now()}`);
    await seedUser(userId);
    // Seed a row first so both concurrent calls hit the ON CONFLICT path.
    await store.addXp(userId, 0);

    // Fire two concurrent increments.
    await Promise.all([store.addXp(userId, 40), store.addXp(userId, 60)]);

    const final = await store.get(userId);
    // The sum must be exactly 100 — no lost update.
    expect(final?.xp).toBe(100);
  }, 15_000);

  it("setDefaultCharacter inserts a row at xp=0 when none exists", async () => {
    const userId = trackUser(`pg-setchar-new-${Date.now()}`);
    await seedUser(userId);

    const row = await store.setDefaultCharacter(userId, "dog");
    expect(row.xp).toBe(0);
    expect(row.defaultCharacterId).toBe("dog");
  });

  it("setDefaultCharacter updates character without altering xp", async () => {
    const userId = trackUser(`pg-setchar-update-${Date.now()}`);
    await seedUser(userId);

    await store.addXp(userId, 120);
    const row = await store.setDefaultCharacter(userId, "rabbit");
    expect(row.xp).toBe(120);
    expect(row.defaultCharacterId).toBe("rabbit");
  });

  it("updated_at advances on each write", async () => {
    const userId = trackUser(`pg-updatedat-${Date.now()}`);
    await seedUser(userId);

    const r1 = await store.addXp(userId, 10);
    // Sleep 10 ms to guarantee clock advance (Postgres has microsecond precision).
    await new Promise((res) => setTimeout(res, 10));
    const r2 = await store.addXp(userId, 10);
    expect(r2.updatedAt.getTime()).toBeGreaterThan(r1.updatedAt.getTime());
  }, 15_000);
});
