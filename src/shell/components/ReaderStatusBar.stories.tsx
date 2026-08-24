import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  expect,
  fireEvent,
  fn,
  userEvent,
  waitFor,
  within,
} from "storybook/test";

import { ReaderStatusBar } from "./ReaderStatusBar";
import { READER_FONTS } from "../readerPrefs";

// Dock the bar at the viewport bottom (as in the app) so its upward-opening
// font popover lands on-screen and its controls are hit-testable.
const meta = {
  title: "Components/ReaderStatusBar",
  component: ReaderStatusBar,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    wordCount: 1240,
    wordDelta: { added: 38, removed: 12 },
    fontId: "system",
    sizePct: 100,
    spacingPct: 100,
    onFontChange: fn(),
    onSizeChange: fn(),
    onSpacingChange: fn(),
    availableFontIds: READER_FONTS.map((font) => font.id),
    showNav: true,
    onToggleNav: fn(),
    navToggleable: true,
    showComments: true,
    onToggleComments: fn(),
    changesAvailable: true,
    changesShown: true,
    onToggleChanges: fn(),
    iterationOptions: [
      {
        stopIndex: 2,
        number: 1,
        title: "Initial draft",
        dateMs: Date.parse("2026-08-11T17:06:00Z"),
      },
      {
        stopIndex: 1,
        number: 2,
        title: "Refine review workflow",
        dateMs: Date.parse("2026-08-18T11:07:00Z"),
      },
      {
        stopIndex: 0,
        number: 3,
        title: "Improve review workflow",
        dateMs: Date.parse("2026-08-23T10:14:00Z"),
      },
    ],
    iterationBaseCommit: "abcdef1234567890",
    iterationRange: { fromUpdate: 0, toUpdate: 3 },
    onIterationRangeChange: fn(),
    feedbackHref: "mailto:x@microsoft.com",
    onRefresh: fn(),
    // `refreshLabel` intentionally omitted — exercises the "Refresh" fallback.
  },
} satisfies Meta<typeof ReaderStatusBar>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledReaderStatusBar(
  props: React.ComponentProps<typeof ReaderStatusBar>,
): React.ReactElement {
  const [iterationRange, setIterationRange] = React.useState(
    props.iterationRange,
  );
  return (
    <ReaderStatusBar
      {...props}
      iterationRange={iterationRange}
      onIterationRangeChange={(nextRange) => {
        setIterationRange(nextRange);
        props.onIterationRangeChange?.(nextRange);
      }}
    />
  );
}

function ControlledCommentStatusBar(
  props: React.ComponentProps<typeof ReaderStatusBar>,
): React.ReactElement {
  const [showComments, setShowComments] = React.useState(props.showComments);
  const [activeCommentThreadId, setActiveCommentThreadId] = React.useState(
    props.activeCommentThreadId ?? null,
  );
  return (
    <ReaderStatusBar
      {...props}
      showComments={showComments}
      onToggleComments={() => {
        setShowComments((shown) => !shown);
        props.onToggleComments();
      }}
      activeCommentThreadId={activeCommentThreadId}
      onCycleComment={(threadId) => {
        setActiveCommentThreadId(threadId);
        props.onCycleComment?.(threadId);
      }}
    />
  );
}

