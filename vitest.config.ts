import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "bench/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Several test files launch Chromium. Running them in parallel exhausts the
    // machine and turns 10s hooks into timeouts, so files run one at a time.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**"],
      // The runtime and its write path are the safety-critical code. Other
      // packages have their own tests but no enforced floor yet.
      thresholds: {
        "packages/runtime/src/**": {
          lines: 80,
          statements: 80,
          functions: 80,
        },
      },
    },
  },
});
