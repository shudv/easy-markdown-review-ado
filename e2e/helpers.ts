// Shared e2e helpers: locating our contribution iframes inside the real ADO
// host and driving the bits of ADO chrome the specs need.
//
// NOTE on resilience: anything that touches ADO's own UI (the "..." file menu,
// the repo picker) is matched by role/text rather than internal class names so
// it survives host UI tweaks. Anything that touches OUR contribution is matched
// by the bundle URL (served from the dev origin) or by data-testid hooks we own.

import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

import { DEV_ORIGIN_HOST, E2E, hubUrl, prTabUrl } from "./env";

/**
 * The `<iframe>` element ADO renders for our Documents hub contribution. We
 * match on the dev-origin bundle URL (`localhost:3000/.../documents-hub.html`)
 * so it can never resolve to a co-installed prod contribution served from the
 * Marketplace CDN.
 */
export function hubIframeElement(page: Page): Locator {
  return page.locator(
    `iframe[src*="${DEV_ORIGIN_HOST}"][src*="documents-hub.html"]`,
  );
}

/** FrameLocator into the Documents hub contribution iframe. */
export function hubFrame(page: Page): FrameLocator {
  return page.frameLocator(
    `iframe[src*="${DEV_ORIGIN_HOST}"][src*="documents-hub.html"]`,
  );
}

/**
 * Navigate the top page straight to the Documents hub contribution, optionally
 * with deep-link query params (`{ repo, path, comment }`). The hub reads these
 * from the host navigation service, so they must ride on the *top* page URL —
 * not the iframe src.
 */
export async function gotoDocumentsHub(
  page: Page,
  params?: Record<string, string>,
): Promise<void> {
  let url = hubUrl();
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params).toString();
    url += `${url.includes("?") ? "&" : "?"}${qs}`;
  }
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

/** Wait until the contribution React root inside the iframe has mounted. */
export async function waitForFrameRoot(frame: FrameLocator): Promise<void> {
  // #root is the mount point for every contribution; once it has children the
  // React tree is up.
  await expect(frame.locator("#root")).toBeVisible();
}

/** Read the `?repo=` (repo GUID) param from the top (host) page URL. */
export function repoParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get("repo");
}

/**
 * Switch repositories via the in-hub repo picker (the only way to learn a
 * repo's GUID without an authenticated API call: selecting it writes
 * `?repo=<guid>` onto the host URL). Returns the resolved repo GUID.
 *
 * The cross-origin iframe can swallow the first pointer event, so the open +
 * select steps are retried until they take.
 */
export async function selectRepoInPicker(
  page: Page,
  frame: FrameLocator,
  repoName: string,
): Promise<string> {
  const trigger = frame.locator("button.emr-docnav-repo-btn");
  await trigger.waitFor({ state: "visible", timeout: 45_000 });

  // The trigger always displays the *currently selected* repo's name. We use
  // that as the success signal rather than "?repo= changed from its prior
  // value": the hub restores the last-visited repo from its persisted cache on
  // load, so the host URL may ALREADY hold this repo's GUID — a "param changed"
  // signal would then never fire and time out (the actual flake). Re-selecting
  // the active repo still re-pins `?repo=` (onSelectRepo runs unconditionally),
  // so driving the picker is safe even when we're already on the target.
  const triggerName = frame.locator(
    "button.emr-docnav-repo-btn .emr-docnav-repo-name",
  );
  const list = frame.locator(".emr-docnav-repo-list");
  const filter = frame.locator("input.emr-docnav-repo-filter-input");
  const option = frame
    .locator("button[role=option].emr-docnav-repo-option")
    .filter({ hasText: repoName })
    .first();

  // Drive open -> (filter) -> click as idempotent steps, retrying the whole
  // sequence until the picker trigger shows `repoName`. Each action is
  // best-effort (`.catch`) so a transient re-render — the menu re-paints as
  // repos stream in — just retries instead of failing the poll. Crucially we
  // only click the trigger when the menu is closed, so we never toggle our own
  // menu shut.
  await expect
    .poll(
      async () => {
        if (!(await list.isVisible().catch(() => false))) {
          await trigger.click().catch(() => {});
          await list
            .waitFor({ state: "visible", timeout: 4_000 })
            .catch(() => {});
        }
        // Paginated orgs render a filter box; narrow the list so the option is
        // in view even when the repo lives beyond the first page.
        if (await filter.isVisible().catch(() => false)) {
          await filter.fill(repoName).catch(() => {});
        }
        if (await option.isVisible().catch(() => false)) {
          await option.click().catch(() => {});
        }
        return (await triggerName.innerText().catch(() => "")).trim();
      },
      { timeout: 30_000, message: `repo "${repoName}" never selectable` },
    )
    .toBe(repoName);

  // The hub pins `?repo=<guid>` on selection and back-fills it when restoring
  // from cache; wait for it in case the param lands a tick after the label.
  await expect
    .poll(() => repoParam(page), {
      timeout: 10_000,
      message: `?repo= missing after selecting "${repoName}"`,
    })
    .toBeTruthy();

  return repoParam(page)!;
}

