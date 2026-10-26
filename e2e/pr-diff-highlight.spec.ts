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

import type { Locator } from "@playwright/test";

import { test, expect } from "./fixtures";

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

  test("re-aligns coarse ADO hunks so new blocks read as added, not edited", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.rewriteDiffRepo,
      E2E.rewriteDiffPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.rewriteDiffRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    const article = frame.locator(".emr-rendered").first();
    await article.waitFor({ timeout: 45_000 });
    await expect(article.locator(".emr-diff-block").first()).toBeVisible({
      timeout: 30_000,
    });

    // `hasText` also matches ancestors, so take the innermost (last) match:
    // a nested list item, not the top-level item that contains it.
    const block = (selector: string, text: string) =>
      article.locator(selector).filter({ hasText: text }).last();
    const row = (firstCell: string) =>
      article.locator("tr").filter({
        has: frame
          .locator("td:first-child")
          .getByText(firstCell, { exact: true }),
      });
    const removedTexts = () =>
      article
        .locator(".emr-diff-deleted-marker")
        .evaluateAll((markers) => markers.map((m) => m.textContent ?? ""));
    const marks = (scope: Locator, kind: "added" | "removed") =>
      scope.locator(`.emr-word-${kind}`).evaluateAll((els) =>
        els
          .map((el) => el.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );

    // ADO reports each rewrite as one coarse hunk; none of its new blocks may
    // fall back to the misleading "previous content unavailable" amber.
    await expect(
      article.locator('[data-diff-tooltip^="Previous content unavailable"]'),
    ).toHaveCount(0);

    // Performance: a one-line placeholder became a table and a nested list.
    // Every new block is added — including items nested under an added item —
    // and the placeholder and TODO show up as removed.
    await expect(block("p", "We have 3 topline metrics")).toHaveAttribute(
      "data-diff-kind",
      "added",
    );
    await expect(row("EUPL")).toHaveAttribute("data-diff-kind", "added");
    for (const nested of ["Locally against", "Capture latency numbers"]) {
      await expect(block("li", nested)).toHaveAttribute(
        "data-diff-kind",
        "added",
      );
    }
    expect((await removedTexts()).join("\n")).toContain(
      "Can this impact our topline perf metrics",
    );

    // An edited paragraph keeps its precise word diff next to a new one.
    expect(await marks(block("p", "Reviewers lose comments"), "added")).toBe(
      "in the middle of a",
    );
    await expect(block("p", "Field telemetry shows")).toHaveAttribute(
      "data-diff-kind",
      "added",
    );

    // List: an edited item next to inserted items.
    expect(await marks(block("li", "Drafts sync exactly once"), "added")).toBe(
      "exactly once,",
    );
    await expect(block("li", "Drafts expire after seven days")).toHaveAttribute(
      "data-diff-kind",
      "added",
    );

    // Table: an edited cell next to an inserted row.
    await expect(row("Telemetry")).toHaveAttribute("data-diff-kind", "added");
    await expect(row("Sync")).toHaveAttribute("data-diff-cells", "true");

    // Ordered list: the first step was removed. A later renumbered step reads
    // the same and is not marked; the new first step changed the number the
    // list starts at, so only its number is marked.
    await expect(block("li", "Build the extension.")).toHaveAttribute(
      "data-diff-tooltip",
      "List numbering changed from 2 to 1",
    );
    await expect(block("li", "Run the end-to-end suite.")).not.toHaveAttribute(
      "data-diff-kind",
      /.+/,
    );
    expect((await removedTexts()).join("\n")).toContain(
      "Clone the feature branch.",
    );

    // An edited paragraph that moved past a new section still pairs with its
    // original across ADO's blank-line-anchored hunks.
    expect(
      await marks(block("p", "covers engineering design notes"), "removed"),
    ).toBe("first release");

    // A same-shape rewrite stays an edit with its previous version on demand.
    const risk = block("p", "Session storage is cleared");
    await expect(risk).toHaveAttribute("data-diff-kind", "modified");
    await expect(
      risk.getByRole("button", { name: "Show previous version" }),
    ).toBeVisible();
  });

  test("compares edited equation source and rendering in one callout", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.equationRepo,
      E2E.equationPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.equationRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });
    await frame
      .locator("button.emr-docnav-file-label")
      .filter({ hasText: "equations.md" })
      .click();

    const equation = frame
      .locator(".emr-math.emr-diff-block")
      .filter({
        has: frame.locator("annotation").filter({ hasText: "g_i^2" }),
      })
      .first();
    await expect(equation.locator(".katex")).toBeVisible({ timeout: 30_000 });
    await expect(equation).toHaveAttribute("data-diff-kind", "modified");
    await expect(
      equation.locator(".emr-word-added, .emr-word-removed"),
    ).toHaveCount(0);

    const added = frame
      .locator(".emr-math annotation")
      .filter({ hasText: String.raw`F_{\mathrm{scro}\parallel}` });
    await expect(added).toHaveCount(1);

    await equation.getByTitle("View equation source").click();
    const sourceModal = frame.getByRole("dialog", { name: "Equation source" });
    await expect(sourceModal).toBeVisible();
    await expect(sourceModal.locator(".emr-word-added")).toHaveText("^2");
    await expect(
      sourceModal.locator(".emr-generated-source-preview .katex"),
    ).toBeVisible();
    await sourceModal.getByRole("button", { name: "Before" }).click();
    await expect(
      sourceModal.getByRole("button", { name: /source changes/i }),
    ).toHaveCount(0);
    await expect(
      sourceModal.locator(".emr-generated-source-code code"),
    ).toHaveText(
      String.raw`G_{\mathrm{scro}\parallel,\mathrm{RMS}} = \sqrt{\frac{1}{Kn}\sum_{i=1}^{n} g_i}`,
    );
    await expect(
      sourceModal.locator(".emr-generated-source-preview .katex"),
    ).toBeVisible();
    await expect(sourceModal.locator("annotation")).toHaveText(
      String.raw`G_{\mathrm{scro}\parallel,\mathrm{RMS}} = \sqrt{\frac{1}{Kn}\sum_{i=1}^{n} g_i}`,
    );
    await expect(
      equation.getByRole("button", { name: "Show previous version" }),
    ).toHaveCount(0);
  });
});
