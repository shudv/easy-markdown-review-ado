// E2E: how the PR tab behaves when Azure DevOps misbehaves — run against the
// REAL host with conditions reproduced by the dev-only fault injector
// (src/dev/faults.ts, via `window.__emrFaults` in the PR-tab iframe).
//
// Every scenario checks the two promises users feel:
//   1. nothing they typed is silently lost — it is either saved or still on
//      screen / in a restorable draft;
//   2. nothing is saved twice — verified against ADO itself over REST.
//
// Scenarios (the dead-window handling is documented in src/shell/adoSession.ts):
//   A  open during the token dead window, the automatic reload escapes it
//   B  open during the window, the reload doesn't help: no reload loop, no
//      futile "Reload page", and the tab recovers on its own
//   D  a comment, then an edit of it, made during the window are held, then
//      each is saved once
//   E  a typed reply survives "Reload page" and is then saved once
//   H  a dropped connection on a write: error, text kept, no duplicate
//
// The mid-session banner clearing by itself and a plain 401 (token fine) not
// being mistaken for the window are host-independent (the faults are injected
// in-app), so they live in Storybook (`Components/SessionNotice`,
// `Components/Shell` › `Plain Unauthorized Is Not Reconnecting`) and the
// `adoSession` unit tests rather than here.
//
// Comments are created with a unique marker and removed over REST afterwards
// (and leftovers from earlier failed runs are swept first), so the shared
// sandbox PR stays clean.

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
import {
    MARKER_PREFIX,
    collectTelemetry,
    commentsContaining,
    deleteCommentsContaining,
    fault,
    runMarker,
} from "./reconnect.helpers";

const REPO = E2E.prRepo;
let prId = 0;

// The session monitor re-reads the host token every 10s, so recovery after a
// simulated window ends lands within ~10–15s.
const RECOVERY_SLACK_MS = 30_000;

const BOOT_HEADING = "Reconnecting to Azure DevOps…";

const NOTICE_IDLE =
    "Reconnecting to Azure DevOps — this usually fixes itself within a few minutes.";

const NOTICE_HELD = "Reconnecting to Azure DevOps — your changes will be saved automatically.";

/** Count full host-page loads (not same-document route changes). */
function countLoads(page: Page): () => number {
    let n = 0;
    page.on("load", () => {
        n += 1;
    });

    return () => n;
}

async function openPr(page: Page): Promise<FrameLocator> {
    await gotoPrTab(page, REPO, prId);
    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await expect(frame.locator(".markdown-body").first()).toBeVisible({
        timeout: 60_000,
    });

    return frame;
}

/**
 * Telemetry is part of these scenarios' contract, so a served build that isn't
 * logging it must fail loudly rather than silently skip the assertions.
 */
function requireTelemetry(active: boolean): void {
    expect(
        active,
        "the served build isn't logging telemetry — let Playwright start the dev server, or start `dev:verify` with TELEMETRY_DEBUG=1",
    ).toBe(true);
}

function notice(frame: FrameLocator) {
    return frame.locator(".emr-toast--info");
}

/** Make the comment poller run now (instead of waiting up to 30s). */
async function refreshComments(frame: FrameLocator): Promise<void> {
    await frame
        .getByRole("button", { name: /^Refresh/ })
        .first()
        .click();
}

/** Open a new-comment draft and type `text` into it. */
async function draftComment(frame: FrameLocator, text: string) {
    const para = frame
        .locator(".emr-rendered p")
        .filter({ hasNot: frame.locator(".emr-highlight") })
        .first();

    await openDraftComposerBySelection(frame, {
        para,
        minNodeLen: 4,
        selLen: 12,
    });
    const draft = frame.locator(".emr-balloon.is-draft");
    const textarea = draft.locator("textarea.emr-textarea");
    await textarea.click();
    await textarea.fill(text);

    return { draft, textarea };
}

function postedThread(frame: FrameLocator, marker: string) {
    return frame.locator(".emr-balloon:not(.is-draft)[data-thread-id]").filter({ hasText: marker });
}

/**
 * A thread's root comment as ADO stores it: what was written, then the
 * "Markdown Review | open ↗" badge between its markers, linking to this PR's tab with
 * the thread selected by its link key.
 */
function withBackLinkTo(body: string): RegExp {
    const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(
        `^${escaped}\\n\\n<!-- emr:back-link -->\\n\\[!\\[Open in Markdown Review\\]\\(https://img\\.shields\\.io/badge/[^()\\s]+\\)\\]\\(https://[^()\\s]+/pullrequest/${prId}\\?[^()\\s]*_a=[^()\\s&]+markdown-review-pr-tab[^()\\s]*&comment=k-[\\da-f]{12}\\)\\n<!-- /emr:back-link -->$`,
    );
}