/**
 * Assert the reader has rendered the document whose top-level heading matches
 * `headingRe`. The markdown `# Title` becomes the first `<h1>` inside
 * `.markdown-body`, so this uniquely identifies which document is open.
 */
export async function expectReaderHeading(
  frame: FrameLocator,
  headingRe: RegExp,
): Promise<void> {
  const h1 = frame.locator(".markdown-body h1").first();
  await expect(h1).toBeVisible({ timeout: 45_000 });
  await expect(h1).toHaveText(headingRe, { timeout: 20_000 });
}

/**
 * Open a document guaranteed to be commentable AND to carry a seeded thread:
 * `repoA`'s `mdPathA`, which is routed to a completed PR. The hub defaults to
 * the alphabetically-first repo, which may be a fixture repo whose only PR is
 * still active (read-only — no threads, no draft composer), so the comment /
 * draft specs must target a known commentable document explicitly rather than
 * rely on that default.
 *
 * Learns the repo GUID via the picker (the only name→GUID bridge) then
 * deep-links `?repo=&path=` to the document. Returns the frame plus the repo
 * GUID and slash-free path so a caller can re-navigate (e.g. add `?comment=`).
 */
export async function openCommentableDoc(
  page: Page,
): Promise<{ frame: FrameLocator; repo: string; path: string }> {
  await gotoDocumentsHub(page);
  await waitForFrameRoot(hubFrame(page));
  const repo = await selectRepoInPicker(page, hubFrame(page), E2E.repoA);
  const path = E2E.mdPathA.replace(/^\/+/, "");
  await gotoDocumentsHub(page, { repo, path });
  const frame = hubFrame(page);
  await waitForFrameRoot(frame);
  await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });
  return { frame, repo, path };
}

// --- PR tab -------------------------------------------------------------

/**
 * The `<iframe>` element ADO renders for our Markdown Review PR tab. Matched on
 * the dev-origin bundle URL (`localhost:3000/.../pr-tab.html`) so it can never
 * resolve to a co-installed prod contribution served from the Marketplace CDN.
 */
export function prTabIframeElement(page: Page): Locator {
  return page.locator(`iframe[src*="${DEV_ORIGIN_HOST}"][src*="pr-tab.html"]`);
}

/** FrameLocator into the PR-tab contribution iframe. */
export function prTabFrame(page: Page): FrameLocator {
  return page.frameLocator(
    `iframe[src*="${DEV_ORIGIN_HOST}"][src*="pr-tab.html"]`,
  );
}

/**
 * Discover a pull request id at runtime from the authenticated PR-list UI,
 * matching the PR by title. Hard-coding an id would be brittle — ids depend on
 * sandbox provisioning order — and the org's session cookie can't authorize the
 * `_apis` REST endpoint (it's bounced to a sign-in page), so the web UI is the
 * only reliable, authenticated source.
 *
 * Sandbox PRs are completed by default, so we open the matching-status filter
 * list (falling back to clicking the status tab if the URL filter doesn't take)
 * and read the id out of the matching PR row's link. Pass `status: "active"`
 * for a PR that's intentionally left open (e.g. the doc-links showcase PR).
 */
