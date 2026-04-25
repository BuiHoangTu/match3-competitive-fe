/**
 * T-v0.6-E07 · MatchHistoryStore — record completed matches.
 * T-v0.6-E09 · DB outage buffering — bounded in-memory queue with drop-oldest.
 *
 * PgMatchHistoryStore: real Postgres insert.
 * InMemoryMatchHistoryStore: used in unit tests without Postgres.
 *
 * BufferedMatchHistoryStore: wraps any MatchHistoryStore and adds a bounded
 * in-memory retry queue (cap = BUFFER_CAP, default 500) for DB outages.
 * On insert failure: enqueue. On next insert attempt: flush pending first.
 * Drop oldest beyond cap; increment match_history_buffer_dropped_total counter.
 */

import { getPool } from "../db";

export type MatchOutcome = "P1_WIN" | "P2_WIN" | "DRAW";

export interface InsertMatchParams {
  matchId: string;
  p1UserId: string | null;
  p2UserId: string | null;
  p1Score: number;
  p2Score: number;
  outcome: MatchOutcome;
  durationMs: number;
  endedAt?: Date;
}

export interface MatchHistoryRow {
  matchId: string;
  p1UserId: string | null;
  p2UserId: string | null;
  p1Score: number;
  p2Score: number;
  outcome: MatchOutcome;
  durationMs: number;
  endedAt: Date;
}

export interface MatchHistoryStore {
  insert(params: InsertMatchParams): Promise<void>;

  /**
   * Return up to `limit` rows for the given userId (either slot), ordered
   * newest first. Used by the GET /user/history endpoint.
   */
  listForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<MatchHistoryRow[]>;

  /**
   * Anonymise all rows where userId appears. Replace userId with a tombstone.
   * Called inside the GDPR deletion transaction.
   */
  anonymise(userId: string, tombstone: string): Promise<void>;
}

// ─── Postgres implementation ──────────────────────────────────────────────────

export class PgMatchHistoryStore implements MatchHistoryStore {
  async insert(params: InsertMatchParams): Promise<void> {
    const {
      matchId,
      p1UserId,
      p2UserId,
      p1Score,
      p2Score,
      outcome,
      durationMs,
      endedAt = new Date(),
    } = params;
    await getPool().query(
      `INSERT INTO match_history
         (match_id, p1_user_id, p2_user_id, p1_score, p2_score, outcome, duration_ms, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (match_id) DO NOTHING`,
      [matchId, p1UserId, p2UserId, p1Score, p2Score, outcome, durationMs, endedAt]
    );
  }

  async listForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<MatchHistoryRow[]> {
    const result = await getPool().query<{
      match_id: string;
      p1_user_id: string | null;
      p2_user_id: string | null;
      p1_score: number;
      p2_score: number;
      outcome: MatchOutcome;
      duration_ms: number;
      ended_at: Date;
    }>(
      `SELECT match_id, p1_user_id, p2_user_id, p1_score, p2_score,
              outcome, duration_ms, ended_at
         FROM match_history
        WHERE p1_user_id = $1 OR p2_user_id = $1
        ORDER BY ended_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows.map((r) => ({
      matchId: r.match_id,
      p1UserId: r.p1_user_id,
      p2UserId: r.p2_user_id,
      p1Score: r.p1_score,
      p2Score: r.p2_score,
      outcome: r.outcome,
      durationMs: r.duration_ms,
      endedAt: r.ended_at,
    }));
  }

  async anonymise(userId: string, tombstone: string): Promise<void> {
    await getPool().query(
      `UPDATE match_history
          SET p1_user_id = $2
        WHERE p1_user_id = $1`,
      [userId, tombstone]
    );
    await getPool().query(
      `UPDATE match_history
          SET p2_user_id = $2
        WHERE p2_user_id = $1`,
      [userId, tombstone]
    );
  }
}

// ─── In-memory implementation (for unit tests) ───────────────────────────────

export class InMemoryMatchHistoryStore implements MatchHistoryStore {
  /** Exposed for assertions in tests. */
  readonly rows: Map<string, MatchHistoryRow> = new Map();

  async insert(params: InsertMatchParams): Promise<void> {
    if (this.rows.has(params.matchId)) return; // idempotent
    this.rows.set(params.matchId, {
      matchId: params.matchId,
      p1UserId: params.p1UserId,
      p2UserId: params.p2UserId,
      p1Score: params.p1Score,
      p2Score: params.p2Score,
      outcome: params.outcome,
      durationMs: params.durationMs,
      endedAt: params.endedAt ?? new Date(),
    });
  }

  async listForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<MatchHistoryRow[]> {
    const all = [...this.rows.values()]
      .filter((r) => r.p1UserId === userId || r.p2UserId === userId)
      .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
    return all.slice(offset, offset + limit);
  }

  async anonymise(userId: string, tombstone: string): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.p1UserId === userId) row.p1UserId = tombstone;
      if (row.p2UserId === userId) row.p2UserId = tombstone;
    }
  }
}

// ─── Buffered wrapper (T-v0.6-E09) ───────────────────────────────────────────

const BUFFER_CAP = 500;

/** Metric counter — intentionally module-level so it persists across calls. */
export let match_history_buffer_dropped_total = 0;

/** Reset the drop counter (for test isolation). */
export function resetDropCounter(): void {
  match_history_buffer_dropped_total = 0;
}

export class BufferedMatchHistoryStore implements MatchHistoryStore {
  private readonly pending: InsertMatchParams[] = [];
  private readonly cap: number;

  constructor(
    private readonly inner: MatchHistoryStore,
    cap: number = BUFFER_CAP
  ) {
    this.cap = cap;
  }

  /** Number of pending (buffered but not yet persisted) inserts. */
  get pendingCount(): number {
    return this.pending.length;
  }

  async insert(params: InsertMatchParams): Promise<void> {
    // Try to flush any pending inserts first (best-effort recovery).
    await this._flushPending();

    try {
      await this.inner.insert(params);
    } catch (err) {
      this._enqueue(params);
      console.error(
        `[match_history] DB error, buffered insert for ${params.matchId}:`,
        (err as Error).message
      );
    }
  }

  async listForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<MatchHistoryRow[]> {
    return this.inner.listForUser(userId, limit, offset);
  }

  async anonymise(userId: string, tombstone: string): Promise<void> {
    return this.inner.anonymise(userId, tombstone);
  }

  /** Attempt to flush all pending rows to the inner store. */
  private async _flushPending(): Promise<void> {
    if (this.pending.length === 0) return;
    const toFlush = this.pending.splice(0);
    for (const item of toFlush) {
      try {
        await this.inner.insert(item);
      } catch {
        // DB still down — put it back (at the front to preserve order).
        this._enqueue(item, true);
      }
    }
  }

  private _enqueue(params: InsertMatchParams, front = false): void {
    if (front) {
      this.pending.unshift(params);
    } else {
      this.pending.push(params);
    }
    // Drop oldest if over cap.
    while (this.pending.length > this.cap) {
      this.pending.shift();
      match_history_buffer_dropped_total++;
      console.warn(
        `[match_history] buffer cap reached — dropping oldest insert. ` +
          `match_history_buffer_dropped_total=${match_history_buffer_dropped_total}`
      );
    }
  }
}
