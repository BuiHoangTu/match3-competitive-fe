/**
 * T-v0.8-F03 · UserProgressStore — per-user XP and cosmetic preferences.
 *
 * The Postgres implementation uses a single-row INSERT … ON CONFLICT upsert
 * pattern so addXp() is safe under concurrent callers — the UPDATE uses
 * xp = user_progress.xp + EXCLUDED.xp which is evaluated atomically by the
 * DB engine, not in application code.
 *
 * GDPR / account deletion: the user_progress row carries no PII. It is
 * removed automatically via ON DELETE CASCADE when the parent users row is
 * hard-deleted. No manual anonymisation is needed.
 *
 * PII classification: none. user_id is a technical key shared across all
 * tables; xp and default_character_id are non-identifying game state.
 */

import type { Pool } from "pg";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface UserProgress {
  userId: string;
  xp: number;
  defaultCharacterId: string;
  updatedAt: Date;
}

export interface UserProgressStore {
  /**
   * Return the progress row for `userId`, or null if no row exists yet.
   * Callers can create a row on first write via addXp / setDefaultCharacter.
   */
  get(userId: string): Promise<UserProgress | null>;

  /**
   * Atomic UPSERT + increment. Inserts a row with xp = delta if none exists;
   * increments xp by delta if a row already exists. Returns the post-write row.
   * Safe under concurrent callers — no separate read-modify-write.
   */
  addXp(userId: string, delta: number): Promise<UserProgress>;

  /**
   * Set the default_character_id for a user. Inserts a row at xp = 0 if none
   * exists. Returns the post-write row.
   */
  setDefaultCharacter(
    userId: string,
    characterId: string
  ): Promise<UserProgress>;
}

// ─── Postgres implementation ──────────────────────────────────────────────────

export class PgUserProgressStore implements UserProgressStore {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<UserProgress | null> {
    const res = await this.pool.query<{
      user_id: string;
      xp: number;
      default_character_id: string;
      updated_at: Date;
    }>(
      `SELECT user_id, xp, default_character_id, updated_at
         FROM user_progress
        WHERE user_id = $1`,
      [userId]
    );
    if (res.rows.length === 0) return null;
    return _mapRow(res.rows[0]);
  }

  async addXp(userId: string, delta: number): Promise<UserProgress> {
    // Single atomic UPSERT: on first insert xp = delta; on conflict xp += delta.
    // updated_at is refreshed on every write.
    const res = await this.pool.query<{
      user_id: string;
      xp: number;
      default_character_id: string;
      updated_at: Date;
    }>(
      `INSERT INTO user_progress (user_id, xp, updated_at)
            VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
           SET xp         = user_progress.xp + EXCLUDED.xp,
               updated_at = now()
       RETURNING user_id, xp, default_character_id, updated_at`,
      [userId, delta]
    );
    return _mapRow(res.rows[0]);
  }

  async setDefaultCharacter(
    userId: string,
    characterId: string
  ): Promise<UserProgress> {
    const res = await this.pool.query<{
      user_id: string;
      xp: number;
      default_character_id: string;
      updated_at: Date;
    }>(
      `INSERT INTO user_progress (user_id, default_character_id, updated_at)
            VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
           SET default_character_id = EXCLUDED.default_character_id,
               updated_at           = now()
       RETURNING user_id, xp, default_character_id, updated_at`,
      [userId, characterId]
    );
    return _mapRow(res.rows[0]);
  }
}

// ─── In-memory implementation (for unit tests) ───────────────────────────────

export class InMemoryUserProgressStore implements UserProgressStore {
  /** Exposed for assertions in tests. */
  readonly rows: Map<string, UserProgress> = new Map();

  async get(userId: string): Promise<UserProgress | null> {
    return this.rows.get(userId) ?? null;
  }

  async addXp(userId: string, delta: number): Promise<UserProgress> {
    const existing = this.rows.get(userId);
    if (existing) {
      existing.xp += delta;
      existing.updatedAt = new Date();
      return { ...existing };
    }
    const row: UserProgress = {
      userId,
      xp: delta,
      defaultCharacterId: "cat",
      updatedAt: new Date(),
    };
    this.rows.set(userId, row);
    return { ...row };
  }

  async setDefaultCharacter(
    userId: string,
    characterId: string
  ): Promise<UserProgress> {
    const existing = this.rows.get(userId);
    if (existing) {
      existing.defaultCharacterId = characterId;
      existing.updatedAt = new Date();
      return { ...existing };
    }
    const row: UserProgress = {
      userId,
      xp: 0,
      defaultCharacterId: characterId,
      updatedAt: new Date(),
    };
    this.rows.set(userId, row);
    return { ...row };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createUserProgressStore(pool: Pool): UserProgressStore {
  return new PgUserProgressStore(pool);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _mapRow(r: {
  user_id: string;
  xp: number;
  default_character_id: string;
  updated_at: Date;
}): UserProgress {
  return {
    userId: r.user_id,
    xp: r.xp,
    defaultCharacterId: r.default_character_id,
    updatedAt: r.updated_at,
  };
}
