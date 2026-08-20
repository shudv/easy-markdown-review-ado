// E2E: document deep-linking (`?path=`) and per-repo last-visited persistence
// in the Documents hub, against the real ADO host.
//
// These are host-only behaviours that unit tests / Storybook cannot reproduce,
// because they depend on two things only the live cross-origin iframe provides:
//
//   * the host navigation service supplying `?repo=`/`?path=` query params to
//     the contribution, and
//   * localStorage in the real iframe origin — the single `emr.docs.lastVisited`
//     JSON map — surviving across navigations.
//
// The hub seeds that cache on init from wherever a deep link lands (see
// DocumentsHubApp discovery), so the three documented load behaviours are
// exercisable with pure URL navigation once we know the repo GUIDs:
//
//   Behaviour 1 (bare root):  no repo + no path  -> last repo + its last path.
//   Behaviour 2 (`?repo=X`):  repo X (no path)   -> repo X + readLastPath(X).
//   Behaviour 3 (`?path=Y`):  path Y is present  -> Y wins, persisted path ignored.
//
// The hub addresses repos by GUID (never by name) in `?repo=`, so the spec
// first learns each repo's GUID the only black-box way available: selecting it
// in the in-hub picker, which pins `?repo=<guid>` onto the host URL.

import { expect, test } from "@playwright/test";

import { E2E } from "./env";
import {
  expectReaderHeading,
  gotoDocumentsHub,
  hubFrame,
  selectRepoInPicker,
  waitForFrameRoot,
} from "./helpers";

// Slash-free route form (`?path=docs/x.md`) — the hub stores paths without a
// leading slash to mirror ADO's native Files URLs.
const pathA = E2E.mdPathA.replace(/^\/+/, "");
const pathA2 = E2E.mdPathA2.replace(/^\/+/, "");
const pathB = E2E.mdPathB.replace(/^\/+/, "");

// Each target document's `# Title` renders as the first <h1> in the reader, so
// the heading uniquely identifies which document is open.
const HEADING_A = /Pull requests$/i; //  api-reference  /api/rest/pull-requests.md
const HEADING_A2 = /Repositories$/i; // api-reference  /api/rest/repositories.md
const HEADING_B = /^Code review$/i; //  team-handbook  /handbook/.../code-review.md

test.describe("Documents hub: path deep-link + per-repo persistence (real ADO host)", () => {
  // One end-to-end journey: localStorage must accumulate across the navigations,
  // and a fresh test context would wipe it — so all behaviours live in a single
  // test that drives one browser context.
  test("`?path=` deep-links, last-visited restore, and independent per-repo path memory", async ({
    page,
  }) => {
    // --- Learn both repos' GUIDs via the picker --------------------------
    await gotoDocumentsHub(page);
    await waitForFrameRoot(hubFrame(page));

    const guidA = await selectRepoInPicker(page, hubFrame(page), E2E.repoA);
    const guidB = await selectRepoInPicker(page, hubFrame(page), E2E.repoB);
    expect(
      guidA,
      "the two sandbox repos must resolve to distinct GUIDs",
    ).not.toBe(guidB);

    // --- Behaviour 3: an explicit `?path=` opens that exact document ------
    // Also seeds repoA's last-visited path (used by Behaviour 1/2 below).
    await test.step("?repo=A&path=A opens document A", async () => {
      await gotoDocumentsHub(page, { repo: guidA, path: pathA });
      await waitForFrameRoot(hubFrame(page));
      await expectReaderHeading(hubFrame(page), HEADING_A);
    });

    // Seed repoB's last-visited path; repoB is now the most-recent repo too.
    await test.step("?repo=B&path=B opens document B", async () => {
      await gotoDocumentsHub(page, { repo: guidB, path: pathB });
      await waitForFrameRoot(hubFrame(page));
      await expectReaderHeading(hubFrame(page), HEADING_B);
    });

    // --- Behaviour 1: bare root restores last repo + its last path -------
    await test.step("bare root restores the last repo + path (B)", async () => {
      await gotoDocumentsHub(page);
      await waitForFrameRoot(hubFrame(page));
      await expectReaderHeading(hubFrame(page), HEADING_B);
    });

    // --- Behaviour 2 + per-repo memory: `?repo=` reopens THAT repo's own --
    // remembered document, proving each repo persists its path independently
    // (repoA still points at pathA even though repoB was visited last).
    await test.step("?repo=A (no path) reopens repoA's own remembered doc (A)", async () => {
      await gotoDocumentsHub(page, { repo: guidA });
      await waitForFrameRoot(hubFrame(page));
      await expectReaderHeading(hubFrame(page), HEADING_A);
    });

    // --- Behaviour 3 again: explicit `?path=` overrides the remembered path
    await test.step("?repo=A&path=A2 overrides repoA's remembered path", async () => {
      await gotoDocumentsHub(page, { repo: guidA, path: pathA2 });
      await waitForFrameRoot(hubFrame(page));
      await expectReaderHeading(hubFrame(page), HEADING_A2);
    });
  });
});
