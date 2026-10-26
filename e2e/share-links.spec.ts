// E2E: shareable links in the Markdown Review PR tab and the Documents hub,
// against the real ADO host.
//
// The bug this guards: "Link to comment" in the PR tab used to copy the
// extension iframe's own URL (a Marketplace-CDN `pr-tab.html#comment-1`, which
// opens a blank page), because the PR REST payload has no `_links.web` to
// build a host URL from. Only the real host can prove the fix end to end:
//
//   * the copied link must be the PR page URL with our tab selected (`_a`),
//     the open document (`path`) and the target (`comment` / `anchor`);
//   * the address bar must mirror the same link (via the host navigation
//     service) without ADO dropping our params or leaving our tab;
//   * opening that link fresh must land on the right file and target — the
//     route params only reach the contribution through the host.
//
// Clipboard: ADO's iframe doesn't delegate `clipboard-write`, so the app copies
// through the legacy `execCommand("copy")` fallback. An init script (runs in
// every frame, including our cross-origin iframe) records what each copy wrote
// so the spec can read it back without touching the OS clipboard.

import type { BrowserContext, FrameLocator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { DEV_ORIGIN_HOST, E2E } from "./env";
import {
  discoverPullRequestId,
  expectReaderHeading,
  gotoPrTab,
  hubFrame,
  openCommentableDoc,
  prTabFrame,
  waitForFrameRoot,
} from "./helpers";

declare global {
  interface Window {
    __emrLastCopy?: string;
  }
}

/** Record the text of every `execCommand("copy")` / `clipboard.writeText`. */
async function recordCopies(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const exec = document.execCommand.bind(document);
    document.execCommand = (command: string, ...rest: unknown[]) => {
      if (command === "copy") {
        const el = document.activeElement as HTMLTextAreaElement | null;
        window.__emrLastCopy = el?.value ?? String(document.getSelection());
      }
      return (exec as (...args: unknown[]) => boolean)(command, ...rest);
    };
    const clip = navigator.clipboard;
    if (clip?.writeText) {
      const write = clip.writeText.bind(clip);
      clip.writeText = async (text: string) => {
        await write(text);
        window.__emrLastCopy = text;
      };
    }
  });
}

/** The text our contribution iframe last copied (see `recordCopies`). */
async function lastCopy(page: Page, bundle: string): Promise<string> {
  const frame = page
    .frames()
    .find((f) => f.url().includes(DEV_ORIGIN_HOST) && f.url().includes(bundle));
  expect(frame, `no ${bundle} frame`).toBeTruthy();
  return (await frame!.evaluate(() => window.__emrLastCopy)) ?? "";
}

function hostParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name);
}

/** The PR web URL our links must be built on (no query). */
function prPageUrl(repo: string, prId: number): string {
  return `${E2E.orgUrl}/${encodeURIComponent(E2E.project)}/_git/${repo}/pullrequest/${prId}`;
}

/** Assert `link` re-opens THIS PR on the Markdown Review tab. */
function expectPrTabLink(link: string, repo: string, prId: number): URL {
  expect(link, "copied link must be the ADO page, not the iframe").not.toMatch(
    /gallerycdn|vsassets|localhost|pr-tab\.html/i,
  );
  const url = new URL(link);
  expect(decodeURIComponent(url.origin + url.pathname).toLowerCase()).toBe(
    decodeURIComponent(prPageUrl(repo, prId)).toLowerCase(),
  );
  expect(url.searchParams.get("_a")).toBe(`${E2E.extensionId}.${E2E.prTabId}`);
  return url;
}

/**
 * Click `target` until `done` reports success. The cross-origin iframe can
 * swallow the first pointer event, so a single click races.
 */
async function clickUntil(
  target: ReturnType<FrameLocator["locator"]>,
  done: () => Promise<boolean>,
  message: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        if (!(await done())) await target.click().catch(() => {});
        return done();
      },
      { timeout: 20_000, intervals: [500, 750, 1000], message },
    )
    .toBe(true);
}

