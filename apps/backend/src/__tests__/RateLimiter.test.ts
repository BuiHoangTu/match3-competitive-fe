/**
 * Unit tests for RateLimiter — clock-injected, no real time.
 */

import { describe, expect, it } from "vitest";
import { RateLimiter } from "../RateLimiter";

function makeLimiter(opts?: { limit?: number; windowMs?: number; evictAfterMs?: number }) {
  let t = 0;
  const now = () => t;
  const advance = (ms: number) => { t += ms; };
  const limiter = new RateLimiter({
    limit: opts?.limit ?? 5,
    windowMs: opts?.windowMs ?? 60_000,
    evictAfterMs: opts?.evictAfterMs ?? 300_000,
    nowMs: now,
  });
  return { limiter, advance };
}

describe("RateLimiter — under limit", () => {
  it("allows requests up to the limit", () => {
    const { limiter, advance } = makeLimiter({ limit: 3, windowMs: 60_000 });
    // All 3 within window should pass.
    for (let i = 0; i < 3; i++) {
      advance(100);
      expect(limiter.check("1.2.3.4").allowed).toBe(true);
    }
  });
});

describe("RateLimiter — at limit", () => {
  it("rejects the (limit+1)th request within the window", () => {
    const { limiter, advance } = makeLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      advance(100);
      expect(limiter.check("1.2.3.4").allowed).toBe(true);
    }
    advance(100);
    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSecs).toBeGreaterThan(0);
  });

  it("retryAfterSecs reflects time until oldest request exits the window", () => {
    const { limiter, advance } = makeLimiter({ limit: 2, windowMs: 60_000 });
    advance(1000); // t = 1000: first request
    limiter.check("ip");
    advance(5000); // t = 6000: second request
    limiter.check("ip");
    advance(1000); // t = 7000: third request — blocked
    const result = limiter.check("ip");
    expect(result.allowed).toBe(false);
    // Oldest request was at t=1000. Window ends at 1000+60000=61000. Now=7000.
    // retryAfterMs = 61000 - 7000 = 54000 → 54 s.
    expect(result.retryAfterSecs).toBe(54);
  });
});

describe("RateLimiter — window slides", () => {
  it("allows new requests after the window has passed the oldest entry", () => {
    const { limiter, advance } = makeLimiter({ limit: 3, windowMs: 10_000 });
    // Fill to limit.
    advance(1000);
    limiter.check("ip");
    advance(1000);
    limiter.check("ip");
    advance(1000);
    limiter.check("ip");
    // One more should be blocked.
    advance(100);
    expect(limiter.check("ip").allowed).toBe(false);
    // Advance past the first request's window expiry (t=1000, window=10s → expires at 11000).
    // Current t = 3100; need to reach > 11000.
    advance(8000); // t = 11100 — first request (at t=1000) is now outside the 10s window.
    expect(limiter.check("ip").allowed).toBe(true);
  });
});

describe("RateLimiter — per-IP isolation", () => {
  it("buckets are independent per IP", () => {
    const { limiter, advance } = makeLimiter({ limit: 2, windowMs: 60_000 });
    advance(100);
    limiter.check("10.0.0.1");
    advance(100);
    limiter.check("10.0.0.1");
    // 10.0.0.1 is now at limit — 10.0.0.2 is not.
    advance(100);
    expect(limiter.check("10.0.0.1").allowed).toBe(false);
    expect(limiter.check("10.0.0.2").allowed).toBe(true);
  });
});

describe("RateLimiter — eviction", () => {
  it("evicts idle buckets after evictAfterMs", () => {
    const { limiter, advance } = makeLimiter({
      limit: 5,
      windowMs: 60_000,
      evictAfterMs: 300_000,
    });
    advance(100);
    limiter.check("idle-ip");
    expect(limiter.size).toBe(1);
    // Advance past evictAfterMs without touching "idle-ip".
    advance(300_001);
    // Trigger eviction by inserting a new IP.
    limiter.check("active-ip");
    expect(limiter.size).toBe(1); // idle-ip was evicted; only active-ip remains
  });
});

describe("RateLimiter — default config mirrors auth endpoint spec", () => {
  it("limit=5 windowMs=60s matches the spec", () => {
    const { limiter, advance } = makeLimiter({ limit: 5, windowMs: 60_000 });
    // 5 requests should pass.
    for (let i = 0; i < 5; i++) {
      advance(500);
      expect(limiter.check("attacker").allowed).toBe(true);
    }
    // 6th should be blocked.
    advance(500);
    expect(limiter.check("attacker").allowed).toBe(false);
  });
});