/** The settled bar: word count + delta on the left, colour-only toggles right. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("toolbar", { name: "Reader status and controls" }),
    ).toBeTruthy();
    const iterationPopover = canvasElement.querySelector<HTMLElement>(
      ".emr-statusbar-iteration-pop",
    )!;
    const typePopover =
      canvasElement.querySelector<HTMLElement>(".emr-statusbar-pop")!;
    expect(iterationPopover.inert).toBe(true);
    expect(iterationPopover).toHaveAttribute("aria-hidden", "true");
    expect(typePopover.inert).toBe(true);
    expect(typePopover).toHaveAttribute("aria-hidden", "true");
    const visibleToolbarButtons = [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(
        ".emr-statusbar > button, .emr-statusbar-context-controls > button, .emr-statusbar-controls button",
      ),
    ].filter((button) => button.offsetParent !== null);
    expect(
      visibleToolbarButtons.map(
        (button) =>
          button.getAttribute("aria-label") ??
          button.textContent?.trim() ??
          button.title,
      ),
    ).toEqual(
      expect.arrayContaining(["Navigation", "Changes", "Comments", "Aa"]),
    );
    const changesButton = canvas.getByRole("button", { name: "Changes" });
    expect(changesButton.getBoundingClientRect().width).toBeCloseTo(24, 1);
    expect(changesButton.querySelector(".emr-statusbar-btn-label")).toBeNull();
    expect(visibleToolbarButtons[0]?.textContent).toContain("Navigation");
    expect(
      visibleToolbarButtons.findIndex((button) =>
        button.textContent?.includes("Changes"),
      ),
    ).toBeLessThan(
      visibleToolbarButtons.findIndex((button) =>
        button.textContent?.includes("Comments"),
      ),
    );
    const delta = canvasElement.querySelector<HTMLElement>(
      ".emr-statusbar-delta",
    )!;
    expect(delta.textContent).toBe("+38−12");
    expect(
      delta
        .querySelector(".emr-statusbar-delta-add")
        ?.getAttribute("aria-label"),
    ).toBe("38 words added");
    const sizeSlider = canvas.getByRole("slider", { name: "Text size" });
    expect(canvas.queryByRole("slider", { name: "Text spacing" })).toBeNull();
    const spacingSlider = typePopover.querySelector<HTMLInputElement>(
      'input[aria-label="Text spacing"]',
    )!;
    expect(sizeSlider.getAttribute("min")).toBe("50");
    expect(sizeSlider.getAttribute("max")).toBe("150");
    expect(spacingSlider.getAttribute("min")).toBe("100");
    expect(spacingSlider.getAttribute("max")).toBe("200");
    expect(
      typePopover.querySelector<HTMLButtonElement>(
        ".emr-percent-adjust.is-minus",
      ),
    ).toBeDisabled();
    for (const selector of [
      ".emr-statusbar-iteration-trigger .emr-statusbar-iteration-text",
      ".emr-statusbar-words",
      ".emr-statusbar-delta-add",
      ".emr-statusbar-btn-label",
      ".emr-statusbar-aa",
      ".emr-percent-output",
    ]) {
      const style = getComputedStyle(
        canvasElement.querySelector<HTMLElement>(selector)!,
      );
      expect(style.transform).toBe("none");
      expect(style.getPropertyValue("text-box-trim")).toBe("none");
    }
    const barCenter = (() => {
      const rect = canvasElement
        .querySelector<HTMLElement>(".emr-statusbar")!
        .getBoundingClientRect();
      return rect.top + rect.height / 2;
    })();
    for (const selector of [
      ".emr-statusbar-iteration-trigger .emr-statusbar-iteration-text",
      ".emr-statusbar-words",
      ".emr-statusbar-delta-add",
      ".emr-statusbar-btn-label",
      ".emr-statusbar-aa",
    ]) {
      const rect = canvasElement
        .querySelector<HTMLElement>(selector)!
        .getBoundingClientRect();
      expect(
        Math.abs(rect.top + rect.height / 2 - barCenter),
      ).toBeLessThanOrEqual(0.75);
    }
    expect(
      getComputedStyle(
        canvasElement.querySelector<SVGElement>(
          ".emr-statusbar-iteration-chevron",
        )!,
      ).transform,
    ).toBe("none");

    const separators = [
      ...canvasElement.querySelectorAll<HTMLElement>(".emr-statusbar-sep"),
    ];
    expect(separators).toHaveLength(4);
    const separatorMetrics = separators.map((separator) => {
      const rect = separator.getBoundingClientRect();
      const previousRect =
        separator.previousElementSibling!.getBoundingClientRect();
      const nextRect = separator.nextElementSibling!.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        gapBefore: rect.left - previousRect.right,
        gapAfter: nextRect.left - rect.right,
      };
    });
    for (const metric of separatorMetrics) {
      expect(metric.width).toBeCloseTo(separatorMetrics[0]!.width, 1);
      expect(metric.height).toBeCloseTo(separatorMetrics[0]!.height, 1);
      expect(metric.gapBefore).toBeCloseTo(6, 1);
      expect(metric.gapAfter).toBeCloseTo(6, 1);
    }

    await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
    const options = canvas.getAllByRole("option");
    expect(options[0]?.textContent).toContain("1Initial draft");
    expect(options[options.length - 1]?.textContent).toContain("All updates");
    const selectedOptions = canvas.getAllByRole("option", { selected: true });
    expect(selectedOptions).toHaveLength(1);
    expect(selectedOptions[0]?.textContent).toContain("All updates");
    expect(
      canvas
        .getByRole("listbox", { name: "Review iterations" })
        .querySelector(".emr-statusbar-font-check"),
    ).toBeNull();
    expect(
      canvas.getByRole("option", { name: /3 Improve review workflow/ }),
    ).toHaveAttribute("aria-selected", "false");
  },
};

/** Bounded stepping keeps both chevrons fixed and selection inspectable. */
export const IterationStepping: Story = {
  render: (args) => <ControlledReaderStatusBar {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "All updates" });
    const [previous, next] = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".emr-statusbar-iteration-step",
    );
    const initialPositions = {
      previous: previous!.getBoundingClientRect().left,
      trigger: trigger.getBoundingClientRect().left,
      next: next!.getBoundingClientRect().left,
    };
    expect(previous!.getBoundingClientRect().right).toBeCloseTo(
      trigger.getBoundingClientRect().left,
      1,
    );
    expect(trigger.getBoundingClientRect().right).toBeCloseTo(
      next!.getBoundingClientRect().left,
      1,
    );

    expect(trigger.querySelector(".emr-statusbar-caret")).toBeNull();

    const expectCenteredLabel = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const labelRect = trigger
        .querySelector<HTMLElement>(".emr-statusbar-iteration-value")!
        .getBoundingClientRect();
      expect(labelRect.left + labelRect.width / 2).toBeCloseTo(
        triggerRect.left + triggerRect.width / 2,
        1,
      );
    };
    expectCenteredLabel();

    expect(previous).toHaveAttribute(
      "aria-label",
      "Previous comparison: Update 2 → 3",
    );
    expect(next).toBeDisabled();

    for (const label of ["Update 2 → 3", "Update 1 → 2", "Base → Update 1"]) {
      await userEvent.click(previous!);
      expect(canvas.getByRole("button", { name: label })).toBeTruthy();
      expectCenteredLabel();
      expect(previous!.getBoundingClientRect().left).toBeCloseTo(
        initialPositions.previous,
        1,
      );
      expect(trigger.getBoundingClientRect().left).toBeCloseTo(
        initialPositions.trigger,
        1,
      );
      expect(next.getBoundingClientRect().left).toBeCloseTo(
        initialPositions.next,
        1,
      );
    }
    expect(previous).toBeDisabled();
    expect(
      trigger.querySelector(".emr-statusbar-iteration-base"),
    ).toHaveAttribute("title", "Base commit abcdef1");
    const baseGlyph = trigger
      .querySelector<HTMLElement>(".emr-statusbar-iteration-base")!
      .getBoundingClientRect();
    const arrow = [...trigger.querySelectorAll<HTMLElement>("span")]
      .find((element) => element.textContent === "→")!
      .getBoundingClientRect();
    expect(baseGlyph.top + baseGlyph.height / 2).toBeCloseTo(
      arrow.top + arrow.height / 2,
      1,
    );
    expect(
      trigger.querySelector(".emr-statusbar-iteration-base-dot"),
    ).not.toBeNull();
    expect(
      getComputedStyle(
        trigger.querySelector<HTMLElement>(
          ".emr-statusbar-iteration-base-dot",
        )!,
      ).transform,
    ).toBe("matrix(1, 0, 0, 1, 0, 1)");

    for (const label of ["Update 1 → 2", "Update 2 → 3", "All updates"]) {
      await userEvent.click(next!);
      expect(canvas.getByRole("button", { name: label })).toBeTruthy();
      expectCenteredLabel();
      expect(previous!.getBoundingClientRect().left).toBeCloseTo(
        initialPositions.previous,
        1,
      );
      expect(trigger.getBoundingClientRect().left).toBeCloseTo(
        initialPositions.trigger,
        1,
      );
      expect(next!.getBoundingClientRect().left).toBeCloseTo(
        initialPositions.next,
        1,
      );
    }
    expect(next).toBeDisabled();
    expect(args.onIterationRangeChange).toHaveBeenCalledWith({
      fromUpdate: 0,
      toUpdate: 3,
    });

    await userEvent.click(previous!);
    expect(canvas.getByRole("button", { name: "Update 2 → 3" })).toBeTruthy();

    await userEvent.click(canvas.getByRole("button", { name: "Update 2 → 3" }));
    await userEvent.click(
      canvas.getByRole("option", { name: /2 Refine review workflow/ }),
    );
    expect(
      canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
    ).not.toBeNull();
    expect(
      canvas.getByRole("option", {
        name: /2 Refine review workflow/,
        selected: true,
      }),
    ).toBeTruthy();
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    expect(
      canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
    ).not.toBeNull();
    expect(
      canvas.getByRole("option", { name: "All updates", selected: true }),
    ).toBeTruthy();
  },
};

