// E2E: native Azure DevOps PR iterations flowing through the real PR-tab SDK
// boundary into the status-bar comparison picker.

import type { FrameLocator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { E2E } from "./env";
import {
  discoverPullRequestId,
  expectReaderHeading,
  gotoPrTab,
  openDraftComposerBySelection,
  prTabFrame,
  waitForFrameRoot,
} from "./helpers";

test.describe("PR iteration picker (real ADO host)", () => {
  test("re-resolves a text anchor when stepping across revisions", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.iterationRepo,
      E2E.iterationPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.iterationRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    const trigger = frame.locator(".emr-statusbar-iteration-trigger");
    const anchor = frame.locator(
      '.emr-highlight[data-thread-id]:has-text("The first release covers engineering design notes and operational runbooks.")',
    );
    const orphanedComment = frame.locator(".emr-balloon.is-orphaned", {
      hasText: "EMR iteration anchor lifecycle",
    });

    await expect(trigger).toHaveText(/All updates/, { timeout: 45_000 });
    await expect(anchor).toBeVisible({ timeout: 45_000 });
    await expect(orphanedComment).toHaveCount(0);

    await trigger.click();
    const list = frame.getByRole("listbox", { name: "Review iterations" });
    await list.getByRole("option", { name: /^9 / }).click();
    await expect(trigger).toHaveText(/Update 8 → 9/);
    await expect(anchor).toHaveCount(0);
    await expect(orphanedComment).toBeVisible();
    await expect(
      frame.getByText("Comments with no anchor", { exact: true }),
    ).toBeVisible();

    await list.getByRole("option", { name: /^8 / }).click();
    await expect(trigger).toHaveText(/Update 7 → 8/);
    await expect(orphanedComment).toHaveCount(0);
    await frame.getByRole("button", { name: "Changes" }).click();
    await expect(anchor).toBeVisible();
  });

  test("keeps All updates exclusive and compares numbered updates", async ({
    page,
  }) => {
    const prId = await discoverPullRequestId(
      page,
      E2E.iterationRepo,
      E2E.iterationPrTitle,
      "active",
    );
    await gotoPrTab(page, E2E.iterationRepo, prId);

    const frame = prTabFrame(page);
    await waitForFrameRoot(frame);
    const trigger = frame.locator(".emr-statusbar-iteration-trigger");
    await expect(trigger).toHaveText(/All updates/, { timeout: 45_000 });
    const delta = frame.locator(".emr-statusbar-delta");
    const allChangesDelta = await delta.innerText();
    const previous = frame.locator(".emr-statusbar-iteration-step").first();
    const next = frame.locator(".emr-statusbar-iteration-step").last();
    const stepperGeometry = () =>
      Promise.all(
        [previous, trigger, next].map((locator) =>
          locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, width: rect.width };
          }),
        ),
      ).then(([previousRect, triggerRect, nextRect]) => ({
        previousLeft: previousRect!.left,
        previousWidth: previousRect!.width,
        triggerWidth: triggerRect!.width,
        nextWidth: nextRect!.width,
        triggerOffset: triggerRect!.left - previousRect!.left,
        nextOffset: nextRect!.left - previousRect!.left,
      }));
    const initialGeometry = await stepperGeometry();

    await expect(previous).toHaveAttribute(
      "aria-label",
      /Previous comparison: Update 9 → 10/,
    );
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(trigger).toHaveText(/Update 9 → 10/);
    await expect(next).toHaveAttribute(
      "aria-label",
      /Next comparison: All updates/,
    );
    await expect.poll(stepperGeometry).toEqual(initialGeometry);
    await next.click();
    await expect(trigger).toHaveText(/All updates/);

    await trigger.click();
    const list = frame.getByRole("listbox", { name: "Review iterations" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option")).toHaveCount(11);
    // Newest first, like ADO's own update list: All updates, then 10 → 1.
    await expect(list.getByRole("option").first()).toHaveAccessibleName(
      "All updates",
    );
    await expect(list.getByRole("option").nth(1)).toHaveAccessibleName(/^10 /);
    await expect(list.getByRole("option").last()).toHaveAccessibleName(/^1 /);
    await expect(
      list.getByRole("option", {
        name: /^10 Restore the anchored scope sentence/,
      }),
    ).toBeVisible();
    await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(
      list.getByRole("option", { name: "All updates", selected: true }),
    ).toBeVisible();
    await expect(list.getByText(/^\d+[mhd] ago$/).first()).toBeVisible();
    expect(
      await list.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(false);

    await list.getByRole("option", { name: /^5 / }).click();
    await expect(trigger).toHaveText(/Update 4 → 5/);
    await expect(list).toBeVisible();
    await expect.poll(() => delta.innerText()).not.toBe(allChangesDelta);
    const updateFiveDelta = await delta.innerText();
    await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(
      list.getByRole("option", { name: /^5 /, selected: true }),
    ).toBeVisible();
    await expect(list.locator(".emr-statusbar-font-check")).toHaveCount(0);
    await expect(
      list.getByRole("option", { name: "All updates", selected: false }),
    ).toBeVisible();

    await list
      .getByRole("option", { name: /^3 / })
      .click({ modifiers: ["Shift"] });
    await expect(trigger).toHaveText(/Update 2 → 5/);
    await expect(list.getByRole("option", { selected: true })).toHaveCount(3);
    for (const update of [3, 4, 5]) {
      await expect(
        list.getByRole("option", {
          name: new RegExp(`^${update} `),
          selected: true,
        }),
      ).toBeVisible();
    }
    await expect.poll(() => delta.innerText()).not.toBe(updateFiveDelta);
    await expect(list).toBeVisible();
    await expect(previous).toHaveAttribute(
      "aria-label",
      /Previous comparison: Update 1 → 2/,
    );
    await expect(next).toHaveAttribute(
      "aria-label",
      /Next comparison: Update 5 → 6/,
    );
    await next.click();
    await expect(trigger).toHaveText(/Update 5 → 6/);
    await expect(list).toBeVisible();
    await expect.poll(stepperGeometry).toEqual(initialGeometry);
  });
  test("keeps the chosen update across files and explains files missing at it", async ({
    page,
  }) => {
    // The update-scope PR: Update 1 revises guide.md, Update 2 adds
    // review-checklist.md and deletes legacy-checklist.md, Update 3 revises
    // guide.md again. A chosen comparison must carry across files, and a file
    // that doesn't exist at the chosen update must explain itself (driven by
    // ADO's real 404 / TF401174 for the missing version) rather than error.
    const frame = await openUpdateScopePr(page);
    const { trigger, pickUpdate, openFile } = updatePicker(frame);
    const notice = frame.locator(".emr-update-absent");
    const loadError = frame.locator(".emr-error");

    await expect(trigger).toHaveText(/All updates/, { timeout: 45_000 });
    await expectReaderHeading(frame, /^Review guide$/i);

    // Update 1 → 2 on the guide, then open the checklist the PR adds in
    // Update 2: the comparison is kept, and the file — absent at Update 1 —
    // renders as new in this selection, not as a load error.
    await pickUpdate(2);
    await expect(trigger).toHaveText(/Update 1 → 2/);
    await openFile("review-checklist.md");
    await expectReaderHeading(frame, /^Review checklist$/i);
    await expect(trigger).toHaveText(/Update 1 → 2/);
    await expect(notice).toHaveCount(0);
    await expect(loadError).toHaveCount(0);

    // Base → Update 1: the checklist doesn't exist yet.
    await pickUpdate(1);
    await expect(trigger).toHaveAttribute("aria-label", "Base → Update 1");
    await expect(notice).toContainText("Not added yet at Update 1", {
      timeout: 30_000,
    });
    await expect(loadError).toHaveCount(0);

    // The legacy checklist still exists at Update 1 (selection kept)…
    await openFile("legacy-checklist.md");
    await expectReaderHeading(frame, /^Legacy review checklist$/i);
    await expect(trigger).toHaveAttribute("aria-label", "Base → Update 1");
    // …is gone at Update 2, which deleted it…
    await pickUpdate(2);
    await expect(notice).toContainText("Deleted by Update 2", {
      timeout: 30_000,
    });
    // …and at the latest update.
    await pickUpdate(3);
    await expect(notice).toContainText("Deleted by Update 3");
    await expect(loadError).toHaveCount(0);

    // "Show all updates" returns to the PR-wide view of the deleted file.
    await notice.getByRole("button", { name: "Show all updates" }).click();
    await expect(trigger).toHaveText(/All updates/);
    await expectReaderHeading(frame, /^Legacy review checklist$/i);
    await expect(notice).toHaveCount(0);
  });

  test("shares, marks and comments on a chosen comparison of updates", async ({
    page,
  }) => {
    // Same update-scope PR (Update 1 revises guide.md, Update 2 adds
    // review-checklist.md and deletes legacy-checklist.md, Update 3 revises
    // guide.md). Proves against the real host: the address bar carries the
    // comparison as ADO's own `iteration`/`base` ids and a fresh load restores
    // it; the file list marks what ADO reports changed between the two
    // updates; and an earlier update still takes new comments.
    const frame = await openUpdateScopePr(page);
    const { trigger, pickUpdate, pickAllUpdates } = updatePicker(frame);
    const routeParam = (name: string) =>
      new URL(page.url()).searchParams.get(name);
    const fileRow = (name: string) =>
      frame.locator(".emr-docnav-file").filter({ hasText: name }).first();
    const expectDimmed = async (names: string[], others: string[]) => {
      for (const name of names) {
        await expect(fileRow(name)).toHaveClass(/is-unchanged-in-range/, {
          timeout: 30_000,
        });
      }
      for (const name of others) {
        await expect(fileRow(name)).not.toHaveClass(/is-unchanged-in-range/);
      }
    };

    await expect(trigger).toHaveText(/All updates/, { timeout: 45_000 });
    await expectReaderHeading(frame, /^Review guide$/i);
    expect(routeParam("iteration")).toBeNull();
    await expectDimmed([], ["guide.md", "review-checklist.md"]);

    // Update 1 → 2 swapped the checklists and left the guide alone.
    await pickUpdate(2);
    await expect(trigger).toHaveText(/Update 1 → 2/);
    await expect.poll(() => routeParam("iteration")).toBe("2");
    expect(routeParam("base")).toBe("1");
    await expectDimmed(
      ["guide.md"],
      ["review-checklist.md", "legacy-checklist.md"],
    );

    // The address bar is the shareable link: a fresh load restores it.
    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await waitForFrameRoot(frame);
    await expect(trigger).toHaveText(/Update 1 → 2/, { timeout: 45_000 });
    await expectDimmed(["guide.md"], ["review-checklist.md"]);

    // Update 2 → 3 only revised the guide.
    await pickUpdate(3);
    await expect(trigger).toHaveText(/Update 2 → 3/);
    await expect.poll(() => routeParam("iteration")).toBe("3");
    expect(routeParam("base")).toBe("2");
    await expectDimmed(
      ["review-checklist.md", "legacy-checklist.md"],
      ["guide.md"],
    );

    // Base → Update 1 isn't read-only: text the latest update still has
    // takes a comment. (Cancelled — never persist to the shared sandbox PR.)
    await pickUpdate(1);
    await expect(trigger).toHaveAttribute("aria-label", "Base → Update 1");
    await expect.poll(() => routeParam("base")).toBe("0");
    const selected = await openDraftComposerBySelection(frame);
    const draft = frame.locator(".emr-balloon.is-draft");
    await expect(draft.locator(".emr-balloon-meta")).toContainText(
      selected.trim().slice(0, 10),
    );
    await draft.getByRole("button", { name: /^cancel$/i }).click();
    await expect(draft).toHaveCount(0, { timeout: 10_000 });

    // All updates leaves the comparison out of the link again.
    await pickAllUpdates();
    await expect(trigger).toHaveText(/All updates/);
    await expect.poll(() => routeParam("iteration")).toBeNull();
    expect(routeParam("base")).toBeNull();
    await expectDimmed([], ["guide.md", "review-checklist.md"]);
  });
});

