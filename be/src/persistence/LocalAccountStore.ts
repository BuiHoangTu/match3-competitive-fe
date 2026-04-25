/**
 * T-Local-02 · LocalAccountStore — username/password local accounts.
 *
 * Coexists with users + match_history. Provides:
 *   - register({username, email, password})    → userId
 *   - login({username, password})              → userId | null
 *   - findByUserId(userId)                     → AccountRow | null
 *
 * Postgres-backed (PgLocalAccountStore) and in-memory (InMemoryLocalAccountStore)
 * implementations both satisfy the same interface so unit tests don't need a DB.
 *
 * Password hashing: scrypt (Node built-in). Constant-time compare on verify.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Pool } from "pg";

export interface RegisterParams {
  username: string;
  email?: string;
  password: string;
  /**
   * Override generated user_id (used in tests for determinism). Production
   * callers should leave this undefined.
   */
  userId?: string;
}

export interface AccountRow {
  userId: string;
  username: string;
  email: string | null;
  createdAt: Date;
}

export interface LocalAccountStore {
  /** @throws DuplicateUsernameError if username taken. */
  register(params: RegisterParams): Promise<AccountRow>;
  /** Returns the userId on success, null on missing or wrong password. */
  login(username: string, password: string): Promise<string | null>;
  findByUserId(userId: string): Promise<AccountRow | null>;
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username already taken: ${username}`);
    this.name = "DuplicateUsernameError";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Password hashing helpers
// ──────────────────────────────────────────────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(password: string): {
  passwordHash: Buffer;
  salt: Buffer;
} {
  const salt = randomBytes(SALT_BYTES);
  const passwordHash = scryptSync(password, salt, SCRYPT_DKLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return { passwordHash, salt };
}

export function verifyPassword(
  password: string,
  salt: Buffer,
  expectedHash: Buffer
): boolean {
  const computed = scryptSync(password, salt, SCRYPT_DKLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  if (computed.length !== expectedHash.length) return false;
  return timingSafeEqual(computed, expectedHash);
}

// ──────────────────────────────────────────────────────────────────────────────
// Postgres implementation
// ──────────────────────────────────────────────────────────────────────────────

export class PgLocalAccountStore implements LocalAccountStore {
  constructor(private readonly pool: Pool) {}

  async register(params: RegisterParams): Promise<AccountRow> {
    const userId = params.userId ?? `local:${randomBytes(8).toString("hex")}`;
    const { passwordHash, salt } = hashPassword(params.password);
    try {
      const res = await this.pool.query<{
        user_id: string;
        username: string;
        email: string | null;
        created_at: Date;
      }>(
        `INSERT INTO local_accounts (user_id, username, email, password_hash, salt)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING user_id, username, email, created_at`,
        [userId, params.username, params.email ?? null, passwordHash, salt]
      );
      const row = res.rows[0];
      return {
        userId: row.user_id,
        username: row.username,
        email: row.email,
        createdAt: row.created_at,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        /unique|duplicate/i.test(err.message) &&
        /username/i.test(err.message)
      ) {
        throw new DuplicateUsernameError(params.username);
      }
      throw err;
    }
  }

  async login(username: string, password: string): Promise<string | null> {
    const res = await this.pool.query<{
      user_id: string;
      password_hash: Buffer;
      salt: Buffer;
    }>(
      `SELECT user_id, password_hash, salt
       FROM local_accounts WHERE username = $1`,
      [username]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    if (!verifyPassword(password, row.salt, row.password_hash)) return null;
    return row.user_id;
  }

  async findByUserId(userId: string): Promise<AccountRow | null> {
    const res = await this.pool.query<{
      user_id: string;
      username: string;
      email: string | null;
      created_at: Date;
    }>(
      `SELECT user_id, username, email, created_at
       FROM local_accounts WHERE user_id = $1`,
      [userId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      userId: row.user_id,
      username: row.username,
      email: row.email,
      createdAt: row.created_at,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// In-memory implementation (tests)
// ──────────────────────────────────────────────────────────────────────────────

interface MemoryRow extends AccountRow {
  passwordHash: Buffer;
  salt: Buffer;
}

export class InMemoryLocalAccountStore implements LocalAccountStore {
  private byUserId = new Map<string, MemoryRow>();
  private byUsername = new Map<string, string>();

  async register(params: RegisterParams): Promise<AccountRow> {
    if (this.byUsername.has(params.username)) {
      throw new DuplicateUsernameError(params.username);
    }
    const userId = params.userId ?? `local:${randomBytes(8).toString("hex")}`;
    const { passwordHash, salt } = hashPassword(params.password);
    const row: MemoryRow = {
      userId,
      username: params.username,
      email: params.email ?? null,
      createdAt: new Date(),
      passwordHash,
      salt,
    };
    this.byUserId.set(userId, row);
    this.byUsername.set(params.username, userId);
    const { passwordHash: _, salt: __, ...pub } = row;
    return pub;
  }

  async login(username: string, password: string): Promise<string | null> {
    const userId = this.byUsername.get(username);
    if (!userId) return null;
    const row = this.byUserId.get(userId);
    if (!row) return null;
    if (!verifyPassword(password, row.salt, row.passwordHash)) return null;
    return userId;
  }

  async findByUserId(userId: string): Promise<AccountRow | null> {
    const row = this.byUserId.get(userId);
    if (!row) return null;
    const { passwordHash: _, salt: __, ...pub } = row;
    return pub;
  }

  /** Test-only helper: clear all entries. */
  clear(): void {
    this.byUserId.clear();
    this.byUsername.clear();
  }
}
