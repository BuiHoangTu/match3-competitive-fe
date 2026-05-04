import { defineConfig } from "vitest/config";

/**
 * Phase D — Unit-only test config. Excludes anything that boots a Socket.IO
 * server, hits Postgres, or simulates network latency. Target: full suite ≤ 10 s.
 *
 * If you add a test that needs a live socket / HTTP / DB, place it in
 * vitest.integration.config.ts instead.
 */
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: [
      "src/__tests__/no-desync.test.ts",
      "src/__tests__/latency-harness.test.ts",
      "src/__tests__/rejoin-latency.test.ts",
      "src/__tests__/account_deletion.test.ts",
      "src/__tests__/persistenceHttp.test.ts",
      "src/__tests__/matchmakingHttp.test.ts",
      "src/__tests__/localAuth.test.ts",
      "src/__tests__/auth.test.ts",
      // RateLimiter.test.ts is intentionally NOT excluded — pure unit test.
    ],
  },
});
