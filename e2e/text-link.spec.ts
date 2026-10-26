// E2E: "Copy link to selection" — shareable links to a span of selected text —
// in the Documents hub and the Markdown Review PR tab, against the real ADO
// host.
//
// The flow it guards, end to end:
//   * selecting text shows the bubble's link action next to "Add comment";
//   * clicking it copies the host page URL (not the iframe's) carrying the
//     open document, the quoted text (`?text=`) and its section (`?anchor=`),
//     and mirrors the same params into the address bar;
//   * opening that link fresh scrolls the text into view and flashes exactly
//     the selected words with the heading deep link's landing cue, which then
//     clears without leaving the document altered;
//   * a link whose text no longer exists falls back to its section heading.
//
// Clipboard: as in share-links.spec.ts, an init script records what each copy
// wrote, so the spec never touches the OS clipboard.

import type {
  BrowserContext,
  FrameLocator,
  Locator,
  Page,
} from "@playwright/test";

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

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Select the first `selLen` characters of `target`'s first direct text node
 * and dispatch `mouseup`, retrying until the selection bubble appears (the
 * cross-origin iframe can swallow the first event, and the article is
 * re-wrapped as threads/images land). Returns the selected text, trimmed.
 * Playwright's mouse drag can't reliably select inside the iframe.
 */
async function selectText(
  frame: FrameLocator,
  target: Locator,
  selLen: number,
): Promise<string> {
  await target.waitFor({ state: "visible", timeout: 45_000 });
  const bubble = frame.locator(".emr-selection-bubble");
  let selected = "";
  await expect
    .poll(
      async () => {
        selected =
          (await target
            .evaluate((el: HTMLElement, len: number) => {
              const node = Array.from(el.childNodes).find(
                (n): n is Text =>
                  n.nodeType === Node.TEXT_NODE &&
                  (n as Text).data.trim().length >= 8,
              );
              if (!node) return null;
              const range = document.createRange();
              range.setStart(node, 0);
              range.setEnd(node, Math.min(len, node.data.length));
              const sel = window.getSelection()!;
              sel.removeAllRanges();
              sel.addRange(range);
              el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              return range.toString();
            }, selLen)
            .catch(() => null)) ?? "";
        return selected.trim().length > 0 && (await bubble.isVisible());
      },
      {
        timeout: 30_000,
        intervals: [500, 750, 1000],
        message: "selection never surfaced the bubble",
      },
    )
    .toBe(true);
  return squash(selected);
}

/**
 * Click the bubble's "Copy link to selection" and wait for its confirmation,
 * then for the bubble to close on its own.
 */
async function copySelectionLink(frame: FrameLocator): Promise<void> {
  const bubble = frame.locator(".emr-selection-bubble");
  const button = bubble.getByRole("button", {
    name: "Copy link to selection",
  });
  await expect(button).toBeVisible();
  // The quieter action sits after "Add comment", behind a divider.
  await expect(
    bubble.getByRole("button", { name: /add comment/i }),
  ).toBeVisible();
  await expect(bubble.locator(".emr-selection-bubble-divider")).toHaveCount(1);
  await button.click();
  await expect(bubble.getByRole("button", { name: "Link copied" })).toBeVisible(
    { timeout: 10_000 },
  );
  await expect(bubble).toHaveCount(0, { timeout: 10_000 });
}

/** What the landing cue currently covers, and whether it is in view. */
async function landingCue(
  frame: FrameLocator,
): Promise<{ text: string; inView: boolean }> {
  return frame
    .locator(".emr-article-wrap > .emr-rendered")
    .first()
    .evaluate((article) => {
      const cues = Array.from(
        article.querySelectorAll<HTMLElement>(
          "[data-emr-text-cue].emr-anchor-target",
        ),
      );
      if (cues.length === 0) return { text: "", inView: false };
      let scroller: HTMLElement | null = article.parentElement;
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
      const box = (
        scroller ?? document.documentElement
      ).getBoundingClientRect();
      const rect = cues[0]!.getBoundingClientRect();
      return {
        text: cues.map((cue) => cue.textContent).join(""),
        inView: rect.top >= box.top && rect.bottom <= box.bottom,
      };
    });
}

/**
 * After landing on a text link: the selected words flash (and only they), in
 * view, and the cue then clears, leaving the text in place.
 */