/** Multi-digit update labels keep both chevrons fixed and stay below the cap. */
export const IterationMultiDigitStepping: Story = {
  args: {
    iterationOptions: Array.from({ length: 128 }, (_, index) => ({
      stopIndex: 127 - index,
      number: index + 1,
      title: `Update ${index + 1}`,
    })),
    iterationRange: { fromUpdate: 98, toUpdate: 99 },
  },
  render: (args) => <ControlledReaderStatusBar {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Update 98 → 99" });
    const [previous, next] = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".emr-statusbar-iteration-step",
    );
    const initialGeometry = {
      previousLeft: previous!.getBoundingClientRect().left,
      triggerLeft: trigger.getBoundingClientRect().left,
      triggerWidth: trigger.getBoundingClientRect().width,
      nextLeft: next!.getBoundingClientRect().left,
    };
    expect(initialGeometry.triggerWidth).toBeLessThanOrEqual(310);

    await userEvent.click(next!);
    expect(
      canvas.getByRole("button", { name: "Update 99 → 100" }),
    ).toBeTruthy();
    expect(previous!.getBoundingClientRect().left).toBeCloseTo(
      initialGeometry.previousLeft,
      1,
    );
    expect(trigger.getBoundingClientRect().left).toBeCloseTo(
      initialGeometry.triggerLeft,
      1,
    );
    expect(trigger.getBoundingClientRect().width).toBeCloseTo(
      initialGeometry.triggerWidth,
      1,
    );
    expect(next!.getBoundingClientRect().left).toBeCloseTo(
      initialGeometry.nextLeft,
      1,
    );
  },
};

