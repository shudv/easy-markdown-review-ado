import { defineConfig } from "vitest/config";

// Stryker-only Vitest config: runs ONLY the fast jsdom `unit` project.
// The `storybook` browser project (headless chromium) is far too slow and
// flaky to re-run for every mutant, so it's omitted here. Mirrors the `unit`
// project from vitest.config.ts.
export default defineConfig({
  test: {
    name: "unit",
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    globals: false,
  },
});
