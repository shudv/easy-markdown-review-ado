// E2E: high-contrast theme sync — the extension mirrors the OS forced-colors
// (Windows High Contrast) state into its `hc-dark` / `hc-light` palette.
//
// Why this needs the real host: the SDK theme handshake and our forced-colors /
// prefers-color-scheme listeners (`src/theme/theme.ts`) only run inside a real
// ADO contribution iframe. We drive the OS signals with Playwright's
// `emulateMedia` (deterministic — no flaky host theme menu) and assert our
// `data-emr-theme` crosses into the matching high-contrast palette both ways.
//
// Regression guard: under forced-colors the ADO host FREEZES its injected
// `--background-color` at the pre-HC (light) value, so background luminance
// can't tell HC-dark from HC-light. Darkness must come from the OS
// `prefers-color-scheme`. Before the fix, a dark high-contrast desktop resolved
// to `hc-light` (a white extension inside a black HC environment).

import { test, expect } from "@playwright/test";

import { E2E } from "./env";
import {
  discoverPullRequestId,
  gotoPrTab,
  prTabFrame,
  readEmrTheme,
  waitForFrameRoot,
} from "./helpers";

test.describe("High-contrast theme sync (real ADO host)", () => {
  test("mirrors forced-colors into hc-dark / hc-light via prefers-color-scheme", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    // Wait for the reader so the extension's first theme sync has completed.
    await frame
      .locator(".markdown-body")
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });

    // Baseline: whatever the shared ADO account currently uses. Theme choice is
    // persisted server-side, so this can legitimately be regular or HC when a
    // developer/earlier run selected an HC profile theme. The OS-media checks
    // below must not depend on that mutable account preference.
    const initial = await readEmrTheme(frame);
    expect(initial, "extension never wrote data-emr-theme").toBeTruthy();
    expect(initial ?? "").toMatch(/^(?:hc-)?(?:light|dark)$/);

    // Turn ON OS forced-colors with a DARK colour scheme → hc-dark. This is the
    // core regression guard: the host still injects a light `--background-color`,
    // so only `prefers-color-scheme: dark` can drive the dark palette here.
    await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
    await expect
      .poll(async () => readEmrTheme(frame), {
        timeout: 20_000,
        message: "did not switch to hc-dark under forced-colors + dark scheme",
      })
      .toBe("hc-dark");

    // Flip ONLY the colour scheme to light (forced-colors still active) →
    // hc-light. The sole changed signal is `prefers-color-scheme`, proving it —
    // not the frozen background — drives dark vs light in high contrast.
    await page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
    await expect
      .poll(async () => readEmrTheme(frame), {
        timeout: 20_000,
        message: "did not switch to hc-light when the scheme flipped to light",
      })
      .toBe("hc-light");

    // Clear the OS override → return to the exact host-mirrored baseline. That
    // baseline may itself be HC when the ADO profile picker is set to an HC
    // theme; requiring regular light/dark here made this test account-state
    // dependent and flaky.
    await page.emulateMedia({
      forcedColors: "none",
      colorScheme: "no-preference",
    });
    await expect
      .poll(async () => (await readEmrTheme(frame)) ?? "", {
        timeout: 20_000,
        message: "did not restore the host theme when forced-colors cleared",
      })
      .toBe(initial);
  });
});
