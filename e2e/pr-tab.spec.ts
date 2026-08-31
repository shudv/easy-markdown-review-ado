// E2E: the Markdown Review PR tab — our `ms.vss-web.tab` contribution on the
// pull-request details page, rendering a PR's changed Markdown files with
// anchored review comments inside a real ADO contribution iframe.
//
// Why this needs the real host: the PR tab only exists *inside* ADO's
// pull-request view and depends on host context the Documents hub never
// exercises — the SDK resolves the active PR/project from the page, and the tab
// bundle is served cross-origin from the dev origin
// (https://localhost:3000/pr-tab/pr-tab.html). Unit tests and Storybook mount
// the shared <PrShell/> in a plain page; they cannot reproduce the PR-tab SDK
// handshake, the changed-file discovery, or the Git diff/thread load.
//
// The PR id is discovered at runtime (filtered by a known source branch) rather
// than hard-coded, because sandbox PR ids depend on provisioning order.

import { test, expect } from "@playwright/test";

import { E2E } from "./env";
import {
  discoverPullRequestId,
  gotoPrTab,
  openDraftComposerBySelection,
  prTabFrame,
  prTabIframeElement,
  waitForFrameRoot,
} from "./helpers";

test.describe("Markdown Review PR tab (real ADO host)", () => {
  test("mounts the contribution iframe and renders the PR's changed Markdown", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    // ADO must render OUR PR-tab iframe (matched by the dev-origin bundle URL,
    // so a co-installed prod extension can't satisfy it).
    await expect(prTabIframeElement(page)).toBeVisible({ timeout: 30_000 });

    // The cross-origin localhost iframe must actually commit and boot our React
    // tree — the step the integrated browser can't do with a self-signed cert
    // but the Playwright context (ignoreHTTPSErrors) can.
    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    // The PR tab must leave its "Loading pull request context…" state for a
    // terminal one: the reader (changed Markdown), the no-md-files notice, or an
    // error. Any of those proves the SDK handshake + first data turn completed.
    const settled = frame.locator(
      ".markdown-body, h2:has-text('No Markdown files changed'), .emr-error h2",
    );
    await expect(settled.first()).toBeVisible({ timeout: 45_000 });
    await expect(frame.locator(".emr-loading")).toHaveCount(0);

    // The target PR changes real Markdown, so the reader must paint a non-empty
    // document — proving the Git diff load + render pipeline ran end to end.
    const article = frame.locator(".markdown-body").first();
    await expect(article).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(async () => (await article.innerText()).trim().length, {
        timeout: 20_000,
        message: "PR-tab reader rendered no Markdown text",
      })
      .toBeGreaterThan(0);
  });

  test("renders the PR's seeded review comment thread", async ({ page }) => {
    // The `document-threads` PR carries a seeded thread anchored in the changed
    // Markdown, so the tab must surface it as an in-document highlight — the
    // host-only path where PR threads load against the live collection.
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

    // At least one anchored comment highlight (carrying its thread id) must
    // render — proves emr-authored threads loaded and anchored to the document.
    await expect(
      frame.locator(".emr-highlight[data-thread-id]").first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("selecting rendered text opens a draft composer anchored to the excerpt", async ({
    page,
  }) => {
    // The wiring only the real cross-origin iframe exercises: a genuine text
    // selection in the rendered Markdown must fire the article's mouseup →
    // requestAnimationFrame path, surface the floating "Add comment" bubble,
    // and (on click) open a draft composer anchored to the selected excerpt.
    // This proves selection → capture → compose end-to-end WITHOUT persisting a
    // comment to ADO (we cancel), so the shared sandbox PR stays clean.
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    // Drive a real DOM selection over the paragraph's first text node and click
    // the floating "Add comment" bubble. The cross-origin iframe can swallow the
    // first mouseup (before the article's mouseup → rAF handler has wired), so
    // the shared helper RETRIES the select → bubble step rather than doing it
    // single-shot — otherwise this races and flakes on the first tick.
    const selectedText = await openDraftComposerBySelection(frame);

    const draft = frame.locator(".emr-balloon.is-draft");
    // The "Anchored to" meta echoes a fragment of what we selected — proving
    // the captured anchor carries the real excerpt, not an empty/line-1 stub.
    await expect(draft.locator(".emr-balloon-meta")).toContainText(
      selectedText.trim().slice(0, 10),
      { timeout: 10_000 },
    );

    // Cancel — never persist to the shared sandbox PR.
    await draft.getByRole("button", { name: /^cancel$/i }).click();
    await expect(draft).toHaveCount(0, { timeout: 10_000 });
  });

  test("triple-clicking a rendered line surfaces the add-comment bubble", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    const paragraph = frame
      .locator(".emr-rendered p:not(:has(.emr-highlight))")
      .filter({ hasText: /\S/ })
      .first();
    await paragraph.waitFor({ state: "visible", timeout: 45_000 });
    const bubble = frame.locator(".emr-selection-bubble");

    // A triple-click ends at the next block's element boundary in Chromium.
    // Focus the contribution first, then retry isolated triple-click gestures.
    // Clear the previous Selection and leave enough time between attempts that
    // Chromium cannot merge retries into a 4th/5th click sequence (which has
    // different native selection semantics).
    await paragraph.click();
    let surfaced = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await paragraph.evaluate(() => window.getSelection()?.removeAllRanges());
      if (attempt > 0) await page.waitForTimeout(750);
      await paragraph.click({ clickCount: 3, delay: 90 });
      surfaced = await bubble
        .waitFor({ state: "visible", timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      const selected = await frame
        .locator("html")
        .evaluate(() => window.getSelection()?.toString().trim() ?? "");
      if (surfaced && selected.length > 0) break;
      surfaced = false;
    }
    expect(surfaced, "triple-click selection never surfaced Add comment").toBe(
      true,
    );

    const selected = await frame
      .locator("html")
      .evaluate(() => window.getSelection()?.toString().trim());
    expect(selected).toBeTruthy();
    await expect(
      bubble.getByRole("button", { name: /add comment/i }),
    ).toBeVisible();
  });

  test("preserves an in-progress draft across a page reload", async ({
    page,
  }) => {
    // The local-persistence path: a draft that's been typed into (but not
    // posted) must survive a full reload of the PR tab — the shell persists it
    // to localStorage (scope "pr") and restores the balloon + text on mount.
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    let frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    await openDraftComposerBySelection(frame);
    const draftText = "Draft that should survive a reload";
    await frame
      .locator(".emr-balloon.is-draft textarea.emr-textarea")
      .fill(draftText);
    // Let the throttled localStorage write settle (leading + trailing, 500ms).
    await page.waitForTimeout(800);

    // Reload the whole host page; the contribution iframe re-mounts from
    // scratch and must restore the draft from localStorage.
    await page.reload({ waitUntil: "domcontentloaded" });
    frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    const restored = frame.locator(".emr-balloon.is-draft");
    await expect(restored).toBeVisible({ timeout: 30_000 });
    await expect(restored.locator("textarea.emr-textarea")).toHaveValue(
      draftText,
      { timeout: 15_000 },
    );

    // Cancel clears the persisted draft so the sandbox browser state stays
    // clean for later runs.
    await restored.getByRole("button", { name: /^cancel$/i }).click();
    await expect(restored).toHaveCount(0, { timeout: 10_000 });
  });

  test("blocks a second draft with a discard dialog (never loses the first)", async ({
    page,
  }) => {
    // The "one active draft" guard: with a reply draft holding text, starting a
    // *new comment* prompts a blocking discard dialog. "Keep editing" preserves
    // the reply. Nothing is posted to the sandbox PR (we cancel at the end).
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

    // Open the seeded thread's reply composer and type — this is the active
    // draft. (The target PR carries a seeded anchored thread.)
    const highlight = frame.locator(".emr-highlight[data-thread-id]").first();
    await expect(highlight).toBeVisible({ timeout: 30_000 });
    await highlight.click();
    const balloon = frame.locator(".emr-balloon.is-active").first();
    await balloon.getByRole("button", { name: /mention or reply/i }).click();
    const draftText = "Reply draft — must not be lost";
    await balloon.locator("textarea.emr-textarea").fill(draftText);

    // Attempt a NEW comment over an article selection → the guard dialog.
    await frame
      .locator(".emr-rendered p")
      .first()
      .evaluate((el: HTMLElement) => {
        const textNode = Array.from(el.childNodes).find(
          (n) =>
            n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").length > 8,
        ) as Text | undefined;
        if (!textNode) return;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(12, textNode.data.length));
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    await frame
      .locator(".emr-selection-bubble")
      .getByRole("button", { name: /add comment/i })
      .click();

    const dialog = frame.locator(".emr-draft-guard-overlay");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // The dialog shows a snippet of the at-risk draft.
    await expect(dialog).toContainText(draftText.slice(0, 12));

    // Keep editing preserves the reply draft's text (no new-comment balloon).
    await dialog.getByRole("button", { name: /keep editing/i }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(frame.locator(".emr-balloon.is-draft")).toHaveCount(0);
    await expect(balloon.locator("textarea.emr-textarea")).toHaveValue(
      draftText,
      { timeout: 10_000 },
    );

    // Clean up — cancel the reply so nothing lingers for later runs.
    await balloon.getByRole("button", { name: /^cancel$/i }).click();
  });

  test("@-mention typeahead resolves a user to a display-name pill", async ({
    page,
  }) => {
    // Validates the mention round-trip wiring in the real host: the @-picker
    // queries ADO identities, committing writes the ADO-native `@<GUID>` token,
    // and our renderer resolves it to the person's name via the identity store.
    // Read-only: we compose in the draft and cancel (no comment persisted).
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    // Reuse the selection helper that retries until the real iframe has wired
    // its mouseup handler and the draft is visibly mounted.
    await openDraftComposerBySelection(frame, { minNodeLen: 4, selLen: 12 });

    const textarea = frame.locator(
      ".emr-balloon.is-draft textarea.emr-textarea",
    );
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // Type an `@` mention query. The picker queries ADO's identity service.
    // Use the configured query (a real user prefix, e.g. "shudwi") rather than a
    // lone letter. Even so, the LIVE identity typeahead can return an empty
    // first page when the service is cold or throttled, leaving the picker
    // briefly optionless — which is what still made this step flaky. Re-drive the
    // query (clear + retype) until a real suggestion row appears, so a transient
    // empty response self-heals instead of failing the run.
    const picker = frame.locator(".emr-mention-picker");
    const firstOption = picker
      .locator("button[role=option].emr-mention-picker-row")
      .first();
    let displayName = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      await textarea.fill(`@${E2E.mentionQuery}`);
      try {
        await firstOption.waitFor({ state: "visible", timeout: 10_000 });
        displayName = (
          await firstOption.locator(".emr-mention-picker-primary").innerText()
        ).trim();
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        // Re-entering the same value does not fire input; clear first so the
        // next attempt issues a fresh, debounced identity request.
        await textarea.fill("");
        await page.waitForTimeout(500);
      }
    }
    expect(displayName, "identity option had no display name").toBeTruthy();

    // Commit the selected first suggestion from the still-focused textarea.
    // Keyboard commit is stable even if the live picker row re-renders between
    // the option wait and the action; clicking that transient row was flaky.
    await textarea.press("Enter");
    await expect(picker).toHaveCount(0, { timeout: 10_000 });

    // While typing, the composer shows the
    // person's readable name (the ADO-native `@<GUID>` token is only encoded on
    // submit) — so the author never sees a raw GUID as they compose.
    // The Write area shows a readable `@Name`, NOT the raw `@<GUID>` token.
    await expect
      .poll(() => textarea.inputValue(), { timeout: 10_000 })
      .toContain(`@${displayName}`);
    await expect(textarea).not.toHaveValue(/@</);

    // In the Preview tab the mention resolves to a display-name pill (identity
    // store seeded from the picker suggestion — no raw GUID shown).
    await frame
      .locator(".emr-balloon.is-draft")
      .getByRole("button", { name: /^preview$/i })
      .click();
    const pill = frame.locator(
      '.emr-balloon.is-draft .emr-preview .emr-mention[data-mention-kind="user"]',
    );
    await expect(pill).toBeVisible({ timeout: 10_000 });
    await expect(pill).toContainText(displayName);
    await expect(pill).not.toContainText(/^@?<?[0-9a-fA-F-]{36}>?$/);

    // Cancel — never persist to the shared sandbox PR.
    await frame
      .locator(".emr-balloon.is-draft")
      .getByRole("button", { name: /^cancel$/i })
      .click();
    await expect(frame.locator(".emr-balloon.is-draft")).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("a mentioned non-author resolves to a name on load (persist → reload)", async ({
    page,
  }) => {
    // The definitive regression guard for "@mentions show a raw GUID on load".
    // Compose a comment that @-mentions a real org user who is NOT the comment's
    // author (so their name can't come from the author seed), COMMIT it, then
    // reload the tab from scratch. On the fresh load the picker's in-memory seed
    // is gone, so the reader pill can only be named from what we persisted onto
    // the thread at compose time (the `emrMentions` property) — the only source
    // that resolves a cross-tenant guest in a personal-MSA org, where ADO's
    // `thread.identities` map is null and the by-id identity endpoint returns
    // null too. Finally delete the comment so the sandbox PR stays clean (runs
    // even if an assertion fails).
    const GUID_RE = /^@?<?[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}>?$/;
    // Unique marker so we can find (and later delete) exactly our thread after a
    // full reload, without depending on ordering or other sandbox comments.
    const marker = `emr-e2e-mention-${Date.now()}`;

    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);

    let frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    // Open a draft via a real selection over a paragraph with no existing
    // highlight (so its first child is a plain, range-selectable text node).
    // Routed through the shared helper, which RETRIES the select → bubble step
    // — the first mouseup after the iframe mounts can be swallowed before the
    // article's rAF handler wires, so a single-shot selection flakes.
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
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // Type the marker, then drive the @-picker to mention the configured
    // non-author user. Picking writes the ADO-native `@<GUID>` token.
    await textarea.click();
    await textarea.type(`${marker} `, { delay: 10 });
    await textarea.type("@", { delay: 30 });
    await textarea.type(E2E.mentionQuery, { delay: 60 });

    const picker = frame.locator(".emr-mention-picker");
    await picker.waitFor({ state: "visible", timeout: 15_000 });
    // Prefer a row whose secondary line is a *different* tenant email (the
    // cross-tenant guest, e.g. `@microsoft.com`) over the signed-in account:
    // the guest is the identity ADO can't resolve on load, so it's the one that
    // actually exercises the persisted-mention fix. Fall back to the first row.
    const rows = picker.locator("button[role=option].emr-mention-picker-row");
    await rows.first().waitFor({ state: "visible", timeout: 10_000 });
    const guestRow = rows.filter({
      has: frame.locator(".emr-mention-picker-secondary", {
        hasText: /@microsoft\.com/i,
      }),
    });
    const pick = (await guestRow.count()) > 0 ? guestRow.first() : rows.first();
    await pick.click();
    // While typing, the composer shows the readable name (not a raw GUID); the
    // ADO-native `@<GUID>` token is only encoded on submit.
    await expect
      .poll(async () => textarea.inputValue(), { timeout: 10_000 })
      .not.toContain("@<");

    // Commit the comment to the real PR thread.
    await draft.getByRole("button", { name: /^comment$/i }).click();

    // The persisted (non-draft) balloon carrying our marker must appear.
    const posted = frame
      .locator(".emr-balloon:not(.is-draft)[data-thread-id]")
      .filter({ hasText: marker });
    await expect(posted).toBeVisible({ timeout: 20_000 });

    // Reply to the thread WITH a mention. This exercises the addReply path,
    // which previously tried (and failed) to PATCH thread properties — ADO
    // rejects that with "Comment thread properties cannot be updated". The
    // reply must persist with NO error toast.
    await posted.locator(".emr-reply-trigger").first().click();
    const replyBox = posted.locator("textarea.emr-textarea");
    await expect(replyBox).toBeVisible({ timeout: 10_000 });
    await replyBox.click();
    await replyBox.type(`reply @`, { delay: 30 });
    await replyBox.type(E2E.mentionQuery, { delay: 60 });
    const replyPicker = frame.locator(".emr-mention-picker");
    await replyPicker.waitFor({ state: "visible", timeout: 15_000 });
    await replyPicker
      .locator("button[role=option].emr-mention-picker-row")
      .first()
      .click();
    await posted.getByRole("button", { name: /^reply$/i }).click();
    // No persistence error toast may appear (the reply-properties regression).
    await expect(frame.locator(".emr-toast--error")).toHaveCount(0, {
      timeout: 10_000,
    });

    try {
      // Reload from scratch: drops the picker's in-memory identity seed, so the
      // only remaining name source is what we persisted onto the thread
      // (the emrMentions property).
      await gotoPrTab(page, E2E.prRepo, prId);
      frame = prTabFrame(page);
      await waitForFrameRoot(frame);

      const reloaded = frame
        .locator(".emr-balloon:not(.is-draft)[data-thread-id]")
        .filter({ hasText: marker });
      await expect(reloaded).toBeVisible({ timeout: 45_000 });

      // EVERY user-mention pill in our comment must render a display NAME, never
      // a bare GUID — this catches the cross-tenant-guest regression where one
      // pill stayed a raw GUID while the author pill resolved.
      const pills = reloaded.locator(
        '.emr-comment-body .emr-mention[data-mention-kind="user"]',
      );
      await expect(pills.first()).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () => {
            const texts = await pills.allTextContents();
            return texts.map((t) => t.trim());
          },
          {
            timeout: 20_000,
            message: "a mention did not resolve to a name on load",
          },
        )
        .not.toContain("");
      const texts = await pills.allTextContents();
      for (const t of texts) {
        expect(t.trim(), `pill "${t}" is still a raw GUID`).not.toMatch(
          GUID_RE,
        );
      }
    } finally {
      // Clean up: delete our thread so the shared sandbox PR stays pristine.
      const target = frame
        .locator(".emr-balloon:not(.is-draft)[data-thread-id]")
        .filter({ hasText: marker })
        .first();
      if (await target.count()) {
        await target
          .getByRole("button", { name: /more options/i })
          .first()
          .click();
        await frame.getByRole("menuitem", { name: /delete thread/i }).click();
        await frame.getByRole("button", { name: /^delete$/i }).click();
        await expect(
          frame
            .locator(".emr-balloon:not(.is-draft)[data-thread-id]")
            .filter({ hasText: marker }),
        ).toHaveCount(0, { timeout: 20_000 });
      }
    }
  });
});
