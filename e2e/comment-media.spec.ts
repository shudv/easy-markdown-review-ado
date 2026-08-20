import { expect, test } from "@playwright/test";

import { E2E } from "./env";
import {
  discoverPullRequestId,
  gotoPrTab,
  prTabFrame,
  waitForFrameRoot,
} from "./helpers";

test("renders native ADO images, GIFs, and attachments inside comments", async ({
  page,
}) => {
  const prId = await discoverPullRequestId(
    page,
    E2E.commentMediaRepo,
    E2E.commentMediaPrTitle,
    "active",
  );
  await gotoPrTab(page, E2E.commentMediaRepo, prId);

  const frame = prTabFrame(page);
  await waitForFrameRoot(frame);
  await frame.locator(".markdown-body").first().waitFor({ timeout: 45_000 });

  const comment = frame
    .locator(".emr-comment-content")
    .filter({ hasText: "[EMR native media showcase]" });
  await expect(comment).toBeVisible({ timeout: 30_000 });

  const media = comment.locator(".emr-comment-media");
  await expect(media).toHaveCount(2);
  await expect(media.first()).not.toHaveAttribute("role", "button");
  await expect(media.first()).not.toHaveAttribute("tabindex", /.+/);
  await expect(comment.locator(".emr-comment-attachment")).toHaveCount(1);

  for (const image of await media.locator("img").all()) {
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0);
  }

  const contained = await comment.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return Array.from(
      root.querySelectorAll(".emr-comment-media, .emr-comment-attachment"),
    ).every((element) => {
      const item = element.getBoundingClientRect();
      return item.left >= bounds.left && item.right <= bounds.right + 0.5;
    });
  });
  expect(contained).toBe(true);
  await expect(frame.getByRole("dialog")).toHaveCount(0);
});
