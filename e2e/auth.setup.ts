// Interactive, one-time authentication. Persists ADO's auth cookies to
// `e2e/.auth/state.json` so the real test projects can reuse the session
// without logging in each run.
//
// Run it explicitly the first time (headed):  npm run e2e:auth
// After that, `npm run e2e` reuses the saved state and this becomes a no-op
// as long as the state file is present and recent.

import { test as setup, expect, type BrowserContext } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { AUTH_STATE } from "../playwright.config";
import { E2E } from "./env";

// Reuse an existing session for this long before forcing a fresh login.
const MAX_STATE_AGE_MS = 1000 * 60 * 60 * 12; // 12h

type StateCookie = Parameters<BrowserContext["addCookies"]>[0][number];

/**
 * Read the cookies out of a Playwright storage-state file so we can seed a
 * fresh context and verify the session is still live before trusting it.
 * Returns an empty list if the file is missing/unparseable — the caller then
 * falls through to interactive login.
 */
function cookiesFromState(path: string): StateCookie[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      cookies?: unknown;
    };
    return Array.isArray(parsed.cookies)
      ? (parsed.cookies as StateCookie[])
      : [];
  } catch {
    return [];
  }
}

setup("authenticate against Azure DevOps", async ({ page }) => {
  mkdirSync(dirname(AUTH_STATE), { recursive: true });

  // "Signed in" = we're back on the ADO collection host (not the Microsoft
  // login domains). This URL-based check is far more robust than matching the
  // ADO shell's DOM, which varies by page and host UI version. ADO redirects
  // unauthenticated users to login.microsoftonline.com / login.live.com first.
  const onAdoHost = () => {
    try {
      return new URL(page.url()).host.endsWith("dev.azure.com");
    } catch {
      return false;
    }
  };

  // Navigate tolerantly. An unauthenticated (or dead-cookie) hit on the ADO
  // collection triggers a redirect to the Microsoft login domain that
  // supersedes the in-flight navigation, so `page.goto` rejects with
  // `net::ERR_ABORTED`. That abort is an EXPECTED outcome of the auth flow —
  // we determine the real state from the resulting URL via `onAdoHost()`, not
  // from whether `goto` resolved. `domcontentloaded` also settles before the
  // redirect can abort a `load`-wait. Any other navigation error still throws.
  const gotoCollection = async () => {
    try {
      await page.goto(`${E2E.orgUrl}/${E2E.project}`, {
        waitUntil: "domcontentloaded",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("ERR_ABORTED")) throw err;
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  };

  // Fast path: a recent state file MIGHT mean we're still authenticated, but a
  // file's age doesn't prove the cookies still work (a stale-but-recent state
  // silently skips, then the real tests fail on an auth redirect). So instead
  // of trusting mtime alone, we load the saved cookies and actually navigate:
  // if ADO keeps us on its host we're genuinely signed in and skip; otherwise
  // we fall through to the interactive login below.
  if (existsSync(AUTH_STATE)) {
    const ageMs = Date.now() - statSync(AUTH_STATE).mtimeMs;
    if (ageMs < MAX_STATE_AGE_MS) {
      await page.context().addCookies(cookiesFromState(AUTH_STATE));
      await gotoCollection();
      if (onAdoHost()) {
        setup.skip(true, "Reusing verified auth state.");
        return;
      }
      // Cookies were recent but no longer valid — force a fresh login.

      console.log(
        "[e2e auth] Saved session is no longer valid; re-authenticating…",
      );
    }
  }

  await gotoCollection();

  const alreadyIn = onAdoHost();

  if (!alreadyIn) {
    // Headed run: pause for the human to complete login (incl. MFA). We poll
    // the URL until it lands back on the ADO host, up to 5 minutes.

    console.log(
      "\n[e2e auth] Complete the Microsoft sign-in in the opened browser window " +
        `(use ${E2E.account})…\n`,
    );
    await expect(async () => {
      expect(onAdoHost(), `still on ${page.url()}`).toBe(true);
    }).toPass({ timeout: 5 * 60_000, intervals: [1_000] });
  }

  // Give the collection page a moment to set all session cookies before we
  // snapshot storage state.
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.context().storageState({ path: AUTH_STATE });

  console.log(`[e2e auth] Saved session to ${AUTH_STATE}`);
});