export async function discoverPullRequestId(
  page: Page,
  repo: string,
  prTitle: string,
  status: "completed" | "active" = "completed",
): Promise<number> {
  const link = page
    .locator('a[href*="/pullrequest/"]')
    .filter({ hasText: prTitle })
    .first();

  await page.goto(
    `${E2E.orgUrl}/${encodeURIComponent(E2E.project)}/_git/${repo}/pullrequests?_a=${status}`,
    { waitUntil: "domcontentloaded" },
  );

  if (!(await link.isVisible({ timeout: 8_000 }).catch(() => false))) {
    // The URL filter didn't surface it — flip to the matching view via chrome.
    const statusRe = new RegExp(status, "i");
    const tab = page
      .getByRole("tab", { name: statusRe })
      .or(page.getByRole("link", { name: statusRe }))
      .first();
    await tab.click({ timeout: 8_000 }).catch(() => {});
    await link.waitFor({ state: "visible", timeout: 20_000 });
  }

  const href = await link.getAttribute("href");
  const match = href?.match(/\/pullrequest\/(\d+)/);
  expect(
    match,
    `could not extract a PR id from the "${prTitle}" row (href="${href}") — is the sandbox provisioned?`,
  ).toBeTruthy();
  return Number(match![1]);
}

/** Navigate the top page to a PR with our Markdown Review tab pre-selected. */
export async function gotoPrTab(
  page: Page,
  repo: string,
  prId: number | string,
): Promise<void> {
  await page.goto(prTabUrl(repo, prId), { waitUntil: "domcontentloaded" });
}

/**
 * Open a draft comment composer by driving a real DOM selection over the first
 * selectable paragraph in the rendered article, then clicking the floating
 * "Add comment" bubble. Returns the excerpt that was selected (so callers can
 * assert the draft anchored to it). Playwright's synthetic mouse drag can't
 * reliably select text inside the cross-origin iframe, so we build the Range
 * and dispatch `mouseup` ourselves — the same path the shell listens on.
 *
 * The cross-origin iframe can swallow the first selection event (the article's
 * mouseup → requestAnimationFrame handler may not have wired yet on the very
 * first tick after render), so the select → bubble step is retried until the
 * bubble appears — mirroring the resilience pattern used by the repo picker.
 */
export async function openDraftComposerBySelection(
  frame: FrameLocator,
  opts: { para?: Locator; minNodeLen?: number; selLen?: number } = {},
): Promise<string> {
  const para = opts.para ?? frame.locator(".emr-rendered p").first();
  const minNodeLen = opts.minNodeLen ?? 8;
  const selLen = opts.selLen ?? 24;
  await para.waitFor({ state: "visible", timeout: 45_000 });

  const bubble = frame.locator(".emr-selection-bubble");

  // Drive the selection, retrying until the floating bubble surfaces. Each
  // attempt re-creates the Range and re-dispatches mouseup; a transient miss
  // (swallowed event / not-yet-wired handler) just retries instead of failing.
  let selectedText: string | null = null;
  await expect
    .poll(
      async () => {
        selectedText = await para.evaluate(
          (el: HTMLElement, cfg: { minNodeLen: number; selLen: number }) => {
            const textNode = Array.from(el.childNodes).find(
              (n) =>
                n.nodeType === Node.TEXT_NODE &&
                (n.textContent ?? "").length > cfg.minNodeLen,
            ) as Text | undefined;
            if (!textNode) return null;
            const len = Math.min(cfg.selLen, textNode.data.length);
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, len);
            const sel = window.getSelection()!;
            sel.removeAllRanges();
            sel.addRange(range);
            el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return textNode.data.slice(0, len);
          },
          { minNodeLen, selLen },
        );
        return await bubble.isVisible().catch(() => false);
      },
      {
        timeout: 30_000,
        message: "selection never surfaced the Add comment bubble",
      },
    )
    .toBe(true);
  expect(selectedText, "paragraph had no selectable text node").toBeTruthy();

  await bubble.getByRole("button", { name: /add comment/i }).click();

  const draft = frame.locator(".emr-balloon.is-draft");
  await expect(draft).toBeVisible({ timeout: 10_000 });
  await expect(draft.locator("textarea.emr-textarea")).toBeVisible({
    timeout: 10_000,
  });
  return selectedText!;
}

// --- Host theme ---------------------------------------------------------

/**
 * The `data-emr-theme` our extension writes on the iframe document's `<html>`
 * to mirror the host theme (see `src/theme/theme.ts`). Reading it from inside
 * the contribution iframe is how we prove the extension adapted to the host.
 * Returns `null` before the first theme sync has run.
 */
export async function readEmrTheme(
  frame: FrameLocator,
): Promise<string | null> {
  return frame
    .locator("html")
    .getAttribute("data-emr-theme", { timeout: 30_000 });
}

