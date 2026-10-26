// E2E: comment deep-linking (`?comment=`) in the Documents hub, against the real
// ADO host. Covers BOTH directions of the two-way binding:
//
//   * inbound  — a `?comment=<threadId>` URL auto-activates (and scrolls to)
//                that thread on load, with no user interaction. This is the
//                path that only the real cross-origin iframe exercises: the
//                host navigation service supplies the query params and the
//                async Git data load gates when the thread anchor mounts.
//   * outbound — selecting a comment writes the same `?comment=<threadId>` back
//                onto the host page URL (via the host navigation service), so
//                the route always reflects the active thread and the link is
//                shareable.
//
// Thread ids are assigned by ADO at provisioning time, so the spec is
// data-driven: it discovers a real thread id from the rendered document rather
// than hard-coding one.

import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  gotoDocumentsHub,
  hubFrame,
  openCommentableDoc,
  waitForFrameRoot,
} from "./helpers";

const COMMENT_PARAM = "comment";

/** Wait for the reader to render and return the first thread id it highlights. */
async function firstRenderedThreadId(frame: FrameLocator): Promise<string> {
  await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });
  const highlight = frame.locator(".emr-highlight[data-thread-id]").first();
  await highlight.waitFor({ state: "visible", timeout: 30_000 });
  const tid = await highlight.getAttribute("data-thread-id");
  expect(tid, "rendered highlight must carry a thread id").toBeTruthy();
  return tid!;
}

/** Read the `?comment=` param from the top (host) page URL. */
function commentParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get(COMMENT_PARAM);
}

test.describe("Comment deep-linking (real ADO host)", () => {
  test("selecting a comment reflects it in the host route, and that link auto-activates the thread on load", async ({
    page,
  }) => {
    const { repo, path, frame } = await openCommentableDoc(page);

    const tid = await firstRenderedThreadId(frame);

    // Outbound. The route starts clean — nothing is active yet.
    expect(commentParam(page)).toBeNull();

    // Activating the thread (clicking its highlight) must both select it in the
    // UI and mirror its id into the host page's `?comment=` param. The hub's
    // cross-origin iframe can swallow the first pointer event, so retry the
    // click until the selection takes.
    const highlight = frame
      .locator(`.emr-highlight[data-thread-id="${tid}"]`)
      .first();
    await expect
      .poll(
        async () => {
          await highlight.click();
          return frame
            .locator(`.emr-highlight.is-active[data-thread-id="${tid}"]`)
            .count();
        },
        { timeout: 20_000, message: "highlight never became active" },
      )
      .toBeGreaterThan(0);

    // The host URL now carries the same thread id — the shareable deep link.
    await expect
      .poll(() => commentParam(page), {
        timeout: 15_000,
        message: "active thread was not mirrored into ?comment=",
      })
      .toBe(tid);

    // Inbound. Open the SAME document fresh with that thread deep-linked. No
    // clicks: the thread must activate on its own once its anchor mounts. This
    // is the regression guard for the seed-wipe bug (the deep-link seed used to
    // be cleared before the async document render finished).
    await gotoDocumentsHub(page, { repo, path, [COMMENT_PARAM]: tid });
    const linked = hubFrame(page);
    await waitForFrameRoot(linked);
    await linked.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

    await expect(
      linked.locator(`.emr-highlight.is-active[data-thread-id="${tid}"]`),
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(
      linked.locator(`.emr-balloon.is-active[data-thread-id="${tid}"]`),
    ).toBeVisible({ timeout: 30_000 });
  });
});
