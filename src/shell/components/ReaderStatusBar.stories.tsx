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
    const canvas = within(canvasElement);
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
    const spacingSlider = canvas.getByRole("slider", {
      name: "Text spacing",
    });
    expect(sizeSlider.getAttribute("min")).toBe("50");
    expect(sizeSlider.getAttribute("max")).toBe("150");
    expect(spacingSlider.getAttribute("min")).toBe("100");
    expect(spacingSlider.getAttribute("max")).toBe("200");
    expect(
      canvas.getByRole("button", { name: "Decrease text spacing" }),
    ).toBeDisabled();
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

    // Font popover: open, pick the reading serif, then close with Escape.
    await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).not.toBeNull(),
    );
    // A non-Escape key while the popover is open is ignored (keydown guard).
    await userEvent.keyboard("{ArrowDown}");
    // A pointer-down INSIDE the popover (picking a font) doesn't close it.
    await userEvent.click(canvas.getByRole("button", { name: /Sitka/ }));
    expect(args.onFontChange).toHaveBeenCalledWith("sitka");
    fireEvent.change(canvas.getByRole("slider", { name: "Text spacing" }), {
      target: { value: "125" },
    });
    expect(args.onSpacingChange).toHaveBeenCalledWith(125);
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-statusbar-type.is-open"),
      ).toBeNull(),
    );

    // Re-open, then a pointer-down OUTSIDE the popover closes it — and the
    // click still nudges the text size (smaller).
    await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
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
