// E2E: host theme sync — the extension mirrors the Azure DevOps host theme and
// keeps mirroring when the user switches it live from the ADO profile menu.
//
// Why this needs the real host: our theme model (`src/theme/theme.ts`) reads
// the host palette out of the CSS vars the SDK injects and re-mirrors on the
// SDK's `themeApplied` event. That whole handshake — `SDK.init({ applyTheme })`
// injecting host vars, then re-firing on a live host `themeChanged` — only
// exists inside a real ADO contribution iframe. Unit tests cover the pure
// resolve/apply logic against a stubbed DOM; only this spec proves that
// selecting a theme in ADO's own menu actually flips our `data-emr-theme`
// (and therefore the `--emr-*` chrome + GitHub-Markdown light/dark stylesheet).

import { test, expect } from "@playwright/test";

import { E2E } from "./env";
import {
  gotoDocumentsHub,
  hubFrame,
  isDarkEmrTheme,
  readEmrTheme,
  selectRepoInPicker,
  setAdoTheme,
  waitForFrameRoot,
} from "./helpers";

test.describe("Host theme sync (real ADO host)", () => {
  test("adapts data-emr-theme when the ADO theme is switched from the menu", async ({
    page,
  }) => {
    await gotoDocumentsHub(page);
    const frame = hubFrame(page);
    await waitForFrameRoot(frame);
    // Make sure a document is actually rendered so the theme has real chrome to
    // apply to (and the extension has completed its first theme sync).
    await selectRepoInPicker(page, frame, E2E.repoA);
    await frame
      .locator(".markdown-body")
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });

    // The extension must have mirrored SOME host theme on load.
    const initial = await readEmrTheme(frame);
    expect(initial, "extension never wrote data-emr-theme").toBeTruthy();
    const startedDark = isDarkEmrTheme(initial);

    // Flip the ADO host to the OPPOSITE palette via its own profile menu, then
    // assert the extension re-mirrors — the data-emr-theme attribute crosses
    // the dark ↔ light boundary. Polling the attribute lets the SDK's
    // `themeApplied` event propagate into our sync handler.
    const target = startedDark ? /^light$/i : /^dark$/i;
    await setAdoTheme(page, target);
    await expect
      .poll(async () => isDarkEmrTheme(await readEmrTheme(frame)), {
        timeout: 20_000,
        message: "extension did not adapt to the switched host theme",
      })
      .toBe(!startedDark);

    // Switch back to the original palette — the mirror follows again, proving
    // the sync is live in both directions (not a one-shot on load).
    const back = startedDark ? /^dark$/i : /^light$/i;
    await setAdoTheme(page, back);
    await expect
      .poll(async () => isDarkEmrTheme(await readEmrTheme(frame)), {
        timeout: 20_000,
        message: "extension did not re-adapt when the host theme reverted",
      })
      .toBe(startedDark);
  });
});