/** Distance from the reader scroller's top to the element's top, in px. */
async function offsetFromReaderTop(
  frame: FrameLocator,
  selector: string,
): Promise<{ offset: number; scrollTop: number }> {
  return frame.locator(selector).evaluate((el) => {
    // The nearest scrolling ancestor (the reader's own scroll container).
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const { overflowY } = getComputedStyle(scroller);
      if (
        /(auto|scroll)/.test(overflowY) &&
        scroller.scrollHeight > scroller.clientHeight
      ) {
        break;
      }
      scroller = scroller.parentElement;
    }
    const box = scroller ?? document.scrollingElement!;
    return {
      offset: el.getBoundingClientRect().top - box.getBoundingClientRect().top,
      scrollTop: box.scrollTop,
    };
  });
}

test.describe("Shareable links (real ADO host)", () => {
  test.beforeEach(async ({ context }) => {
    await recordCopies(context);
  });

  test("PR tab: Link to comment copies a working PR-tab link", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(page, E2E.prRepo, E2E.prTitle);
    await gotoPrTab(page, E2E.prRepo, prId);
    let frame = prTabFrame(page);
    await waitForFrameRoot(frame);

    const highlight = frame.locator(".emr-highlight[data-thread-id]").first();
    await highlight.waitFor({ state: "visible", timeout: 45_000 });
    const tid = (await highlight.getAttribute("data-thread-id"))!;

    // Selecting the comment mirrors it into the address bar — on the PR page
    // itself, keeping our tab selected and naming the open document.
    await clickUntil(
      highlight,
      async () =>
        (await frame
          .locator(`.emr-highlight.is-active[data-thread-id="${tid}"]`)
          .count()) > 0,
      "highlight never became active",
    );
    await expect
      .poll(() => hostParam(page, "comment"), { timeout: 15_000 })
      .toBe(tid);
    expect(hostParam(page, "_a")).toBe(`${E2E.extensionId}.${E2E.prTabId}`);
    const routedPath = hostParam(page, "path");
    expect(routedPath, "address bar must name the open file").toMatch(
      /^\/.+\.md$/i,
    );

    // "Link to comment" copies the same shareable PR-tab URL.
    const balloon = frame.locator(`.emr-balloon[data-thread-id="${tid}"]`);
    await balloon.getByRole("button", { name: "More options" }).first().click();
    await balloon.getByRole("menuitem", { name: "Link to comment" }).click();
    await expect(
      balloon.getByRole("menuitem", { name: "Link copied" }),
    ).toBeVisible({ timeout: 10_000 });
    const copied = await lastCopy(page, "pr-tab.html");
    const url = expectPrTabLink(copied, E2E.prRepo, prId);
    expect(url.searchParams.get("comment")).toBe(tid);
    expect(url.searchParams.get("path")).toBe(routedPath);

    // Opening the link fresh lands on the thread, with no interaction.
    await page.goto(copied, { waitUntil: "domcontentloaded" });
    frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await expect(
      frame.locator(`.emr-highlight.is-active[data-thread-id="${tid}"]`),
    ).toHaveCount(1, { timeout: 45_000 });
    await expect(
      frame.locator(`.emr-balloon.is-active[data-thread-id="${tid}"]`),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("PR tab: a heading link opens that heading in that file", async ({
    page,
  }) => {
    // Short enough a viewport that the linked heading starts below the fold,
    // so landing on it requires a real scroll.
    await page.setViewportSize({ width: 1400, height: 560 });
    const prId = await discoverPullRequestId(
      page,
      E2E.docLinksRepo,
      E2E.docLinksPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.docLinksRepo, prId);
    let frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

    // Open the PR's SECOND changed file, so the link must carry the file.
    await frame
      .locator("button.emr-docnav-file-label")
      .filter({ hasText: "install.md" })
      .click();
    await expectReaderHeading(frame, /^Installation$/i);
    await expect
      .poll(() => hostParam(page, "path"), { timeout: 15_000 })
      .toBe("/docs/guides/install.md");

    // Copy the heading's link. The click itself scrolls to the (hover-revealed)
    // button and moves the pointer onto it, and `clickUntil` retries it — the
    // article is re-wrapped as threads, images and diffs land, which replaces
    // its elements, so no one-shot scroll/hover on a stale element.
    const heading = frame.locator(".emr-rendered #see-also");
    const button = heading.locator(":scope > .emr-heading-link");
    await clickUntil(
      button,
      async () =>
        (await button.getAttribute("aria-label").catch(() => null)) ===
        "Link copied",
      "heading link never confirmed a copy",
    );
    const copied = await lastCopy(page, "pr-tab.html");
    const url = expectPrTabLink(copied, E2E.docLinksRepo, prId);
    expect(url.searchParams.get("path")).toBe("/docs/guides/install.md");
    expect(url.searchParams.get("anchor")).toBe("see-also");
    expect(url.searchParams.has("comment")).toBe(false);
    // The address bar mirrors it, as ADO's own Markdown preview does.
    await expect
      .poll(() => hostParam(page, "anchor"), { timeout: 15_000 })
      .toBe("see-also");

    // Opening the link fresh opens install.md (not the PR's first file) and
    // scrolls the heading to the top of the reader.
    await page.goto(copied, { waitUntil: "domcontentloaded" });
    frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await expectReaderHeading(frame, /^Installation$/i);
    await expect
      .poll(
        async () => {
          const { offset, scrollTop } = await offsetFromReaderTop(
            frame,
            ".emr-rendered #see-also",
          );
          return scrollTop > 0 && offset >= 0 && offset < 120;
        },
        {
          timeout: 20_000,
          message: "linked heading was not scrolled into view",
        },
      )
      .toBe(true);
    // Loading the linked document must not wipe the anchor from the URL.
    expect(hostParam(page, "anchor")).toBe("see-also");
  });

  test("Documents hub: a heading link survives the round trip", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 560 });
    const { frame, repo, path } = await openCommentableDoc(page);

    // Pick a real section heading mid-document, so there is content both
    // above (the link must scroll) and below (it can reach the top).
    const sections = frame.locator(".emr-rendered h2[id]");
    await sections.first().waitFor({ state: "visible", timeout: 30_000 });
    const count = await sections.count();
    expect(count, "commentable doc needs a few h2 sections").toBeGreaterThan(2);
    const anchor = (await sections
      .nth(Math.floor(count / 2))
      .getAttribute("id"))!;
    // Re-found by id on every use: the article is re-wrapped (its elements
    // replaced) as threads, images and permissions land after first paint.
    // The click scrolls to the hover-revealed button and `clickUntil` retries.
    const heading = frame.locator(`.emr-rendered [id="${anchor}"]`);
    const button = heading.locator(":scope > .emr-heading-link");
    await clickUntil(
      button,
      async () =>
        (await button.getAttribute("aria-label").catch(() => null)) ===
        "Link copied",
      "heading link never confirmed a copy",
    );

    const copied = new URL(await lastCopy(page, "documents-hub.html"));
    expect(copied.pathname).toContain(`${E2E.extensionId}.${E2E.hubId}`);
    expect(copied.searchParams.get("repo")).toBe(repo);
    expect(copied.searchParams.get("path")).toBe(path);
    expect(copied.searchParams.get("anchor")).toBe(anchor);
    await expect
      .poll(() => hostParam(page, "anchor"), { timeout: 15_000 })
      .toBe(anchor);

    await page.goto(copied.toString(), { waitUntil: "domcontentloaded" });
    const reopened = hubFrame(page);
    await waitForFrameRoot(reopened);
    await expect
      .poll(
        async () => {
          const { offset, scrollTop } = await offsetFromReaderTop(
            reopened,
            `.emr-rendered [id="${anchor}"]`,
          );
          return scrollTop > 0 && offset >= 0 && offset < 120;
        },
        {
          timeout: 30_000,
          message: "linked heading was not scrolled into view",
        },
      )
      .toBe(true);
    // The hub re-publishes the opened document on load; that must keep the
    // anchor rather than treating it as navigation to a new document.
    expect(hostParam(page, "anchor")).toBe(anchor);
  });
});
