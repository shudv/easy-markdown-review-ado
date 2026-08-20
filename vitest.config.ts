import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

// Absolute path to the custom reporter that prints only the uncovered lines
// and branches (see below).
const uncoveredReporter = fileURLToPath(
  new URL("./scripts/uncovered-coverage-reporter.cjs", import.meta.url),
);

// Two test surfaces share one coverage report (v8 merges them):
//
//   * "unit"      — fast jsdom tests of pure logic + hooks (test/**).
//   * "storybook" — the presentational components rendered for real in a
//                   headless chromium via @storybook/addon-vitest, so the
//                   `*.tsx` files count towards coverage instead of being
//                   blanket-excluded. Functional/logic tests stay in the
//                   unit project against jsdom.
//
// Coverage config lives at the root so it applies to both projects.
export default defineConfig({
  test: {
    reporters: ["default"],
    coverage: {
      provider: "v8",
      // `cobertura` is consumed by the Azure DevOps
      // `PublishCodeCoverageResults@2` task; `lcov` powers the VS Code
      // coverage gutter; `html` is for local triage. `text-summary` prints
      // the compact totals block, and the custom reporter below lists the
      // exact uncovered lines/branches — replacing the wide per-file
      // percentage table, which was noise once everything is at/near 100%.
      reporter: [
        "text-summary",
        [uncoveredReporter, {}],
        "html",
        "lcov",
        "cobertura",
        "json-summary",
      ],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Type-only declaration files.
        "src/**/*.d.ts",
        "src/**/*.html",
        // The stories + Storybook glue are test fixtures, not product code.
        "src/**/*.stories.tsx",
        ".storybook/**",
        // Fixture data — static literals with no branches.
        "src/comments/fixtures.ts",
        // Type-only shapes.
        "src/types.ts",
        "src/shell/types.ts",
        "src/globals.d.ts",
        // Telemetry sink implementations are thin vendor/IO adapters
        "src/telemetry/*",
        // SDK-coupled top-level modules. Their pure logic is
        // extracted into `*.helpers.ts` siblings which ARE covered;
        // the residue is glue that loads `azure-devops-extension-api`
        // (AMD-only, can't be evaluated by node).
        "src/shell/adoGitData.ts",
        "src/shell/adoCommentApi.ts",
        "src/shell/adoAttachmentMedia.ts",
        "src/shell/adoRepositoryImages.ts",
        "src/shell/commentHousing.ts",
        "src/shell/commentPermission.ts",
        "src/editing/adoDocEdit.ts",
        // Build-time `?raw` CSS imports — a webpack-specific loader query that
        // vitest does not resolve.
        "src/theme/markdownStyles.ts",
        // SDK-coupled React containers + boot entry points. These mount in
        // the host iframe with live SDK auth (azure-devops-extension-sdk);
        // they can't render in the Storybook/jsdom harness, so their pure
        // logic is extracted into covered helpers and the shells stay out.
        "src/pr-tab/pr-tab.tsx",
        "src/pr-tab/PrTabApp.tsx",
        "src/hub/DocumentsApp.tsx",
        "src/hub/DocumentsHubApp.tsx",
        "src/hub/markdownReader.tsx",
        "src/hub/markdownReviewHub.tsx",
      ],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        // Every branch is either covered by a test or carries a `/* v8 ignore
        // … */` with a rationale, so the gate is a full 100%. Keep it here: a
        // new uncovered branch must be tested or explicitly ignored, never
        // waved through by lowering this number.
        branches: 100,
      },
    },
    projects: [
      {
        // Pure-logic + hook tests against jsdom. Unchanged from the
        // original single-config setup.
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          globals: false,
        },
      },
      {
        // Stories rendered for real in headless chromium. The
        // storybookTest plugin discovers `*.stories.tsx`, mounts each
        // story, and runs its `play` (if any) as a test.
        extends: true,
        plugins: [storybookTest({ configDir: ".storybook" })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            // Vitest 4 takes a provider factory (was a string in v3).
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
