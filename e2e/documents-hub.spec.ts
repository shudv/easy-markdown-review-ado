// E2E: the Documents hub — our top-level "Markdown Review" hub-group entry that
// renders the live <DocumentsHubApp/> (repo discovery + markdown reader +
// comments) inside a real ADO contribution iframe.
//
// Why this needs the real host: the hub bundle is served from the dev origin
// (https://localhost:3000/hub/documents-hub.html) and loaded by ADO as a
// cross-origin contribution iframe. Only the live host exercises the
// SDK.init/ready handshake, full-screen mode, ProjectPageService repo discovery
// and the Git REST data load — none of which the unit tests or the same-origin
// standalone preview can reproduce.

import { test, expect } from "@playwright/test";
import { E2E } from "./env";
import {
  gotoDocumentsHub,
  hubFrame,
  hubIframeElement,
  openCommentableDoc,
  openDraftComposerBySelection,
  waitForFrameRoot,
} from "./helpers";

test.describe("Documents hub (real ADO host)", () => {
  test("loads the dev contribution iframe and mounts the app", async ({
    page,
  }) => {
    await gotoDocumentsHub(page);

    // ADO must render OUR contribution iframe (matched by the dev-origin bundle
    // URL, so a co-installed prod extension can't satisfy it).
    const iframe = hubIframeElement(page);
    await expect(iframe).toBeVisible({ timeout: 30_000 });

    // The cross-origin localhost iframe must actually commit and boot our React
    // tree — this is the step the VS Code *integrated* browser can't do with a
    // self-signed cert, but the Playwright context (ignoreHTTPSErrors) can.
    const frame = hubFrame(page);
    await waitForFrameRoot(frame);

    // The app must leave its transient "Loading Documents…" state and settle
    // into a terminal one: the documents reader, the empty state, or the error
    // state. Any of those proves the SDK handshake + first data turn completed.
    const settled = frame.locator(
      ".markdown-body, .emr-docnav, h2:has-text('No Markdown documents found'), h2:has-text(\"Couldn't load Documents\")",
    );
    await expect(settled.first()).toBeVisible({ timeout: 45_000 });

    await expect(
      frame.getByRole("status", { name: "Loading Documents" }),
    ).toHaveCount(0);
  });

  test("renders markdown from the live project repos", async ({ page }) => {
    await gotoDocumentsHub(page);

    const frame = hubFrame(page);
    await waitForFrameRoot(frame);

    // The sandbox repo (default `api-reference`) contains real Markdown, so the
    // hub should discover it and render a document in the reader surface.
    const article = frame.locator(".markdown-body").first();
    await expect(article).toBeVisible({ timeout: 45_000 });

    // Sanity: the rendered article isn't an empty shell.
    await expect
      .poll(async () => (await article.innerText()).trim().length, {
        timeout: 20_000,
        message: "markdown reader rendered no text",
      })
      .toBeGreaterThan(0);

    // The in-hub repo selector (or a static repo label) should reflect a repo
    // from the live project — proves discovery ran against real ADO data.
    expect(E2E.repoA.length).toBeGreaterThan(0);
  });

  test("preserves an in-progress draft across a page reload", async ({
    page,
  }) => {
    // The hub half of local draft persistence (scope "hub"): a draft typed into
    // the reader — but not posted — must survive a full reload. The shell keys
    // the persisted draft to the hub experience and the selected document, then
    // restores the balloon + text on mount.
    //
    // Target a known commentable document (repoA/mdPathA, routed to a completed
    // PR) rather than the hub's alphabetical default repo, which may be a
    // fixture repo whose only PR is active (read-only — no draft composer).
    let { frame } = await openCommentableDoc(page);

    await openDraftComposerBySelection(frame);
    const draftText = "Hub draft that should survive a reload";
    await frame
      .locator(".emr-balloon.is-draft textarea.emr-textarea")
      .fill(draftText);
    // Let the throttled localStorage write settle (leading + trailing, 500ms).
    await page.waitForTimeout(800);

    // Reload the host page; the hub re-mounts and restores the last-visited
    // document, at which point the persisted draft re-opens against it.
    await page.reload({ waitUntil: "domcontentloaded" });
    frame = hubFrame(page);
    await waitForFrameRoot(frame);
    await expect(frame.locator(".markdown-body").first()).toBeVisible({
      timeout: 45_000,
    });

    const restored = frame.locator(".emr-balloon.is-draft");
    await expect(restored).toBeVisible({ timeout: 30_000 });
    await expect(restored.locator("textarea.emr-textarea")).toHaveValue(
      draftText,
      { timeout: 15_000 },
    );

    // Cancel clears the persisted draft so later runs start clean.
    await restored.getByRole("button", { name: /^cancel$/i }).click();
    await expect(restored).toHaveCount(0, { timeout: 10_000 });
  });
});
