import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { DraftGuardDialog } from "./DraftGuardDialog";

const meta = {
  title: "Components/DraftGuardDialog",
  component: DraftGuardDialog,
  parameters: { layout: "fullscreen" },
  args: {
    fileName: "design.md",
    snippet: "This is the in-progress comment the reviewer hasn't posted yet…",
    onDiscard: fn(),
    onKeepEditing: fn(),
  },
} satisfies Meta<typeof DraftGuardDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Discard drops the existing draft and proceeds. */
export const Discard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /discard draft/i }),
    );
    await expect(args.onDiscard).toHaveBeenCalled();
  },
};

/** Keep editing dismisses the dialog and preserves the draft. */
export const KeepEditing: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /keep editing/i }),
    );
    await expect(args.onKeepEditing).toHaveBeenCalled();
  },
};

/** Escape keeps the draft; clicking the backdrop keeps it too. */
export const DismissAffordances: Story = {
  play: async ({ args, canvasElement }) => {
    // A non-Escape key is ignored (the handler's early-return branch).
    await userEvent.keyboard("a");
    await expect(args.onKeepEditing).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await expect(args.onKeepEditing).toHaveBeenCalled();

    // Clicking the overlay (outside the card) also keeps the draft.
    const overlay = canvasElement.querySelector<HTMLElement>(
      ".emr-draft-guard-overlay",
    )!;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(args.onKeepEditing).toHaveBeenCalledTimes(2);

    // A click on the card itself (not the overlay) does not dismiss.
    const card = canvasElement.querySelector<HTMLElement>(".emr-draft-guard")!;
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(args.onKeepEditing).toHaveBeenCalledTimes(2);
  },
};
