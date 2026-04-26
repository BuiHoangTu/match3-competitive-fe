/**
 * db.ts — PostgreSQL connection pool and query helper.
 *
 * Exposes a singleton pg.Pool initialised from DATABASE_URL. Call
 * `getPool()` from repository functions; never import `pg` directly in
 * business logic.
 *
 * Shutdown: when SIGTERM arrives the pool is drained gracefully so
 * in-flight queries finish before the process exits.
 */

import { Pool, type QueryResultRow, type PoolConfig } from "pg";

// -------------------------------------------------------------------
// Pool creation
// -------------------------------------------------------------------

let _pool: Pool | null = null;

/**
 * Returns the singleton Pool, creating it on first call.
 * Throws if DATABASE_URL is not set (fail-fast rather than silent no-op).
 */
export function getPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Copy be/.env.example to be/.env and set a valid connection string."
    );
  }

  const config: PoolConfig = {
    connectionString,
    max: Number(process.env.DB_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  _pool = new Pool(config);

  // Log unexpected pool errors so they are not silently swallowed.
  _pool.on("error", (err) => {
    // Log without PII — the error message from pg may include query text
    // but never contains user data with our parameterised queries.
    console.error("[db] pool error:", err.message);
  });

  return _pool;
}

// -------------------------------------------------------------------
// Query helper
// -------------------------------------------------------------------

/**
 * Execute a parameterised query and return the result rows, typed.
 * NEVER string-interpolate user data into `sql`; always use `$1`, `$2`, …
 * placeholders and pass values as `params`.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

// -------------------------------------------------------------------
// Graceful shutdown
// -------------------------------------------------------------------

/**
 * Drain the pool and resolve when all clients have been released.
 * Called during SIGTERM to avoid leaving open connections.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// Register the SIGTERM hook once at module load time.
// The handler is idempotent — calling closePool() twice is safe.
process.once("SIGTERM", () => {
  closePool().catch((err: unknown) => {
    console.error("[db] error during pool shutdown:", (err as Error).message);
  });
});

// -------------------------------------------------------------------
// Test utilities
// -------------------------------------------------------------------

/**
 * Replace the pool with a custom instance (e.g. in tests that provide
 * their own pool pointing at a test DB). Pass `null` to force recreation
 * from DATABASE_URL on the next `getPool()` call.
 */
export function _setPool(pool: Pool | null): void {
  _pool = pool;
}
