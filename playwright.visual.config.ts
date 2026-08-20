// Playwright config for the CURATED VISUAL-REGRESSION suite.
//
// WHY separate from playwright.config.ts (the real-ADO inner loop): this suite
// never touches ADO, auth, or the network. It screenshots a small, curated set
// of DETERMINISTIC Storybook stories — presentational components plus two rich
// integration stories (the PR tab and the Documents hub, fed fake fixtures) —
// and compares them against committed per-platform baselines with a tight
// tolerance. It's the visual analogue of the e2e inner loop: a small, high-signal
// set that guards against CSS/layout regressions.
//
// SINGLE-ENVIRONMENT NOTE (important): Chromium does NOT rasterize pixel-
// identically across operating systems — text anti-aliasing is done by the OS
// font stack (DirectWrite/Windows, FreeType/Linux, CoreText/macOS). So instead
// of a baseline per platform, this suite renders in ONE fixed environment
// everywhere: the pinned `mcr.microsoft.com/playwright:v1.61.1-jammy` container.
// CI runs the job inside it, and contributors regenerate baselines by running
// the SAME image locally (`npm run test:visual:update`, a thin Docker wrapper).
// Renders are byte-identical, so a SINGLE committed baseline set
// (`<name>-<project>.png`) suffices. See visual/README.md.
//
//   npm run test:visual:docker   # compare in the container (local)
//   npm run test:visual:update   # regenerate the single baseline set (Docker)

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.EMR_VISUAL_PORT ?? 6007);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./visual",
  testMatch: /.*\.visual\.spec\.ts/,
  // Screenshots must be stable frame-to-frame, so run serially and never retry
  // into a "flaky pass" — a diff is a real signal.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    // Tight tolerance. A few stray pixels (sub-pixel rounding at box edges) are
    // tolerated; anything larger is a real regression. Rendering always happens
    // in the one pinned container, so there is no cross-OS font-AA noise to
    // absorb and this can stay tight.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      // Per-pixel channel threshold — small enough to catch a colour shift in a
      // diff wash, large enough to ignore last-bit AA noise in the container.
      threshold: 0.15,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  // Baselines live next to the spec. A SINGLE set (no `{platform}`) because the
  // suite always renders in the pinned Playwright container — see the note atop
  // this file.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-visual" }],
  ],
  use: {
    baseURL: BASE_URL,
    // A fixed, deterministic rendering environment. Lock everything that could
    // shift a pixel: size, DPR, colour scheme, locale, timezone, motion. The
    // width is generous so the full reader + comment rail fit without clipping.
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // Build (if needed) + serve the static Storybook. `reuseExistingServer`
    // keeps local iteration fast; CI always starts fresh.
    command: "node scripts/serve-storybook.mjs",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // `devices["Desktop Chrome"]` carries its own 1280x720 viewport, which
        // would override the top-level `use.viewport`. Re-assert the generous
        // size here so the full reader + comment rail are captured.
        viewport: { width: 1600, height: 900 },
        contextOptions: { reducedMotion: "reduce" },
      },
    },
  ],
});
