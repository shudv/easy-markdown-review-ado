import type { StorybookConfig } from "@storybook/react-vite";

// Storybook drives two things in this repo:
//   1. `npm run storybook` — a visual workbench for the presentational
//      components (the `*.tsx` under src/shell/components, plus the theme
//      picker and the shell itself).
//   2. `@storybook/addon-vitest` — runs those same stories as Vitest
//      *browser* tests (Playwright/chromium) so the components count
//      towards coverage. See vitest.config.ts (the "storybook" project).
//
// The production bundle still ships via webpack (webpack.config.cjs); Vite
// is only used for the Storybook builder + the browser test project.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // No anonymous usage telemetry / version checks from CI or local runs.
  core: {
    disableTelemetry: true,
  },
};

export default config;