/** A range steps to the first single-update comparison outside each edge. */
export const IterationRangeStepping: Story = {
  args: {
    iterationOptions: Array.from({ length: 6 }, (_, index) => ({
      stopIndex: 5 - index,
      number: index + 1,
      title: `Update ${index + 1}`,
    })),
    iterationRange: { fromUpdate: 2, toUpdate: 5 },
  },
  render: (args) => <ControlledReaderStatusBar {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [previous, next] = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".emr-statusbar-iteration-step",
    );
    expect(canvas.getByRole("button", { name: "Update 2 → 5" })).toBeTruthy();
    expect(previous).toHaveAttribute(
      "aria-label",
      "Previous comparison: Update 1 → 2",
    );
    expect(next).toHaveAttribute("aria-label", "Next comparison: Update 5 → 6");

    await userEvent.click(next!);
    expect(canvas.getByRole("button", { name: "Update 5 → 6" })).toBeTruthy();
    expect(next).toHaveAttribute("aria-label", "Next comparison: All updates");
  },
};

/** Comment navigation wraps while Comments and Navigation stay right-anchored. */
export const CommentStepping: Story = {
  args: {
    commentThreadIds: ["t1", "t2", "t3"],
    activeCommentThreadId: "t2",
    onCycleComment: fn(),
  },
  render: (args) => <ControlledCommentStatusBar {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const comments = canvas.getByRole("button", { name: "Comments" });
    const navigation = canvas.getByRole("button", { name: "Navigation" });
    const persistentPositions = {
      comments: comments.getBoundingClientRect().left,
      navigation: navigation.getBoundingClientRect().left,
    };
    expect(canvas.getByLabelText("Comment 2 of 3")).toBeTruthy();

    const previous = canvas.getByRole("button", { name: "Previous comment" });
    const next = canvas.getByRole("button", { name: "Next comment" });
    await userEvent.click(next);
    expect(args.onCycleComment).toHaveBeenLastCalledWith("t3");
    expect(canvas.getByLabelText("Comment 3 of 3")).toBeTruthy();
    await userEvent.click(next);
    expect(args.onCycleComment).toHaveBeenLastCalledWith("t1");
    expect(canvas.getByLabelText("Comment 1 of 3")).toBeTruthy();
    await userEvent.click(previous);
    expect(args.onCycleComment).toHaveBeenLastCalledWith("t3");

    await userEvent.click(comments);
    expect(
      canvas.queryByRole("button", { name: "Previous comment" }),
    ).toBeNull();
    expect(comments.getBoundingClientRect().left).toBeCloseTo(
      persistentPositions.comments,
      1,
    );
    expect(navigation.getBoundingClientRect().left).toBeCloseTo(
      persistentPositions.navigation,
      1,
    );
    await userEvent.click(comments);
    expect(
      canvas.getByRole("button", { name: "Previous comment" }),
    ).toBeTruthy();
    expect(comments.getBoundingClientRect().left).toBeCloseTo(
      persistentPositions.comments,
      1,
    );
  },
};

