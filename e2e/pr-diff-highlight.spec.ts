// E2E: PR change highlighting — the content-level diff view on the Markdown
// Review PR tab. A pull request's changed Markdown is rendered with the added
// (green) / edited (amber) washes and removed-line markers, and a floating
// "Hide changes / Show changes" toggle drops the reader to the clean latest
// version and back.
//
// Why this needs the real host: the diff ranges are computed from the live Git
// diff the SDK loads inside ADO's pull-request view. Unit tests cover the pure
// decoration + summary logic against synthetic ranges; only the real PR tab
// exercises range-computation → render → decorate end to end, plus the toggle
// wired through the shared <PrShell/>.

import { test, expect } from "@playwright/test";

import { E2E } from "./env";
import {
  discoverPullRequestId,
  gotoPrTab,
  prTabFrame,
  waitForFrameRoot,
} from "./helpers";

test.describe("Markdown Review PR tab — change highlighting", () => {
  test("highlights changed content and toggles the diff off and on", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.diffRepo,
      E2E.diffPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.diffRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    // The reader must paint the changed document before any diff layer applies.
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

    // The “Changes” toggle lives on the bottom status bar and only shows a
    // control when the PR provides diff ranges for the open file — its presence
    // proves the Git-diff → range pipeline ran (`aria-pressed` reflects whether
    // the diff layer is shown).
    const toggle = frame
      .locator(".emr-statusbar-btn.is-toggle")
      .filter({ hasText: "Changes" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });

    // With changes shown, at least one block carries a content-level wash
    // (added or edited) — the intuitive highlight this feature adds.
    const changedBlocks = frame.locator(".emr-rendered .emr-diff-block");
    await expect
      .poll(async () => changedBlocks.count(), {
        timeout: 20_000,
        message: "no changed blocks were highlighted",
      })
      .toBeGreaterThan(0);

    // A highlighted block advertises its kind via the label the CSS corner tag
    // reads — added → "Added", modified → "Edited".
    const firstKind = await changedBlocks
      .first()
      .getAttribute("data-diff-kind");
    expect(["added", "modified"]).toContain(firstKind);

    // Table edits resolve to CELL-precise highlights: a single changed cell (or
    // a changed column) lights just the affected `<td>`/`<th>` rather than
    // washing the whole row. The showcase PR edits individual table cells, so
    // at least one cell-level mark must appear — proving the runtime
    // originalText reached the row and diffTableRowCells ran end to end.
    const diffCells = frame.locator(
      ".emr-rendered td.emr-diff-cell, .emr-rendered th.emr-diff-cell",
    );
    await expect
      .poll(async () => diffCells.count(), {
        timeout: 20_000,
        message: "no cell-level table highlights were applied",
      })
      .toBeGreaterThan(0);
    // A cell-precise row is flagged so the CSS suppresses the whole-row wash.
    const cellRow = diffCells.first().locator("xpath=ancestor::tr[1]");
    await expect(cellRow).toHaveAttribute("data-diff-cells", "true");

    // The toggle starts pressed — the diff layer is the default view.
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Toggling it off drops every decoration so the reader sees the clean,
    // latest version of the document.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(changedBlocks).toHaveCount(0, { timeout: 10_000 });
    // Cell-level table marks are cleared alongside the block washes.
    await expect(diffCells).toHaveCount(0, { timeout: 10_000 });
    // The prose itself is untouched — only the highlight layer went away.
    await expect(frame.locator(".markdown-body").first()).toBeVisible();

    // Toggling it back on re-applies the highlights.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => changedBlocks.count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });
});
