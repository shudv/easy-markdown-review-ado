// `npm run dev:ado` — open Azure DevOps in a dedicated dev browser that can
// load the dev extension's localhost bundles, with no manual browser setup.
//
// Why this exists: the dev extension's `baseUri` is https://localhost:3000, so
// ADO (a public site) embeds iframes served from your machine. Chromium-based
// browsers now enforce Local Network Access (LNA): a public page may not load
// anything from localhost/LAN unless the user granted that site the "local
// network access" permission. Without it the dev tabs spin forever ("… is
// taking longer than expected to load") and the console shows
// net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS. Managed Edge/Chrome policy
// can also make that per-site setting unavailable.
//
// Rather than have every dev disable LNA (which would expose localhost/LAN to
// EVERY site) or fiddle with site settings, this launcher:
//   1. reuses the dev server on https://localhost:3000, or starts one;
//   2. opens Edge (else Chrome, else Playwright's Chromium) in a DEDICATED
//      profile outside the repo — your everyday browser is untouched;
//   3. grants "local network access" to the ADO org origin ONLY (e.g.
//      https://dev.azure.com) — every other site keeps the default block;
//   4. reuses the `npm run e2e:auth` login on the profile's first launch where
//      the browser accepts it (else you sign in once; the profile remembers).
// TLS validation stays on (`npm run setup:cert` makes the dev cert trusted).
//
// Usage:
//   npm run dev:ado                  # open the sandbox project
//   npm run dev:ado -- <ado-url>     # open a specific PR / page
//   npm run dev:ado -- --strict      # start `dev:verify` (prod-like CSP, no HMR)
//                                    #   instead of `dev:https` (hot reload)
//   npm run dev:ado -- --browser=chrome   # msedge | chrome | chromium
//   npm run dev:ado -- --check       # headless smoke test of the whole setup
//
// Config comes from `.env` (the same keys the e2e suite uses): AZDO_ORG_URL,
// AZDO_E2E_PROJECT / AZDO_TEST_PROJECT, AZDO_E2E_DEV_ORIGIN, and
// AZDO_E2E_EXTENSION_ID or AZDO_PUBLISHER_ID + AZDO_DEV_ID_SUFFIX (for --check).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get } from "node:https";
import os from "node:os";
import path from "node:path";
import { getCACertificates } from "node:tls";

import { chromium } from "@playwright/test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const AUTH_STATE = path.join(REPO_ROOT, "e2e", ".auth", "state.json");

/** Chromium's permission name for Local Network Access. */
const LNA_PERMISSION = "local-network-access";
const BROWSERS = ["msedge", "chrome", "chromium"];

/** A failure with an actionable message (printed without a stack trace). */
class SetupError extends Error {}

/** The dev server this run started (stopped again on exit), if any. */
let startedServer = null;

function log(message) {
  console.log(`[dev:ado] ${message}`);
}

