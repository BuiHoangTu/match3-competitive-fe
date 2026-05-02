import { defineConfig } from "vitest/config";

/**
 * Phase D — Integration tests. Each spins up a real Socket.IO server (and,
 * for account-deletion / persistenceHttp, a Postgres if DATABASE_URL is set).
 * Slow but high-fidelity. Run separately from the unit suite to keep CI
 * feedback fast on every PR.
 */
export default defineConfig({
  test: {
    include: [
      "src/__tests__/no-desync.test.ts",
      "src/__tests__/latency-harness.test.ts",
      "src/__tests__/rejoin-latency.test.ts",
      "src/__tests__/account_deletion.test.ts",
      "src/__tests__/persistenceHttp.test.ts",
      "src/__tests__/matchmakingHttp.test.ts",
      "src/__tests__/localAuth.test.ts",
      "src/__tests__/auth.test.ts",
    ],
    testTimeout: 90_000,
  },
});
