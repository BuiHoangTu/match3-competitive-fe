/**
 * T-v0.6-F01..F04 · Account deletion (GDPR AR-4).
 *
 * deleteAccount() runs entirely within a single Postgres transaction:
 *   F02: anonymise match_history rows (tombstone userId in p1/p2 slots)
 *   F03: hard-delete the users row
 *
 * Tombstone format: "TOMBSTONE_<first-8-chars-of-SHA-256(userId)>"
 * The hash is irreversible — you cannot recover the original userId from it.
 *
 * Idempotency: calling deleteAccount() for a userId that no longer exists
 * is a no-op (transaction still commits; UPDATE / DELETE affect 0 rows).
 */

import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import type { UserStore } from "./UserStore";
import type { MatchHistoryStore } from "./MatchHistoryStore";

export interface DeleteAccountDeps {
  userStore: UserStore;
  matchHistoryStore: MatchHistoryStore;
  /**
   * Optional Postgres pool client factory (defaults to getPool().connect()).
   * Injected in integration tests to pin the connection to a transaction.
   */
  getClient?: () => Promise<PoolClient>;
}

export interface DeleteAccountResult {
  /** true = row was found and deleted; false = row was already gone (idempotent). */
  deleted: boolean;
}

/** Derive a deterministic, irreversible tombstone tag from a userId. */
export function tombstoneFor(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `TOMBSTONE_${hash}`;
}

/**
 * Full GDPR account deletion.
 *
 * NOTE: The PgUserStore.delete() and PgMatchHistoryStore.anonymise() each call
 * getPool().query() which acquires a fresh connection from the pool. To wrap
 * both in one transaction we need to drive the SQL through a single PoolClient.
 * For the Postgres path we therefore execute the SQL directly here rather than
 * delegating to the store methods — keeping atomicity.
 *
 * For in-memory stores (unit tests) we delegate to the store methods since
 * there is no real transaction concept; we still call them sequentially so the
 * unit tests verify the logical ordering.
 */
export async function deleteAccount(
  userId: string,
  deps: DeleteAccountDeps
): Promise<DeleteAccountResult> {
  const tombstone = tombstoneFor(userId);

  let deleted = false;

  // Detect whether we're working with real Postgres or in-memory stores.
  const isPg =
    deps.userStore.constructor.name === "PgUserStore" ||
    deps.matchHistoryStore.constructor.name === "PgMatchHistoryStore";

  if (isPg) {
    deleted = await _pgDeleteAccount(userId, tombstone, deps);
  } else {
    deleted = await _memDeleteAccount(userId, tombstone, deps);
  }

  return { deleted };
}

async function _pgDeleteAccount(
  userId: string,
  tombstone: string,
  deps: DeleteAccountDeps
): Promise<boolean> {
  const connect = deps.getClient ?? (() => getPool().connect());
  const client = await connect();
  try {
    await client.query("BEGIN");

    // F02: anonymise match_history (both slots).
    await client.query(
      `UPDATE match_history SET p1_user_id = $2 WHERE p1_user_id = $1`,
      [userId, tombstone]
    );
    await client.query(
      `UPDATE match_history SET p2_user_id = $2 WHERE p2_user_id = $1`,
      [userId, tombstone]
    );

    // F03: hard-delete users row.
    const del = await client.query(
      `DELETE FROM users WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");
    return (del.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function _memDeleteAccount(
  userId: string,
  tombstone: string,
  deps: DeleteAccountDeps
): Promise<boolean> {
  // F02: anonymise.
  await deps.matchHistoryStore.anonymise(userId, tombstone);
  // F03: check existence before delete for the return value.
  const row = await deps.userStore.findById(userId);
  await deps.userStore.delete(userId);
  return row !== null;
}