/** With no selection, Previous starts at the last visible comment. */
export const CommentSteppingNoSelection: Story = {
  args: {
    commentThreadIds: ["t1", "t2", "t3"],
    activeCommentThreadId: null,
    onCycleComment: fn(),
  },
  render: (args) => <ControlledCommentStatusBar {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByLabelText("3 comments")).toBeTruthy();
    await userEvent.click(
      canvas.getByRole("button", { name: "Previous comment" }),
    );
    expect(args.onCycleComment).toHaveBeenLastCalledWith("t3");
    expect(canvas.getByLabelText("Comment 3 of 3")).toBeTruthy();
  },
};

/** Settled update range for theme and visual regression coverage. */
export const IterationRange: Story = {
  args: {
    iterationRange: {
      fromUpdate: 1,
      toUpdate: 3,
    },
  },
  render: (args) => <ControlledReaderStatusBar {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const [previous, next] = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".emr-statusbar-iteration-step",
    );
    expect(previous).toHaveAttribute(
      "aria-label",
      "Previous comparison: Base → Update 1",
    );
    expect(next).toHaveAttribute("aria-label", "Next comparison: All updates");
    expect(next).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Update 1 → 3" }));
    const selectedOptions = canvas.getAllByRole("option", { selected: true });
    expect(selectedOptions).toHaveLength(2);
    expect(selectedOptions.map((option) => option.textContent)).toEqual([
      expect.stringContaining("2Refine review workflow"),
      expect.stringContaining("3Improve review workflow"),
    ]);
    fireEvent.click(
      canvas.getByRole("option", { name: /2 Refine review workflow/ }),
      { shiftKey: true },
    );
    expect(args.onIterationRangeChange).toHaveBeenCalledWith({
      fromUpdate: 1,
      toUpdate: 3,
    });
    await userEvent.click(next!);
    expect(canvas.getByRole("button", { name: "All updates" })).toBeTruthy();
    expect(next).toBeDisabled();
  },
};