test.describe("When Azure DevOps misbehaves (fault-injected, real host)", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        prId = await discoverPullRequestId(page, REPO, E2E.prTitle);
        await page.close();
        // Sweep comments left behind by an earlier, interrupted run.
        await deleteCommentsContaining(REPO, prId, MARKER_PREFIX);
    });

    test("A: opening during the dead window reloads once and gets the user in", async ({
        page,
    }) => {
        test.setTimeout(150_000);
        const telemetry = collectTelemetry(page);
        await openPr(page);
        // The window survives the next load (our reload) and the automatic
        // reload after it escapes — the common production case.
        await fault(page, "deadWindow", { seconds: 120, healAfterBoots: 1 });

        const loads = countLoads(page);
        await page.reload();
        const frame = prTabFrame(page);
        await expect(frame.locator(".emr-error h2")).toHaveText(BOOT_HEADING, {
            timeout: 45_000,
        });
        await expect(frame.getByText("This only takes a moment.")).toBeVisible();

        await expect(frame.locator(".markdown-body").first()).toBeVisible({
            timeout: 60_000,
        });
        // Our reload + one automatic reload. The tab renders the cached PR as soon
        // as it mounts, which can be before the host page's own `load` fires, so
        // wait for it.
        await expect.poll(loads, { timeout: 30_000 }).toBe(2);

        requireTelemetry(telemetry.active());
        await expect
            .poll(() =>
                telemetry
                    .events()
                    .some(
                        (e) =>
                            e.name === "app.loaded" &&
                            e.properties?.afterAutoReload === true &&
                            e.measurements?.authRefreshWaitMs === 0,
                    ),
            )
            .toBe(true);
        // Exactly one automatic reload: no further one followed.
        expect(loads()).toBe(2);
    });

    test("B: if the reload doesn't help, there is no reload loop and the tab recovers on its own", async ({
        page,
    }) => {
        test.setTimeout(180_000);
        await openPr(page);
        await fault(page, "deadWindow", { seconds: 50 });

        const loads = countLoads(page);
        await page.reload();
        const frame = prTabFrame(page);
        await expect(frame.getByText("This only takes a moment.")).toBeVisible({
            timeout: 45_000,
        });
        // After the one automatic reload lands back in the window, the user is told
        // why and that it continues by itself — with no reload button, since the
        // window survives reloads — and no further reloads happen.
        await expect(frame.getByText(/so reloading won't help/)).toBeVisible({
            timeout: 45_000,
        });
        await expect(frame.getByRole("button", { name: "Reload page" })).toHaveCount(0);
        await expect(frame.getByRole("link", { name: /Why this happens/ })).toBeVisible();

        await expect(frame.locator(".markdown-body").first()).toBeVisible({
            timeout: 50_000 + RECOVERY_SLACK_MS,
        });
        expect(loads()).toBe(2);
    });

    test("D: a comment, then an edit of it, made during the window are held and each saved exactly once", async ({
        page,
    }) => {
        test.setTimeout(180_000);
        const marker = runMarker("held");
        const posted = `${marker} posted while reconnecting`;
        const edited = `${marker} edited while reconnecting`;

        try {
            const frame = await openPr(page);

            // Window 1: a new comment is held, then saved once.
            const { draft } = await draftComment(frame, posted);
            await fault(page, "deadWindow", { seconds: 30 });
            await draft.getByRole("button", { name: /^comment$/i }).click();
            await expect(draft.getByRole("button", { name: "Sending…" })).toBeVisible({
                timeout: 15_000,
            });
            await expect(notice(frame)).toContainText(NOTICE_HELD, {
                timeout: 15_000,
            });
            // A reload would drop the held change, so none is offered.
            await expect(notice(frame).getByRole("button")).toHaveCount(0);

            const thread = postedThread(frame, marker);
            await expect(thread).toBeVisible({
                timeout: 30_000 + RECOVERY_SLACK_MS,
            });
            await expect(frame.locator(".emr-toast--error")).toHaveCount(0);
            await expect
                .poll(async () =>
                    (await commentsContaining(REPO, prId, marker)).map((c) => c.content),
                )
                .toEqual([expect.stringMatching(withBackLinkTo(posted))]);
            // ADO's own comment UI shows the "Markdown Review | open ↗" badge; the
            // app shows only what was written.
            await expect(thread.locator(".emr-comment-content")).toHaveText(posted);
            await expect(notice(frame)).toHaveCount(0, {
                timeout: RECOVERY_SLACK_MS,
            });

            // Window 2: editing that comment is held — the editor stays open with
            // the text — then the edit is saved once. (One write is in flight at a
            // time by design: every composer's submit is disabled while sending.)
            await fault(page, "deadWindow", { seconds: 30 });
            await thread
                .getByRole("button", { name: /more options/i })
                .first()
                .click();
            await frame.getByRole("menuitem", { name: "Edit comment" }).click();
            const editor = thread.locator("textarea.emr-textarea");
            await editor.fill(edited);
            await thread.getByRole("button", { name: "Save" }).click();
            await expect(thread.getByRole("button", { name: "Sending…" })).toBeVisible({
                timeout: 15_000,
            });
            await expect(editor).toHaveValue(edited);
            await expect(notice(frame)).toContainText(NOTICE_HELD, {
                timeout: 15_000,
            });
            await expect(notice(frame).getByRole("button")).toHaveCount(0);

            // The rendered comment (not the editor box, which holds the same text
            // while the save is held) shows the edit once it is saved.
            await expect(thread.locator(".emr-comment-content", { hasText: edited })).toBeVisible({
                timeout: 30_000 + RECOVERY_SLACK_MS,
            });
            await expect(editor).toHaveCount(0);
            // The edit keeps the back link.
            await expect
                .poll(async () =>
                    (await commentsContaining(REPO, prId, marker)).map((c) => c.content),
                )
                .toEqual([expect.stringMatching(withBackLinkTo(edited))]);
        } finally {
            await deleteCommentsContaining(REPO, prId, marker);
        }
    });

    test("E: a typed reply survives 'Reload page' and is then saved exactly once", async ({
        page,
    }) => {
        test.setTimeout(180_000);
        const marker = runMarker("reply");

        try {
            let frame = await openPr(page);
            // Start a thread to reply to (no faults yet).
            const { draft } = await draftComment(frame, `${marker} thread`);
            await draft.getByRole("button", { name: /^comment$/i }).click();
            const thread = postedThread(frame, marker);
            await expect(thread).toBeVisible({ timeout: 30_000 });

            // Type a reply but don't send it; wait for the throttled draft write.
            await thread.locator(".emr-reply-trigger").first().click();
            await thread.locator("textarea.emr-textarea").fill(`${marker} reply`);
            await waitForPersistedDraft(frame, `${marker} reply`);

            // The window starts; the user takes the banner's "Reload page", which
            // escapes it here.
            await fault(page, "deadWindow", {
                seconds: 120,
                healAfterBoots: 0,
            });
            await refreshComments(frame);
            await expect(notice(frame)).toContainText(NOTICE_IDLE, {
                timeout: 30_000,
            });
            await notice(frame).getByRole("button", { name: "Reload page" }).click();

            // After the reload the reply composer is back with the text intact.
            frame = prTabFrame(page);
            await waitForFrameRoot(frame);

            const restored = postedThread(frame, marker).locator("textarea.emr-textarea");

            await expect(restored).toHaveValue(`${marker} reply`, {
                timeout: 60_000,
            });

            await postedThread(frame, marker)
                .getByRole("button", { name: /^reply$/i })
                .click();
            await expect(postedThread(frame, marker).getByText(`${marker} reply`)).toBeVisible({
                timeout: 30_000,
            });
            await expect
                .poll(async () => (await commentsContaining(REPO, prId, `${marker} reply`)).length)
                .toBe(1);
        } finally {
            await deleteCommentsContaining(REPO, prId, marker);
        }
    });

    test("H: a dropped connection on a write keeps the text and never posts twice", async ({
        page,
    }) => {
        test.setTimeout(120_000);
        const marker = runMarker("network");

        try {
            const frame = await openPr(page);

            const { draft, textarea } = await draftComment(frame, `${marker} comment`);

            await fault(page, "failNextWrite");
            await draft.getByRole("button", { name: /^comment$/i }).click();

            await expect(frame.locator(".emr-toast--error")).toContainText(
                "check your connection",
                { timeout: 20_000 },
            );
            await expect(textarea).toHaveValue(`${marker} comment`);
            expect(await commentsContaining(REPO, prId, marker)).toHaveLength(0);

            await draft.getByRole("button", { name: /^comment$/i }).click();
            await expect(postedThread(frame, marker)).toBeVisible({
                timeout: 30_000,
            });
            await expect
                .poll(async () => (await commentsContaining(REPO, prId, marker)).length)
                .toBe(1);
        } finally {
            await deleteCommentsContaining(REPO, prId, marker);
        }
    });
});