function env(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function firstLine(err) {
  return String(err?.message ?? err).split("\n")[0];
}

// ---------------------------------------------------------------- config ---

const USAGE = `Open Azure DevOps in a dev browser that can load the dev extension
from https://localhost:3000 (see e2e/README.md › "Trying the dev extension by hand").

  npm run dev:ado                       open the sandbox project
  npm run dev:ado -- <ado-url>          open a specific PR / page
  npm run dev:ado -- --check            headless check that the setup works
                                        (needs a login: npm run e2e:auth)
  npm run dev:ado -- --strict           start dev:verify (prod CSP, no hot reload)
                                        instead of dev:https (hot reload)
  npm run dev:ado -- --browser=chrome   msedge | chrome | chromium
                                        (default: first one installed)
  npm run dev:ado -- --help             show this help

Reuses a dev server already on :3000. The browser uses its own profile
(sign in once if asked); delete that folder (printed on launch) to reset it.`;

const FLAGS = ["--check", "--strict", "--help", "-h"];

function readConfig(argv) {
  const unknown = argv.filter(
    (a) =>
      a.startsWith("-") && !FLAGS.includes(a) && !a.startsWith("--browser="),
  );
  if (unknown.length > 0) {
    throw new SetupError(`Unknown option ${unknown.join(", ")}.\n\n${USAGE}`);
  }
  const browser = argv.find((a) => a.startsWith("--browser="))?.split("=")[1];
  if (browser && !BROWSERS.includes(browser)) {
    throw new SetupError(
      `Unknown --browser=${browser}; use ${BROWSERS.join(", ")}.`,
    );
  }
  const orgUrl = env("AZDO_ORG_URL", "").replace(/\/+$/, "");
  if (!orgUrl || orgUrl.includes("your-org")) {
    throw new SetupError(
      "Set AZDO_ORG_URL in .env first (see e2e/README.md, step 1).",
    );
  }
  const project = encodeURIComponent(
    env(
      "AZDO_E2E_PROJECT",
      env("AZDO_TEST_PROJECT", "markdown-review-sandbox-v2"),
    ),
  );
  const extensionId = env(
    "AZDO_E2E_EXTENSION_ID",
    `${env("AZDO_PUBLISHER_ID", "your-publisher")}.emr-${env(
      "AZDO_DEV_ID_SUFFIX",
      "devlocal",
    )}`,
  );
  return {
    check: argv.includes("--check"),
    strict: argv.includes("--strict"),
    browsers: browser ? [browser] : BROWSERS,
    orgUrl,
    orgOrigin: new URL(orgUrl).origin,
    devOrigin: env("AZDO_E2E_DEV_ORIGIN", "https://localhost:3000").replace(
      /\/+$/,
      "",
    ),
    extensionId,
    hubUrl: `${orgUrl}/${project}/_apps/hub/${extensionId}.documents-hub`,
    targetUrl: argv.find((a) => !a.startsWith("--")) ?? `${orgUrl}/${project}`,
  };
}

/** Dedicated per-browser profile, kept outside the repo. */
function profileDir(browser) {
  const base =
    process.env.LOCALAPPDATA ??
    process.env.XDG_CACHE_HOME ??
    path.join(os.homedir(), ".cache");
  return env(
    "EMR_DEV_BROWSER_PROFILE",
    path.join(base, "easy-markdown-review", `dev-browser-${browser}`),
  );
}

// ------------------------------------------------------------ dev server ---

/** Probe the dev server; resolves `null` when nothing answers. */
function probeDevServer(devOrigin) {
  return new Promise((resolve) => {
    // Include the OS trust store where setup:cert installs the dev certificate.
    const req = get(
      `${devOrigin}/pr-tab/pr-tab.html`,
      {
        ca: [...getCACertificates("default"), ...getCACertificates("system")],
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode ?? 0,
          strict: Boolean(res.headers["content-security-policy"]),
        });
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => req.destroy());
  });
}

