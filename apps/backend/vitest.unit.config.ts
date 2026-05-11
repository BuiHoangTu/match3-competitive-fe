import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Phase D — Unit-only test config. Excludes anything that boots a Socket.IO
 * server, hits Postgres, or simulates network latency. Target: full suite ≤ 10 s.
 *
 * If you add a test that needs a live socket / HTTP / DB, place it in
 * vitest.integration.config.ts instead.
 *
 * The resolve aliases redirect @match3/shared-js/* imports to the TypeScript
 * source directly so tests run without needing a dist/ build step
 * (the compiled dist/ files are root-owned in the local dev environment).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@match3/shared-js/engine/rng": path.resolve(
        __dirname,
        "../../packages/shared-js/src/engine/rng.ts"
      ),
      "@match3/shared-js/engine/Board": path.resolve(
        __dirname,
        "../../packages/shared-js/src/engine/Board.ts"
      ),
      "@match3/shared-js/engine/MatchEngine": path.resolve(
        __dirname,
        "../../packages/shared-js/src/engine/MatchEngine.ts"
      ),
      "@match3/shared-js/bot/BotPlayer": path.resolve(
        __dirname,
        "../../packages/shared-js/src/bot/BotPlayer.ts"
      ),
      "@match3/shared-js/protocol": path.resolve(
        __dirname,
        "../../packages/shared-js/src/protocol.ts"
      ),
      "@match3/shared-js/engine/PlayerStats": path.resolve(
        __dirname,
        "../../packages/shared-js/src/engine/PlayerStats.ts"
      ),
      "@match3/shared-js/engine/TileType": path.resolve(
        __dirname,
        "../../packages/shared-js/src/engine/TileType.ts"
      ),
    },
  },
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
      "src/__tests__/userProgressStore.test.ts",
      "src/__tests__/authoritative-move.test.ts",
      // RateLimiter.test.ts is intentionally NOT excluded — pure unit test.
    ],
  },
});
