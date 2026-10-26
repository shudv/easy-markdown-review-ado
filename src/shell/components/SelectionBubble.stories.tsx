import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { SelectionBubble } from "./SelectionBubble";

const meta = {
  title: "Components/SelectionBubble",
  component: SelectionBubble,
  args: {
    top: 40,
    left: 120,
    onAddComment: fn(),
  },
} satisfies Meta<typeof SelectionBubble>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AddsComment: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Clicking fires mousedown (handled on the wrapper) and the button click.
    await userEvent.click(canvas.getByRole("button", { name: /add comment/i }));
    await expect(args.onAddComment).toHaveBeenCalledTimes(1);
  },
};

/**
 * With a shareable URL, a quiet icon-only "Copy link to selection" sits after
 * "Add comment" behind a hairline divider. Clicking it confirms in place
 * (check + "Link copied"), ignores repeat clicks while busy, then asks to
 * close.
 */
export const CopiesLink: Story = {
  args: {
    onCopyLink: fn(() => Promise.resolve(true)),
    onCopyLinkSettled: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("button", { name: "Copy link to selection" });
    await expect(link.textContent).toBe("");
    await expect(
      canvasElement.querySelector(".emr-selection-bubble-divider"),
    ).not.toBeNull();
    await userEvent.click(link);
    await userEvent.click(link);
    const copied = await waitFor(() =>
      canvas.getByRole("button", { name: "Link copied" }),
    );
    await expect(copied.classList.contains("is-copied")).toBe(true);
    await expect(copied.textContent).toBe("Link copied");
    await expect(canvas.getByRole("status").textContent).toBe("Link copied");
    await expect(args.onCopyLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(args.onCopyLinkSettled).toHaveBeenCalled(), {
      timeout: 3000,
    });
  },
};

/** A failed copy says so (longer), then asks to close. */
export const CopyLinkFails: Story = {
  args: {
    onCopyLink: fn(() => Promise.resolve(false)),
    onCopyLinkSettled: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Copy link to selection" }),
    );
    const failed = await waitFor(() =>
      canvas.getByRole("button", { name: "Couldn't copy link" }),
    );
    await expect(failed.classList.contains("is-failed")).toBe(true);
    await waitFor(() => expect(args.onCopyLinkSettled).toHaveBeenCalled(), {
      timeout: 4000,
    });
  },
};

/** A copy that throws is reported as a failed copy, not left pending. */
export const CopyLinkRejects: Story = {
  args: {
    onCopyLink: fn(() => Promise.reject(new Error("link builder failed"))),
    onCopyLinkSettled: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Copy link to selection" }),
    );
    await waitFor(() =>
      canvas.getByRole("button", { name: "Couldn't copy link" }),
    );
    await waitFor(() => expect(args.onCopyLinkSettled).toHaveBeenCalled(), {
      timeout: 4000,
    });
  },
};

/**
 * Read-only surfaces (no commenting) keep the link as the only action, with a
 * visible label. Unmounting before the confirmation ends cancels the close.
 */
export const LinkOnly: Story = {
  args: {
    onAddComment: undefined,
    onCopyLink: fn(() => Promise.resolve(true)),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: /add comment/i })).toBe(
      null,
    );
    await expect(
      canvasElement.querySelector(".emr-selection-bubble-divider"),
    ).toBeNull();
    const link = canvas.getByRole("button", { name: "Copy link to selection" });
    await expect(link.textContent).toBe("Copy link");
    await userEvent.click(link);
    await waitFor(() => canvas.getByRole("button", { name: "Link copied" }));
  },
};