/** Open the update-scope sandbox PR's Markdown Review tab. */
async function openUpdateScopePr(page: Page): Promise<FrameLocator> {
  const prId = await discoverPullRequestId(
    page,
    E2E.updateScopeRepo,
    E2E.updateScopePrTitle,
    "active",
  );
  await gotoPrTab(page, E2E.updateScopeRepo, prId);
  const frame = prTabFrame(page);
  await waitForFrameRoot(frame);
  return frame;
}

/** The status-bar comparison picker and the file list it scopes. */
function updatePicker(frame: FrameLocator) {
  const trigger = frame.locator(".emr-statusbar-iteration-trigger");
  const list = frame.getByRole("listbox", { name: "Review iterations" });
  // Choosing an update leaves the picker open; only open it when closed.
  const open = async () => {
    if (
      (await frame.locator(".emr-statusbar-iteration.is-open").count()) === 0
    ) {
      await trigger.click();
    }
  };
  return {
    trigger,
    openFile: (name: string) =>
      frame
        .locator("button.emr-docnav-file-label")
        .filter({ hasText: name })
        .click(),
    pickUpdate: async (update: number) => {
      await open();
      await list
        .getByRole("option", { name: new RegExp(`^${update} `) })
        .click();
    },
    pickAllUpdates: async () => {
      await open();
      await list.getByRole("option", { name: "All updates" }).click();
    },
  };
}
