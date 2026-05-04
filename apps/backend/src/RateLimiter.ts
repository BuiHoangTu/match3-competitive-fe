/**
 * Simple in-memory sliding-window rate limiter keyed by string (IP address).
 *
 * Design:
 *  - Per-key bucket: array of request timestamps within the current window.
 *  - On each request: evict timestamps older than windowMs, then check count.
 *  - Eviction sweep: idle buckets older than evictAfterMs are culled on insert
 *    so memory stays bounded on a single-host deploy with potentially many IPs.
 *  - Clock injection: accepts a `nowMs` function so vitest can advance time
 *    deterministically.
 */

export interface RateLimiterOptions {
  /** Max requests allowed within windowMs. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /**
   * Evict buckets that have had no requests for this many ms.
   * Defaults to 5 * windowMs.
   */
  evictAfterMs?: number;
  /** Injectable clock. Defaults to Date.now. */
  nowMs?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After header). */
  retryAfterSecs: number;
}

interface Bucket {
  /** Timestamps (ms) of recent requests within the window. */
  timestamps: number[];
  /** Last request time (ms). Used to cull idle buckets. */
  lastSeen: number;
}

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly evictAfterMs: number;
  private readonly _now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: RateLimiterOptions) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.evictAfterMs = opts.evictAfterMs ?? opts.windowMs * 5;
    this._now = opts.nowMs ?? (() => Date.now());
  }

  /**
   * Record a request for `key`. Returns whether the request is allowed.
   */
  check(key: string): RateLimitResult {
    const now = this._now();
    this._evictStaleBuckets(now);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [], lastSeen: now };
      this.buckets.set(key, bucket);
    }

    // Slide the window: discard timestamps older than windowMs.
    const windowStart = now - this.windowMs;
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
    bucket.lastSeen = now;

    if (bucket.timestamps.length >= this.limit) {
      // Retry-After: time until the oldest request in the window expires.
      const oldestInWindow = bucket.timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return {
        allowed: false,
        retryAfterSecs: Math.ceil(retryAfterMs / 1000),
      };
    }

    bucket.timestamps.push(now);
    return { allowed: true, retryAfterSecs: 0 };
  }

  /** Evict buckets that haven't been touched in evictAfterMs. */
  private _evictStaleBuckets(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeen > this.evictAfterMs) {
        this.buckets.delete(key);
      }
    }
  }

  /** Number of tracked buckets (test/observability helper). */
  get size(): number {
    return this.buckets.size;
  }

  /** Clear all buckets. Intended for test teardown only. */
  clear(): void {
    this.buckets.clear();
  }
}
