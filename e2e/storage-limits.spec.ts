// E2E: this browser's caches at their limits, in the real host and browser.
//
// The PR tab and the Documents hub share one origin, whose localStorage holds
// both caches (the 20 most recent PRs' details, the 10 most recent documents)
// alongside comment drafts and reading preferences, within the browser's quota
// (~5M characters, shared by every key). These check the worst cases:
//
//   - both caches full of the largest entries their limits allow, in the
//     content that grows most when stored (newlines and quotes count twice in
//     JSON): a PR still opens, takes the newest slot in each cache, the caches
//     stay within their bounds, and a comment draft is still saved;
//   - the origin's storage completely full: a PR still opens and reads
//     normally — caching just doesn't happen.
//
// Black-box like the other specs: the keys and limits are restated here, not
// imported (see src/shell/documentCache.ts, src/pr-tab/prContextCache.ts).

import type { FrameLocator, Page } from "@playwright/test";

import { test, expect } from "./fixtures";
import { E2E } from "./env";
import {
    discoverPullRequestId,
    gotoPrTab,
    openDraftComposerBySelection,
    prTabFrame,
    waitForFrameRoot,
    waitForPersistedDraft,
} from "./helpers";

const DOCS_KEY = "emr.docs.v1";
const PRS_KEY = "emr.prs.v1";
const MAX_DOCS = 10;
const MAX_DOC_CHARS = 100_000;
const MAX_PRS = 20;
const MAX_PR_CHARS = 50_000;
/** Ids of the seeded entries, so they can be told from real ones. */
const FAKE_PREFIX = "fffffffffffffffffffffffffffffff";

/** Open the PR tab and wait for its document to render. */
async function openPr(page: Page, prId: number): Promise<FrameLocator> {
    await gotoPrTab(page, E2E.prRepo, prId);
    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    const article = frame.locator(".markdown-body").first();
    await expect
        .poll(async () => (await article.innerText()).trim().length, { timeout: 45_000 })
        .toBeGreaterThan(0);
    await expect(frame.locator(".emr-error")).toHaveCount(0);

    return frame;
}

/** Fill both caches with the largest worst-case entries their limits allow. */
async function fillCaches(frame: FrameLocator): Promise<void> {
    await frame.locator("html").evaluate(
        (_, limits) => {
            const fill = (chars: number) => '\n"'.repeat(Math.floor(chars / 4));
            const docOverhead = JSON.stringify({ id: `${limits.fake}000000000`, content: "" });

            const docs = Array.from({ length: limits.maxDocs }, (_unused, i) => ({
                id: `${limits.fake}${String(i).padStart(9, "0")}`,
                content: fill(limits.maxDocChars - docOverhead.length),
            }));

            // Valid entries (the cache drops malformed ones), each at its limit.
            const prs = Array.from({ length: limits.maxPrs }, (_unused, i) => ({
                key: `${limits.fake}/${i}`,
                ctx: {
                    projectId: "p",
                    projectName: "p",
                    repositoryId: "r",
                    repositoryName: "r",
                    orgUrl: "https://dev.azure.com/o",
                    pullRequestId: i,
                    pr: {},
                    reviewIterationStops: [],
                    changedMdFiles: [
                        {
                            path: fill(limits.maxPrChars - 400),
                            changeType: "modified",
                            linesAdded: 0,
                            linesDeleted: 0,
                        },
                    ],
                },
            }));

            localStorage.setItem(limits.docsKey, JSON.stringify(docs));
            localStorage.setItem(limits.prsKey, JSON.stringify(prs));
        },
        {
            fake: FAKE_PREFIX,
            docsKey: DOCS_KEY,
            prsKey: PRS_KEY,
            maxDocs: MAX_DOCS,
            maxDocChars: MAX_DOC_CHARS,
            maxPrs: MAX_PRS,
            maxPrChars: MAX_PR_CHARS,
        },
    );
}

/** What the caches hold: their ids, newest first, and their stored lengths. */
async function readCaches(frame: FrameLocator) {
    return frame.locator("html").evaluate(
        (_, keys) => {
            const docs = localStorage.getItem(keys.docsKey) ?? "[]";
            const prs = localStorage.getItem(keys.prsKey) ?? "[]";

            return {
                docIds: (JSON.parse(docs) as { id: string }[]).map((d) => d.id),
                prKeys: (JSON.parse(prs) as { key: string }[]).map((p) => p.key),
                docsChars: docs.length,
                prsChars: prs.length,
            };
        },
        { docsKey: DOCS_KEY, prsKey: PRS_KEY },
    );
}

test.describe("Browser storage at its limits (real host)", () => {
    let prId = 0;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
        await page.close();
    });

    test("with both caches full of worst-case entries, a PR opens, is cached, and drafts still save", async ({
        page,
    }) => {
        test.setTimeout(150_000);
        await fillCaches(await openPr(page, prId));
        const seeded = await readCaches(prTabFrame(page));
        expect(seeded.docIds).toHaveLength(MAX_DOCS);
        expect(seeded.prKeys).toHaveLength(MAX_PRS);

        await page.reload();
        const frame = await openPr(page, prId);

        // The PR and its document take the newest slot in each cache, dropping
        // the oldest seeded entry, and the caches stay within their bounds.
        await expect
            .poll(async () => (await readCaches(frame)).docIds[0]?.startsWith(FAKE_PREFIX))
            .toBe(false);
        const caches = await readCaches(frame);
        expect(caches.prKeys[0]).not.toContain(FAKE_PREFIX);
        expect(caches.docIds).toHaveLength(MAX_DOCS);
        expect(caches.prKeys).toHaveLength(MAX_PRS);
        expect(caches.docsChars).toBeLessThanOrEqual(MAX_DOCS * (MAX_DOC_CHARS + 1) + 1);
        expect(caches.prsChars).toBeLessThanOrEqual(MAX_PRS * (MAX_PR_CHARS + 1) + 1);

        // A comment draft still fits beside the full caches.
        await openDraftComposerBySelection(frame);
        const body = `storage-limits draft ${Date.now()}`;
        await frame.locator(".emr-balloon.is-draft textarea.emr-textarea").fill(body);
        await waitForPersistedDraft(frame, body);
    });

    test("with this origin's storage full, a PR opens and reads normally", async ({ page }) => {
        test.setTimeout(150_000);
        const frame = await openPr(page, prId);

        // Fill every character the browser allows, leaving no room for caching.
        const filled = await frame.locator("html").evaluate(() => {
            localStorage.clear();

            const fits = (chars: number) => {
                try {
                    localStorage.setItem("emr.e2e.filler", "x".repeat(chars));

                    return true;
                } catch {
                    return false;
                }
            };

            let lo = 0;
            let hi = 20_000_000;

            while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (fits(mid)) lo = mid;
                else hi = mid - 1;
            }

            fits(lo);

            return lo;
        });

        expect(filled).toBeGreaterThan(1_000_000);

        await page.reload();
        const reopened = await openPr(page, prId);
        await expect(reopened.locator(".emr-toast--error")).toHaveCount(0);
        expect(await readCaches(reopened)).toMatchObject({ docIds: [], prKeys: [] });
    });
});
