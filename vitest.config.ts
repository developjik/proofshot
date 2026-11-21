import { defineConfig } from "vitest/config";

export default defineConfig({
  // Some sandboxes have no /etc/hosts, so "localhost" does not resolve. Pin the
  // dev server and the vitest API to a literal loopback address.
  server: { host: "127.0.0.1" },
  test: {
    api: { host: "127.0.0.1" },
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Screenshots are pixel comparisons; run E2E files one at a time.
    fileParallelism: false,
  },
});
