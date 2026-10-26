// Playwright config for the end-to-end "inner loop".
//
// These tests run the REAL extension against a REAL Azure DevOps collection.
// That is the only environment that faithfully reproduces the host behaviours
// our unit tests and standalone previews can't: custom-dialog sizing, the
// cross-origin iframe focus model, and app-bar repo-switch routing.
//
// How it fits together:
//   1. `npm run dev:verify` serves the extension bundles from
//      https://localhost:3000 (the dev extension's `baseUri`) under a strict,
//      production-representative CSP. The `webServer` block below starts it
//      automatically (or reuses one already running), and e2e enforces that it
//      is the strict server (see e2e/global-setup.ts).
//   2. The dev extension (id = `<manifest.id>-<AZDO_DEV_ID_SUFFIX>`, e.g.
//      `emr-devlocal`) is installed/shared into the sandbox
//      org, so ADO loads those local bundles inside real iframes.
//   3. Playwright drives a real browser through ADO and asserts on the live
//      contribution iframes.
//
// First-time setup and the full runbook live in `e2e/README.md`.

import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Minimal .env loader (no dotenv dependency). Only sets keys not already in
// the environment, so real env vars / CI secrets always win.
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const ORG_URL = (
  process.env.AZDO_ORG_URL ?? "https://dev.azure.com/your-org"
).replace(/\/$/, "");
export const AUTH_STATE = resolve(__dirname, "e2e/.auth/state.json");
const DEV_ORIGIN = (
  process.env.AZDO_E2E_DEV_ORIGIN ?? "https://localhost:3000"
).replace(/\/$/, "");

export default defineConfig({
  testDir: "./e2e",
  // Starts the STRICT verification dev server (`npm run dev:verify`) when
  // nothing is answering on the dev origin, and stops it after the run. An
  // already-running server is reused, so a long-lived `dev:verify` terminal
  // still works. Playwright starts this before `globalSetup`, which then
  // rejects a reused non-strict server (e.g. `dev:https`).
  webServer: {
    command: "npm run dev:verify",
    url: `${DEV_ORIGIN}/pr-tab/pr-tab.html`,
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    // Log telemetry through the console sink so specs can assert on events
    // (e.g. e2e/reconnect.spec.ts). A reused server started without it simply
    // skips those assertions.
    env: { TELEMETRY_DEBUG: "1" },
  },
  // Fail fast unless the STRICT verification dev server (`npm run dev:verify`)
  // is serving the bundles: e2e runs the real app inside a real ADO iframe, so
  // we exercise it under the same production-representative CSP the host
  // imposes (no inline script, no eval). See e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  // The host is a real network service; give navigations and the iframe
  // handshake room to breathe, but fail fast on a wedged assertion.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: ORG_URL,
    // ADO uses a self-signed cert for nothing, but our dev server does — and
    // the contribution iframes are served from https://localhost:3000.
    ignoreHTTPSErrors: true,
    // Chromium's "Local Network Access" check blocks a public origin
    // (dev.azure.com) from loading our localhost:3000 iframes. Rather than
    // disable that check for every site, specs import `test` from
    // e2e/fixtures.ts, which grants the permission to the ADO org origin only
    // — the same scoped grant `npm run dev:ado` gives a developer's browser.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // One-time interactive login that persists the auth cookies. Re-running is
    // a cheap no-op once a fresh state file exists. Its own generous timeout
    // overrides the global 90s cap so a human has time to complete the sign-in
    // (incl. MFA) — the test polls up to 5 min for the ADO chrome to appear.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      timeout: 6 * 60_000,
      // Always headed: the login may require interactive MFA, and a silently
      // headless setup (e.g. when run as the `chromium` dependency) would give
      // the human no window to complete sign-in.
      use: { headless: false },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_STATE,
      },
    },
  ],
});