/** High contrast uses one continuous outline because its soft fill matches the page. */
export const IterationRangeHighContrast: Story = {
  args: IterationRange.args,
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        const root = document.documentElement;
        const previousTheme = root.getAttribute("data-emr-theme");
        root.setAttribute("data-emr-theme", "hc-light");
        return () => {
          if (previousTheme) root.setAttribute("data-emr-theme", previousTheme);
          else root.removeAttribute("data-emr-theme");
        };
      }, []);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Update 1 → 3" }));
    const selectedOptions = canvas.getAllByRole("option", { selected: true });
    expect(selectedOptions).toHaveLength(2);

    const rangeStart = getComputedStyle(selectedOptions[0]!, "::after");
    const rangeEnd = getComputedStyle(selectedOptions[1]!, "::after");
    expect(rangeStart.borderLeftColor).toBe("rgb(0, 51, 204)");
    expect(parseFloat(rangeStart.borderTopWidth)).toBeGreaterThan(0);
    expect(rangeStart.borderBottomWidth).toBe("0px");
    expect(rangeEnd.borderTopWidth).toBe("0px");
    expect(parseFloat(rangeEnd.borderBottomWidth)).toBeGreaterThan(0);
    expect(
      canvas
        .getByRole("listbox", { name: "Review iterations" })
        .querySelector(".emr-statusbar-font-check"),
    ).toBeNull();
  },
};

/** Compact relative ages cover minute/hour/day and absent-date rendering. */
export const IterationRelativeAges: Story = {
  args: {
    iterationBaseCommit: undefined,
    iterationOptions: [
      { stopIndex: 3, number: 1, title: "No recorded timestamp" },
      {
        stopIndex: 2,
        number: 2,
        title: "Two days ago",
        dateMs: Date.now() - 2 * 24 * 60 * 60_000,
      },
      {
        stopIndex: 1,
        number: 3,
        title: "Two hours ago",
        dateMs: Date.now() - 2 * 60 * 60_000,
      },
      {
        stopIndex: 0,
        number: 4,
        title: "Fifteen minutes ago",
        dateMs: Date.now() - 15 * 60_000,
      },
    ],
    iterationRange: { fromUpdate: 0, toUpdate: 1 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Base → Update 1" }),
    );
    expect(
      canvas
        .getByRole("button", { name: "Base → Update 1" })
        .querySelector(".emr-statusbar-iteration-base"),
    ).toHaveAttribute("title", "Base commit");
    expect(canvas.getByText(/15m ago/)).toBeTruthy();
    expect(canvas.getByText(/2h ago/)).toBeTruthy();
    expect(canvas.getByText(/2d ago/)).toBeTruthy();
    expect(
      canvas
        .getByRole("option", { name: /No recorded timestamp/ })
        .querySelector("time"),
    ).toBeNull();
  },
};

/**
 * Every control flows through its callback: the view toggles, the font popover
 * (open → pick + change spacing → close on Escape) and text-size slider.
 */
