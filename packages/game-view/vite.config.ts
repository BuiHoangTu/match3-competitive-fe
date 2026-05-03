import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  base: "/game/",
  resolve: {
    // Resolve @match3/shared-js subpath imports straight to source TypeScript
    // so the rollup build doesn't have to interpret the CJS dist (which would
    // require named-export inference rollup can't do statically).
    alias: [
      {
        find: /^@match3\/shared-js\/(.+?)(?:\.js)?$/,
        replacement: path.resolve(__dirname, "../shared-js/src") + "/$1.ts",
      },
    ],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  test: {
    environment: "node",
  },
});
