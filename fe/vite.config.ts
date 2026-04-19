import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  server: {
    fs: {
      // Allow the dev server to serve files from the monorepo root
      // (needed so fe/ can import from shared/)
      allow: [path.resolve(__dirname, "..")],
    },
  },
  test: {
    environment: "node",
  },
});