async function expectTextFlash(
  frame: FrameLocator,
  selected: string,
): Promise<void> {
  await expect
    .poll(async () => squash((await landingCue(frame)).text), {
      timeout: 45_000,
      intervals: [100, 200, 250],
      message: "linked text never flashed",
    })
    .toBe(selected);
  await expect
    .poll(async () => (await landingCue(frame)).inView, {
      timeout: 5_000,
      intervals: [100, 200],
      message: "flashed text was not scrolled into view",
    })
    .toBe(true);
  // The cue lasts 2.5s, then its wrapper spans are removed.
  await expect(frame.locator("[data-emr-text-cue]")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(
    frame.locator(".emr-rendered").getByText(selected).first(),
  ).toBeVisible();
}

test.describe("Selection links (real ADO host)", () => {
  test.beforeEach(async ({ context }) => {
    await recordCopies(context);
  });

  test("Documents hub: a selection link flashes the text on open", async ({
    page,
  }) => {
    // Short viewport, so the linked paragraph starts below the fold.
    await page.setViewportSize({ width: 1400, height: 560 });
    const { frame, repo, path } = await openCommentableDoc(page);

    // A prose paragraph in a later section, below the fold.
    const para = frame
      .locator(".emr-rendered p")
      .filter({ hasText: "Returns the full PR object" })
      .first();
    const selected = await selectText(frame, para, 26);
    expect(selected).toBe("Returns the full PR object");
    await copySelectionLink(frame);

    const copied = new URL(await lastCopy(page, "documents-hub.html"));
    expect(copied.pathname).toContain(`${E2E.extensionId}.${E2E.hubId}`);
    expect(copied.searchParams.get("repo")).toBe(repo);
    expect(copied.searchParams.get("path")).toBe(path);
    expect(copied.searchParams.has("comment")).toBe(false);
    const text = copied.searchParams.get("text");
    expect(text).toBe("Returns the full PR object");
    expect(copied.search, "spaces must not be form-encoded as +").not.toMatch(
      /\+/,
    );
    const anchor = copied.searchParams.get("anchor");
    expect(anchor, "link must carry its section as a fallback").toBeTruthy();
    // The address bar mirrors the same link.
    await expect
      .poll(() => hostParam(page, "text"), { timeout: 15_000 })
      .toBe(text);
    expect(hostParam(page, "anchor")).toBe(anchor);

    // Opening the link fresh scrolls to and flashes exactly that text.
    await page.goto(copied.toString(), { waitUntil: "domcontentloaded" });
    const reopened = hubFrame(page);
    await waitForFrameRoot(reopened);
    await expectTextFlash(reopened, selected);
    // Loading the linked document must not wipe the link from the URL.
    expect(hostParam(page, "text")).toBe(text);

    // A link whose text has since changed lands on its section instead.
    const stale = new URL(copied);
    stale.searchParams.set("text", "phrase that is not in this document");
    await page.goto(stale.toString(), { waitUntil: "domcontentloaded" });
    const fallback = hubFrame(page);
    await waitForFrameRoot(fallback);
    await expect(
      fallback.locator(`.emr-rendered [id="${anchor}"] .emr-anchor-target`),
    ).toHaveCount(1, { timeout: 45_000 });
    await expect(fallback.locator("[data-emr-text-cue]")).toHaveCount(0);
  });

  test("PR tab: a selection across removed + added words links live text only", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 700 });
    const prId = await discoverPullRequestId(
      page,
      E2E.diffRepo,
      E2E.diffPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.diffRepo, prId);
    let frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    // A changed paragraph/list item showing struck-out removed words followed
    // by added ones (the inline word diff of an edited line).
    const block = frame
      .locator(".emr-rendered :is(p, li)")
      .filter({
        has: frame.locator(
          "del.emr-word-removed:not(.emr-word-removed--tight)",
        ),
      })
      .filter({ has: frame.locator("ins.emr-word-added") })
      .first();
    await block.waitFor({ state: "visible", timeout: 45_000 });

    // Select from a few live characters before the first removed run through
    // the end of the next added run — straddling old and new text.
    const bubble = frame.locator(".emr-selection-bubble");
    let picked: { live: string; removed: string } | null = null;
    await expect
      .poll(
        async () => {
          picked = await block
            .evaluate((el: HTMLElement) => {
              const del = el.querySelector<HTMLElement>(
                "del.emr-word-removed:not(.emr-word-removed--tight)",
              )!;
              const all = Array.from(el.querySelectorAll("ins.emr-word-added"));
              const ins = all.find(
                (i) =>
                  del.compareDocumentPosition(i) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
              );
              if (!ins) return null;
              const range = document.createRange();
              const before = del.previousSibling;
              if (before instanceof Text && before.data.trim().length > 0) {
                range.setStart(before, Math.max(0, before.data.length - 12));
              } else {
                range.setStartBefore(del);
              }
              range.setEndAfter(ins);
              const walker = document.createTreeWalker(
                range.commonAncestorContainer,
                NodeFilter.SHOW_TEXT,
              );
              let live = "";
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (!range.intersectsNode(n)) continue;
                if (n.parentElement!.closest("del")) continue;
                const t = n as Text;
                const from = n === range.startContainer ? range.startOffset : 0;
                const to =
                  n === range.endContainer ? range.endOffset : t.length;
                live += t.data.slice(from, to);
              }
              const sel = window.getSelection()!;
              sel.removeAllRanges();
              sel.addRange(range);
              el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              return { live, removed: del.textContent ?? "" };
            })
            .catch(() => null);
          return picked !== null && (await bubble.isVisible());
        },
        {
          timeout: 30_000,
          intervals: [500, 750, 1000],
          message: "no selection across a removed + added run",
        },
      )
      .toBe(true);
    const live = squash(picked!.live);
    expect(live.length).toBeGreaterThan(0);
    await copySelectionLink(frame);
    const copied = await lastCopy(page, "pr-tab.html");
    const text = new URL(copied).searchParams.get("text")!;
    expect(text).toBeTruthy();

    // Opening it (diff shown by default) flashes exactly the live words; the
    // struck-out removed words in between are never washed.
    await page.goto(copied, { waitUntil: "domcontentloaded" });
    frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await expect
      .poll(async () => squash((await landingCue(frame)).text), {
        timeout: 45_000,
        intervals: [100, 200, 250],
        message: "linked text never flashed",
      })
      .toBe(live);
    await expect(frame.locator("del [data-emr-text-cue]")).toHaveCount(0);
    await expect(frame.locator("[data-emr-text-cue]")).toHaveCount(0, {
      timeout: 10_000,
    });

    // Hidden-diff selection producing the same link is a pure text-fragment
    // contract, pinned in test/textFragment.test.ts.
  });

  test("PR tab: a selection link opens that file and flashes the text", async ({
    page,
  }) => {
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

    // The PR's SECOND changed file, so the link must carry the file.
    await frame
      .locator("button.emr-docnav-file-label")
      .filter({ hasText: "install.md" })
      .click();
    await expectReaderHeading(frame, /^Installation$/i);
    await expect
      .poll(() => hostParam(page, "path"), { timeout: 15_000 })
      .toBe("/docs/guides/install.md");

    // "Sibling in this folder:" — a list item in the last section.
    const item = frame
      .locator(".emr-rendered li")
      .filter({ hasText: "Sibling in this folder" })
      .first();
    const selected = await selectText(frame, item, 23);
    expect(selected).toBe("Sibling in this folder:");
    await copySelectionLink(frame);

    const copied = await lastCopy(page, "pr-tab.html");
    expect(copied).not.toMatch(/gallerycdn|vsassets|localhost|pr-tab\.html/i);
    const url = new URL(copied);
    expect(url.pathname.toLowerCase()).toContain(`/pullrequest/${prId}`);
    expect(url.searchParams.get("_a")).toBe(
      `${E2E.extensionId}.${E2E.prTabId}`,
    );
    expect(url.searchParams.get("path")).toBe("/docs/guides/install.md");
    expect(url.searchParams.get("text")).toBe("Sibling in this folder:");
    expect(url.searchParams.get("anchor")).toBe("see-also");
    expect(url.searchParams.has("comment")).toBe(false);
    await expect
      .poll(() => hostParam(page, "text"), { timeout: 15_000 })
      .toBe("Sibling in this folder:");

    await page.goto(copied, { waitUntil: "domcontentloaded" });
    frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    await expectReaderHeading(frame, /^Installation$/i);
    await expectTextFlash(frame, selected);
  });
});
