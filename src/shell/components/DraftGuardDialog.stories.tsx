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
        await userEvent.click(canvas.getByRole("button", { name: /discard draft/i }));
        await expect(args.onDiscard).toHaveBeenCalled();
    },
};

/** Keep editing dismisses the dialog and preserves the draft. */
export const KeepEditing: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: /keep editing/i }));
        await expect(args.onKeepEditing).toHaveBeenCalled();
    },
};

/**
 * Escape and a click on the dimmed backdrop both keep the draft; typing other
 * keys or clicking inside the dialog card doesn't dismiss it.
 */
export const DismissAffordances: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const dialog = canvas.getByRole("dialog", { name: "Unsaved comment draft" });

        await expect(within(dialog).getByText(args.snippet)).toBeVisible();
        await userEvent.keyboard("a");
        await expect(args.onKeepEditing).not.toHaveBeenCalled();

        await userEvent.keyboard("{Escape}");
        await expect(args.onKeepEditing).toHaveBeenCalledTimes(1);

        // The labelled dialog element is the full-screen backdrop around the card.
        await userEvent.click(dialog);
        await expect(args.onKeepEditing).toHaveBeenCalledTimes(2);

        await userEvent.click(canvas.getByText("You already have an unsaved comment"));
        await expect(args.onKeepEditing).toHaveBeenCalledTimes(2);
        await expect(args.onDiscard).not.toHaveBeenCalled();
    },
};
