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

import { test, expect } from "./fixtures";
import { E2E } from "./env";
import {
    gotoDocumentsHub,
    hubFrame,
    hubIframeElement,
    openCommentableDoc,
    openDraftComposerBySelection,
    recordAdoRequests,
    selectRepoInPicker,
    waitForFrameRoot,
    waitForPersistedDraft,
} from "./helpers";
import { collectTelemetry } from "./reconnect.helpers";

// A document read by its git blob (what the document cache keys on).
const BLOB_READ = /\/_apis\/git\/repositories\/[^/]+\/blobs\//i;

test.describe("Documents hub (real ADO host)", () => {
    test("loads the dev contribution iframe and renders live Markdown", async ({ page }) => {
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

        // The sandbox project contains real Markdown, so the hub must discover a
        // repo over the live Git REST API and render a document — proving the SDK
        // handshake, repo discovery and first data turn all completed.
        const article = frame.locator(".markdown-body").first();
        await expect(article).toBeVisible({ timeout: 45_000 });
        await expect(frame.getByRole("status", { name: "Loading Documents" })).toHaveCount(0);

        // Sanity: the rendered article isn't an empty shell.
        await expect
            .poll(async () => (await article.innerText()).trim().length, {
                timeout: 20_000,
                message: "markdown reader rendered no text",
            })
            .toBeGreaterThan(0);
    });

    test("reopening the hub reads its document from this browser's document cache", async ({
        page,
    }) => {
        const requests = recordAdoRequests(page);
        const telemetry = collectTelemetry(page);
        await gotoDocumentsHub(page);
        const frame = hubFrame(page);
        await waitForFrameRoot(frame);
        const article = frame.locator(".markdown-body").first();
        await expect
            .poll(async () => (await article.innerText()).trim().length, { timeout: 45_000 })
            .toBeGreaterThan(0);
        // First open: the listed document is read by its git blob (and cached).
        expect(requests.some((e) => e.phase === "end" && BLOB_READ.test(e.url))).toBe(true);
        const heading = (await article.innerText()).trim().split("\n")[0]!;
        const before = requests.length;

        // The hub reopens the last-visited document.
        await page.reload();
        const reopened = hubFrame(page);
        await waitForFrameRoot(reopened);
        await expect(reopened.locator(".markdown-body").first()).toContainText(heading, {
            timeout: 45_000,
        });
        expect(
            requests.slice(before).filter((e) => BLOB_READ.test(e.url)),
            "the reopened document must come from the cache",
        ).toEqual([]);
        // The hub has no PR to cache: only the document can come from the cache.
        await expect
            .poll(() =>
                telemetry
                    .events()
                    .filter((e) => e.name === "app.loaded")
                    .map((e) => e.properties?.cache),
            )
            .toEqual(["none", "doc"]);
    });

    test("a folder with no Markdown loses its chevron once opened, and isn't fetched again", async ({
        page,
    }) => {
        await gotoDocumentsHub(page);
        await waitForFrameRoot(hubFrame(page));
        const repo = await selectRepoInPicker(page, hubFrame(page), E2E.drawingsRepo);
        const requests = recordAdoRequests(page);
        await gotoDocumentsHub(page, { repo, path: "design.md" });
        const frame = hubFrame(page);
        await waitForFrameRoot(frame);
        await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });
        const nav = frame.getByRole("complementary", { name: "Document navigation" });

        // `/diagrams` holds only drawings: opening it finds nothing to show.
        await nav.getByRole("button", { name: "Load folder" }).click();
        const label = nav.getByRole("button", { name: /diagrams/ });
        await expect(label).toBeDisabled({ timeout: 30_000 });
        await expect(nav.getByRole("button", { name: "Load folder" })).toHaveCount(0);

        // Listed once (the hub asks for `diagrams`, ADO answers with `/diagrams`).
        const folderReads = () =>
            requests.filter(
                (e) =>
                    e.phase === "start" &&
                    /\/items\?scopePath=(?:%2F)?diagrams(?:&|$)/i.test(e.url),
            ).length;

        expect(folderReads()).toBe(1);

        // Clicking it again fetches nothing: the row has nothing to open.
        await label.click({ force: true });
        await expect(nav.getByRole("button", { name: "Loading folder..." })).toHaveCount(0);
        await expect(label).toBeDisabled();
        expect(folderReads()).toBe(1);
    });

    test("preserves an in-progress draft across a page reload", async ({ page }) => {
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
        await frame.locator(".emr-balloon.is-draft textarea.emr-textarea").fill(draftText);
        await waitForPersistedDraft(frame, draftText);

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
        await expect(restored.locator("textarea.emr-textarea")).toHaveValue(draftText, {
            timeout: 15_000,
        });

        // Cancel clears the persisted draft so later runs start clean.
        await restored.getByRole("button", { name: /^cancel$/i }).click();
        await expect(restored).toHaveCount(0, { timeout: 10_000 });
    });
});
