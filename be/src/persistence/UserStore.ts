/**
 * T-v0.6-E06 · UserStore — upsert user profiles on sign-in.
 *
 * Interface is backend-agnostic so tests can use InMemoryUserStore without a
 * real Postgres connection. The PgUserStore wraps db.ts query().
 *
 * PII fields: display_name, avatar_url.
 * No email is stored — data-minimisation (AR-6).
 */

import { getPool } from "../db";

export interface UpsertUserParams {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  provider?: string;
}

export interface UserRow {
  userId: string;
  displayName: string;
  avatarUrl: string;
  provider: string;
  createdAt: Date;
}

export interface UserStore {
  /**
   * Insert on first appearance; update display fields on subsequent calls.
   * Idempotent — calling twice with identical data is a no-op.
   */
  upsert(params: UpsertUserParams): Promise<void>;

  /**
   * Return the user row, or null if not found (or already hard-deleted).
   */
  findById(userId: string): Promise<UserRow | null>;

  /**
   * Hard-delete the users row. Part of the GDPR deletion flow.
   * Idempotent — second call is a no-op (row already gone).
   */
  delete(userId: string): Promise<void>;
}

// ─── Postgres implementation ──────────────────────────────────────────────────

export class PgUserStore implements UserStore {
  async upsert(params: UpsertUserParams): Promise<void> {
    const { userId, displayName = "", avatarUrl = "", provider = "" } = params;
    // ON CONFLICT: update display fields; leave created_at and provider unchanged
    // unless provider is being supplied (first insert). We always UPDATE the three
    // mutable display fields because OAuth tokens can carry updated names/avatars.
    await getPool().query(
      `INSERT INTO users (user_id, display_name, avatar_url, provider)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             avatar_url   = EXCLUDED.avatar_url,
             provider     = COALESCE(NULLIF(EXCLUDED.provider, ''), users.provider)`,
      [userId, displayName, avatarUrl, provider]
    );
  }

  async findById(userId: string): Promise<UserRow | null> {
    const result = await getPool().query<{
      user_id: string;
      display_name: string;
      avatar_url: string;
      provider: string;
      created_at: Date;
    }>(
      `SELECT user_id, display_name, avatar_url, provider, created_at
         FROM users
        WHERE user_id = $1
          AND deleted_at IS NULL`,
      [userId]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      provider: r.provider,
      createdAt: r.created_at,
    };
  }

  async delete(userId: string): Promise<void> {
    // Called inside the GDPR deletion transaction — just the DELETE here;
    // the transaction wrapper lives in AccountDeletion.ts.
    await getPool().query(`DELETE FROM users WHERE user_id = $1`, [userId]);
  }
}

// ─── In-memory implementation (for unit tests) ───────────────────────────────

export class InMemoryUserStore implements UserStore {
  /** Exposed for assertions in tests. */
  readonly rows: Map<string, UserRow> = new Map();

  async upsert(params: UpsertUserParams): Promise<void> {
    const { userId, displayName = "", avatarUrl = "", provider = "" } = params;
    const existing = this.rows.get(userId);
    if (existing) {
      existing.displayName = displayName;
      existing.avatarUrl = avatarUrl;
      if (provider) existing.provider = provider;
    } else {
      this.rows.set(userId, {
        userId,
        displayName,
        avatarUrl,
        provider,
        createdAt: new Date(),
      });
    }
  }

  async findById(userId: string): Promise<UserRow | null> {
    return this.rows.get(userId) ?? null;
  }

  async delete(userId: string): Promise<void> {
    this.rows.delete(userId);
  }
}