export const Interactions: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // View toggles fire their callbacks.
    await userEvent.click(canvas.getByRole("button", { name: "Navigation" }));
    await userEvent.click(canvas.getByRole("button", { name: "Comments" }));
    await userEvent.click(canvas.getByRole("button", { name: "Changes" }));
    expect(args.onToggleNav).toHaveBeenCalled();
    expect(args.onToggleComments).toHaveBeenCalled();
    expect(args.onToggleChanges).toHaveBeenCalled();

    // Iteration picker restores trigger focus on Escape and closes without
    // stealing focus on an outside pointer-down.
    const iterationTrigger = canvas.getByRole("button", {
      name: "All updates",
    });
    const iterationPopover = canvasElement.querySelector<HTMLElement>(
      ".emr-statusbar-iteration-pop",
    )!;
    await userEvent.click(iterationTrigger);
    expect(iterationPopover.inert).toBe(false);
    expect(iterationPopover).toHaveAttribute("aria-hidden", "false");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
      ).toBeNull(),
    );
    expect(iterationTrigger).toHaveFocus();
    expect(iterationPopover.inert).toBe(true);
    expect(iterationPopover).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(iterationTrigger);
    await userEvent.click(canvas.getByRole("button", { name: "Navigation" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
      ).toBeNull(),
    );
    expect(canvas.getByRole("button", { name: "Navigation" })).toHaveFocus();
    expect(iterationPopover.inert).toBe(true);

    // All updates and numbered updates remain mutually exclusive and the
    // picker stays open so the resulting selection remains visible.
    await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    expect(args.onIterationRangeChange).toHaveBeenCalledWith({
      fromUpdate: 0,
      toUpdate: 3,
    });
    expect(
      canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
    ).not.toBeNull();
    const iterationOne = canvas.getByRole("option", {
      name: /1 Initial draft/,
    });
    fireEvent.click(iterationOne, { shiftKey: true });
    expect(args.onIterationRangeChange).toHaveBeenCalledWith({
      fromUpdate: 0,
      toUpdate: 1,
    });
    expect(
      canvas.getByRole("listbox", { name: "Review iterations" }),
    ).toBeTruthy();
    fireEvent.click(iterationOne);
    expect(args.onIterationRangeChange).toHaveBeenCalledWith({
      fromUpdate: 0,
      toUpdate: 1,
    });
    expect(
      canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
    ).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
      ).toBeNull(),
    );
    expect(iterationTrigger).toHaveFocus();

    // Font popover: open, pick the reading serif, then close with Escape.
    const typeTrigger = canvas.getByRole("button", { name: "Aa" });
    const typePopover =
      canvasElement.querySelector<HTMLElement>(".emr-statusbar-pop")!;
    await userEvent.click(typeTrigger);
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).not.toBeNull(),
    );
    expect(typePopover.inert).toBe(false);
    expect(typePopover).toHaveAttribute("aria-hidden", "false");
    // A non-Escape key while the popover is open is ignored (keydown guard).
    await userEvent.keyboard("{ArrowDown}");
    // A pointer-down INSIDE the popover (picking a font) doesn't close it.
    await userEvent.click(canvas.getByRole("button", { name: /Sitka/ }));
    expect(args.onFontChange).toHaveBeenCalledWith("sitka");
    fireEvent.change(canvas.getByRole("slider", { name: "Text spacing" }), {
      target: { value: "125" },
    });
    expect(args.onSpacingChange).toHaveBeenCalledWith(125);
    fireEvent.keyDown(canvasElement.ownerDocument, { key: "Escape" });
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).toBeNull(),
    );
    expect(typeTrigger).toHaveFocus();
    expect(typePopover.inert).toBe(true);
    expect(typePopover).toHaveAttribute("aria-hidden", "true");

    // Re-open, then a pointer-down OUTSIDE the popover closes it — and the
    // click still nudges the text size (smaller).
    await userEvent.click(typeTrigger);
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).not.toBeNull(),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Decrease text size" }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).toBeNull(),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Increase text size" }),
    );

    fireEvent.change(canvas.getByRole("slider", { name: "Text size" }), {
      target: { value: "125" },
    });
    const sizeSlider = canvas.getByRole("slider", { name: "Text size" });
    for (const key of [
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
      "ArrowUp",
      "Home",
    ]) {
      fireEvent.keyDown(sizeSlider, { key });
    }
    expect(args.onSizeChange).toHaveBeenCalledWith(95);
    expect(args.onSizeChange).toHaveBeenCalledWith(105);
    expect(args.onSizeChange).toHaveBeenCalledWith(125);
    expect(args.onSizeChange).toHaveBeenCalledWith(99);
    expect(args.onSizeChange).toHaveBeenCalledWith(101);
  },
};

/** A machine with no curated local fonts keeps spacing but hides System-only UI. */
export const SystemOnly: Story = {
  args: {
    fontId: "atkinson",
    availableFontIds: ["system"],
    onFontChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
    expect(canvas.queryByText("Reading font")).toBeNull();
    expect(canvas.getByRole("slider", { name: "Text spacing" })).toBeTruthy();
    expect(args.onFontChange).not.toHaveBeenCalled();
  },
};

/** Browsers without the FontFace API degrade to System without hiding spacing. */
export const FontDetectionUnavailable: Story = {
  args: {
    availableFontIds: undefined,
  },
  beforeEach: () => {
    const NativeFontFace = window.FontFace;
    window.FontFace = undefined as unknown as typeof FontFace;
    return () => {
      window.FontFace = NativeFontFace;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
    await waitFor(() => expect(canvas.queryByText("Reading font")).toBeNull());
    expect(canvas.getByRole("slider", { name: "Text spacing" })).toBeTruthy();
  },
};
