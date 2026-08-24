// E2E: native Azure DevOps PR iterations flowing through the real PR-tab SDK
// boundary into the status-bar comparison picker.

import { expect, test } from "@playwright/test";

import { E2E } from "./env";
import {
  discoverPullRequestId,
  gotoPrTab,
  prTabFrame,
  waitForFrameRoot,
} from "./helpers";

test.describe("PR iteration picker (real ADO host)", () => {
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
      /Previous comparison: Update 6 → 7/,
    );
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(trigger).toHaveText(/Update 6 → 7/);
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
    await expect(list.getByRole("option")).toHaveCount(8);
    await expect(list.getByRole("option").first()).toHaveAccessibleName(/^1 /);
    await expect(list.getByRole("option").last()).toHaveAccessibleName(
      "All updates",
    );
    await expect(
      list.getByRole("option", {
        name: /^7 Finalize the review workflow launch/,
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
});
