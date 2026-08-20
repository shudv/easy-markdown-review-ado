import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { CommentFilterMenu } from "./CommentFilterMenu";

const meta = {
  title: "Components/CommentFilterMenu",
  component: CommentFilterMenu,
  decorators: [
    (Story) => (
      <div style={{ padding: 40 }}>
        {/* An outside target so outside-click dismissal can be exercised. */}
        <button type="button" data-testid="outside">
          outside
        </button>
        <div style={{ marginTop: 20 }}>
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    mode: "active",
    counts: { all: 27, active: 12, resolved: 15, mine: 3 },
    onChange: fn(),
    onlyThisFile: false,
    onOnlyThisFileChange: fn(),
  },
} satisfies Meta<typeof CommentFilterMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The trigger reads as the active filter (its colour is consistent, no accent). */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /Filter comments/ });
    await expect(trigger).toHaveTextContent(/Active comments/i);
  },
};

/** Opening the menu then picking a mode fires onChange and closes the menu. */
export const OpenAndSelect: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Filter comments/ }),
    );
    // The current mode is checked; each option shows its count.
    const active = await waitFor(() =>
      canvas.getByRole("menuitemradio", { name: /Active comments/ }),
    );
    await expect(active).toHaveAttribute("aria-checked", "true");
    await expect(
      canvas.getByRole("menuitemradio", { name: /Resolved comments/ }),
    ).toHaveTextContent("15");

    await userEvent.click(
      canvas.getByRole("menuitemradio", { name: /Resolved comments/ }),
    );
    await expect(args.onChange).toHaveBeenCalledWith("resolved");
    // Menu closes after a pick.
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
  },
};

/** A click outside the menu dismisses it. */
export const OutsideClickCloses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Filter comments/ }),
    );
    await waitFor(() => expect(canvas.getByRole("menu")).toBeTruthy());
    await userEvent.click(canvas.getByTestId("outside"));
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
  },
};

/** Escape closes the menu and returns focus to the trigger. */
export const EscapeCloses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /Filter comments/ });
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByRole("menu")).toBeTruthy());
    // A non-Escape key is ignored — the menu stays open.
    await userEvent.keyboard("a");
    await expect(canvas.getByRole("menu")).toBeTruthy();
    // Escape closes and refocuses the trigger.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};

/** The "all" mode simply reads "All comments" — same styling as every mode. */
export const AllModeNoAccent: Story = {
  args: { mode: "all" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /Filter comments/ });
    await expect(trigger).toHaveTextContent(/All comments/i);
  },
};

/**
 * The "only this file" scope is a separate toggle that combines with any mode:
 * on its own (mode "all") it still accents the trigger, and toggling it fires
 * its own callback.
 */
export const OnlyThisFileScope: Story = {
  args: { mode: "all", onlyThisFile: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /Filter comments/ });
    await userEvent.click(trigger);
    const toggle = await waitFor(() =>
      canvas.getByRole("menuitemcheckbox", {
        name: /Hide comments not on this file/,
      }),
    );
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await expect(args.onOnlyThisFileChange).toHaveBeenCalledWith(false);
  },
};