/** Whether a resolved `data-emr-theme` value denotes a dark palette. */
export function isDarkEmrTheme(theme: string | null): boolean {
  return theme === "dark" || theme === "hc-dark";
}

/**
 * Switch the Azure DevOps host theme through the real profile menu — the same
 * flow a user takes — and return the label of the theme that was selected.
 *
 * ADO's theme picker is a *two-level* menu, not a single control: the top-right
 * "User settings" gear opens a menu with a "Theme" item, which in turn opens a
 * submenu of palette options ("Light", "Dark", "Blue", "Windows High
 * Contrast"). We drive the host chrome by role/text (never internal class
 * names) so the flow survives host UI tweaks, and retry each hop because the
 * global header can swallow the first pointer event just like the contribution
 * iframes do.
 *
 * `target` picks the palette by regex so callers can flip to whichever theme is
 * the opposite of the currently-applied one.
 */
export async function setAdoTheme(page: Page, target: RegExp): Promise<string> {
  // Pull focus back into the TOP frame first. After we've driven the hub's
  // cross-origin iframe (repo picker, article) the active element lives inside
  // it, and ADO's global header swallows the first pointer event that arrives
  // while focus is trapped there — the same "first click is swallowed" quirk
  // the repo picker guards against. Pressing Escape + clicking the org logo (an
  // inert top-frame anchor) lands focus in the host chrome so the gear opens on
  // the first real click.
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .getByRole("link", { name: /Azure DevOps organization home page/i })
    .first()
    .focus()
    .catch(() => {});

  // Level 0: the user-settings gear in the global header. ADO wraps the gear
  // button in a `menuitem` that carries the `aria-expanded` open-state, so we
  // address the menuitem (for open detection) and click through to its button.
  const gearItem = page
    .getByRole("menuitem", { name: /user settings|profile/i })
    .first();
  const gearBtn = gearItem.getByRole("button").first();

  // Level 1: the "Theme" row inside the opened settings menu. Addressed by its
  // menuitem role + exact name so we land the visible, actionable flyout row
  // (a bare text match can resolve to a hidden template duplicate in DOM order).
  const themeItem = page
    .getByRole("menuitem", { name: "Theme", exact: true })
    .first();

  // Open the gear menu deterministically: drive `aria-expanded` to "true"
  // rather than blindly re-clicking (a blind re-click toggles an already-open
  // menu shut). Each click is followed by a short settle so the flyout — which
  // populates its rows a tick after opening — can render before we re-check.
  await expect
    .poll(
      async () => {
        const exp = await gearItem
          .getAttribute("aria-expanded")
          .catch(() => null);
        if (exp !== "true") await gearBtn.click().catch(() => {});
        await page.waitForTimeout(600);
        return gearItem.getAttribute("aria-expanded").catch(() => null);
      },
      { timeout: 30_000, message: "ADO settings menu never opened" },
    )
    .toBe("true");

  // The Theme row lands a tick after the menu opens.
  await themeItem.waitFor({ state: "visible", timeout: 10_000 });

  // Level 2: clicking "Theme" opens a "Choose your theme" DIALOG (not a
  // submenu) of theme swatches — each a generic element whose accessible name
  // is the palette label ("Dark", "Light", "Blue", …). Open the dialog and
  // click the swatch matching `target`; ADO applies the theme live on click.
  const dialog = page.getByRole("dialog", { name: /choose your theme/i });
  const swatch = dialog.getByText(target, { exact: true }).first();
  let selectedLabel = "";
  await expect
    .poll(
      async () => {
        if (!(await swatch.isVisible().catch(() => false))) {
          await themeItem.click().catch(() => {});
          await dialog
            .waitFor({ state: "visible", timeout: 4_000 })
            .catch(() => {});
        }
        if (await swatch.isVisible().catch(() => false)) {
          selectedLabel = (await swatch.innerText().catch(() => "")).trim();
          await swatch.click().catch(() => {});
        }
        return selectedLabel;
      },
      {
        timeout: 30_000,
        message: `ADO theme swatch matching ${target} never selectable`,
      },
    )
    .toMatch(target);

  // Dismiss the theme dialog if it stayed open (some ADO builds keep it up
  // after applying) so the host chrome returns to a neutral state.
  await dialog
    .getByRole("button", { name: /close/i })
    .click({ timeout: 3_000 })
    .catch(() => {});

  return selectedLabel;
}