async function ensureDevServer(config) {
  const running = await probeDevServer(config.devOrigin);
  if (running) {
    log(
      `Reusing the dev server at ${config.devOrigin} (${
        running.strict ? "strict, no hot reload" : "hot reload"
      }).`,
    );
    return;
  }
  const script = config.strict ? "dev:verify" : "dev:https";
  log(`Starting \`npm run ${script}\` (the first build takes a minute)…`);
  startedServer = spawn("npm", ["run", script], {
    cwd: REPO_ROOT,
    stdio: config.check ? "ignore" : "inherit",
    shell: true,
    // Its own process group on POSIX, so the whole server tree can be stopped.
    detached: process.platform !== "win32",
  });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (startedServer.exitCode !== null) {
      throw new SetupError(
        `\`npm run ${script}\` exited — run it directly to see why.`,
      );
    }
    const up = await probeDevServer(config.devOrigin);
    if (up?.status === 200) {
      log(`Dev server is up at ${config.devOrigin}.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new SetupError(
    `Timed out waiting for ${config.devOrigin} — run \`npm run ${script}\` directly.`,
  );
}

function stopDevServer() {
  if (!startedServer?.pid || startedServer.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      execFileSync(
        "taskkill",
        ["/pid", String(startedServer.pid), "/T", "/F"],
        { stdio: "ignore" },
      );
    } else {
      process.kill(-startedServer.pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

// --------------------------------------------------------------- browser ---

function savedLoginCookies() {
  try {
    const state = JSON.parse(readFileSync(AUTH_STATE, "utf8"));
    return Array.isArray(state.cookies) ? state.cookies : [];
  } catch {
    return [];
  }
}

/** Launch the first available browser with its persistent dev profile. */
async function launchBrowser(config) {
  const errors = [];
  for (const browser of config.browsers) {
    const dir = profileDir(browser);
    const fresh = !existsSync(dir);
    try {
      const context = await chromium.launchPersistentContext(dir, {
        channel: browser === "chromium" ? undefined : browser,
        headless: false,
        viewport: null,
        // Drop the "controlled by automated test software" bar: this is a
        // normal browsing window that carries one extra, scoped grant.
        ignoreDefaultArgs: ["--enable-automation"],
      });
      return { context, browser, dir, fresh };
    } catch (err) {
      errors.push(`${browser}: ${firstLine(err)}`);
    }
  }
  throw new SetupError(`Could not launch a browser:\n  ${errors.join("\n  ")}`);
}

async function grantLocalNetworkAccess(context, origin) {
  try {
    // Scoped to the ADO org origin: only ADO pages may reach localhost; every
    // other site keeps the browser's default block.
    await context.grantPermissions([LNA_PERMISSION], { origin });
  } catch (err) {
    throw new SetupError(
      `Could not grant "${LNA_PERMISSION}" to ${origin} (${firstLine(err)}). ` +
        "Playwright may have renamed the permission — see its grantPermissions docs.",
    );
  }
}

/**
 * Headless end-to-end check: does the dev Documents hub mount from localhost?
 * Uses a throwaway context with the saved `npm run e2e:auth` login (as the e2e
 * suite does) and the same scoped grant, in the first available browser.
 */
async function runCheck(config) {
  if (!existsSync(AUTH_STATE)) {
    throw new SetupError(
      "No saved ADO login for --check — run `npm run e2e:auth` first.",
    );
  }
  const errors = [];
  for (const browser of config.browsers) {
    let instance;
    try {
      instance = await chromium.launch({
        channel: browser === "chromium" ? undefined : browser,
        headless: true,
      });
    } catch (err) {
      errors.push(`${browser}: ${firstLine(err)}`);
      continue;
    }
    try {
      await checkBrowser(config, instance, browser);
      return;
    } finally {
      await instance.close().catch(() => {});
    }
  }
  throw new SetupError(`Could not launch a browser:\n  ${errors.join("\n  ")}`);
}

async function checkBrowser(config, instance, browser) {
  const context = await instance.newContext({ storageState: AUTH_STATE });
  await grantLocalNetworkAccess(context, config.orgOrigin);
  const page = await context.newPage();
  const failures = new Set();
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(config.devOrigin)) {
      failures.add(r.failure()?.errorText);
    }
  });
  await page.goto(config.hubUrl, { waitUntil: "load" }).catch(() => {});
  const mounted = await page
    .frameLocator(`iframe[src^="${config.devOrigin}"]`)
    .locator("#root > *")
    .first()
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (mounted) {
    log(`OK — the dev extension loads from ${config.devOrigin} in ${browser}.`);
    return;
  }
  if (new URL(page.url()).origin !== config.orgOrigin) {
    throw new SetupError(
      "The saved ADO login has expired — run `npm run e2e:auth`.",
    );
  }
  throw new SetupError(
    `The dev extension did not load in ${browser} (${
      [...failures].join(", ") || "no request failed"
    }).\n  ERR_CERT_* → run \`npm run setup:cert\`. No failure → is ` +
      `${config.extensionId} installed in ${config.orgUrl}?`,
  );
}

async function runInteractive(config) {
  const { context, browser, dir, fresh } = await launchBrowser(config);
  await grantLocalNetworkAccess(context, config.orgOrigin);
  if (fresh) {
    // Best effort: reuse the `npm run e2e:auth` login. Some browsers (e.g.
    // Edge with work-account SSO on a managed device) still ask to sign in;
    // the dedicated profile then remembers that sign-in.
    await context.addCookies(savedLoginCookies());
  }
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(config.targetUrl, { waitUntil: "load" }).catch(() => {});
  log(`Opened ${browser} with its own profile (${dir}).`);
  log(`Local network access is granted to ${config.orgOrigin} only.`);
  if (new URL(page.url()).origin !== config.orgOrigin) {
    log("Sign in once in that window; this dev profile remembers it.");
  }
  log("Close the browser window (or press Ctrl+C) to finish.");
  await new Promise((resolve) => context.once("close", resolve));
}
// ------------------------------------------------------------------ main ---

process.once("SIGINT", () => {
  stopDevServer();
  process.exit(130);
});

try {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const config = readConfig(argv);
  await ensureDevServer(config);
  if (config.check) await runCheck(config);
  else await runInteractive(config);
} catch (err) {
  console.error(
    `\n[dev:ado] ${err instanceof SetupError ? err.message : (err?.stack ?? err)}\n`,
  );
  process.exitCode = 1;
} finally {
  stopDevServer();
}
