import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { ReaderStatusBar } from "./ReaderStatusBar";

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
    onFontChange: fn(),
    onSizeStep: fn(),
    onSizeReset: fn(),
    showNav: true,
    onToggleNav: fn(),
    navToggleable: true,
    showComments: true,
    onToggleComments: fn(),
    changesAvailable: true,
    changesShown: true,
    onToggleChanges: fn(),
    feedbackHref: "mailto:x@microsoft.com",
    onRefresh: fn(),
    // `refreshLabel` intentionally omitted — exercises the "Refresh" fallback.
  },
} satisfies Meta<typeof ReaderStatusBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The settled bar: word count + delta on the left, colour-only toggles right. */
export const Default: Story = {
  play: ({ canvasElement }) => {
    const delta = canvasElement.querySelector<HTMLElement>(
      ".emr-statusbar-delta",
    )!;
    expect(delta.textContent).toBe("+38−12");
    expect(
      delta
        .querySelector(".emr-statusbar-delta-add")
        ?.getAttribute("aria-label"),
    ).toBe("38 words added");
  },
};

/**
 * Every control flows through its callback: the view toggles, the font popover
 * (open → pick → close on Escape) and the text-size stepper (smaller / larger /
 * reset).
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

    // Font popover: open, pick a serif, then close with Escape.
    await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).not.toBeNull(),
    );
    // A non-Escape key while the popover is open is ignored (keydown guard).
    await userEvent.keyboard("{ArrowDown}");
    // A pointer-down INSIDE the popover (picking a font) doesn't close it.
    await userEvent.click(canvas.getByRole("button", { name: /Georgia/ }));
    expect(args.onFontChange).toHaveBeenCalledWith("georgia");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).toBeNull(),
    );

    // Re-open, then a pointer-down OUTSIDE the popover closes it — and the
    // click still steps the text size (smaller).
    await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).not.toBeNull(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Smaller text" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).toBeNull(),
    );

    // Text-size stepper: larger, then reset via the value button.
    await userEvent.click(canvas.getByRole("button", { name: "Larger text" }));
    await userEvent.click(canvas.getByRole("button", { name: "100%" }));
    expect(args.onSizeStep).toHaveBeenCalledWith(-1);
    expect(args.onSizeStep).toHaveBeenCalledWith(1);
    expect(args.onSizeReset).toHaveBeenCalled();
  },
};
