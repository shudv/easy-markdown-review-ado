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

/** Clicking "Add comment" asks the host to start a comment on the selection. */
export const AddsComment: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: /add comment/i }));
        await expect(args.onAddComment).toHaveBeenCalledTimes(1);
        // Without a shareable URL there is nothing to link to.
        await expect(canvas.queryByRole("button", { name: "Copy link to selection" })).toBeNull();
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

        const link = canvas.getByRole("button", {
            name: "Copy link to selection",
        });

        // Icon-only next to "Add comment": the name comes from its label, not visible text.
        await expect(link).toHaveTextContent("");
        await expect(canvas.getByRole("button", { name: /add comment/i })).toBeTruthy();
        await userEvent.click(link);
        await userEvent.click(link);

        const copied = await waitFor(() => canvas.getByRole("button", { name: "Link copied" }));

        await expect(copied).toHaveTextContent("Link copied");
        await expect(canvas.getByRole("status").textContent).toBe("Link copied");
        await expect(args.onCopyLink).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(args.onCopyLinkSettled).toHaveBeenCalled(), {
            timeout: 3000,
        });
    },
};

const refusedCopy = fn(() => Promise.resolve(false));
const brokenLinkCopy = fn(() => Promise.reject(new Error("link builder failed")));
const failedCopySettled = fn();

/**
 * A copy fails either because the clipboard refuses it or because the link
 * can't be built (the host's builder throws). Either way the bubble says
 * "Couldn't copy link" — never stuck on pending — then asks to close.
 */
export const CopyLinkFails: Story = {
    render: (args) => (
        <>
            <SelectionBubble
                {...args}
                onCopyLink={refusedCopy}
                onCopyLinkSettled={failedCopySettled}
            />
            <SelectionBubble
                {...args}
                top={args.top + 80}
                onCopyLink={brokenLinkCopy}
                onCopyLinkSettled={failedCopySettled}
            />
        </>
    ),
    beforeEach: () => {
        failedCopySettled.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);

        for (const button of canvas.getAllByRole("button", { name: "Copy link to selection" })) {
            await userEvent.click(button);
        }

        await waitFor(() =>
            expect(canvas.getAllByRole("button", { name: "Couldn't copy link" })).toHaveLength(2),
        );
        await expect(refusedCopy).toHaveBeenCalled();
        await expect(brokenLinkCopy).toHaveBeenCalled();
        await waitFor(() => expect(failedCopySettled).toHaveBeenCalledTimes(2), {
            timeout: 4000,
        });
    },
};

/**
 * Read-only surfaces (no commenting) keep the link as the only action, with a
 * visible "Copy link" label.
 */
export const LinkOnly: Story = {
    args: {
        onAddComment: undefined,
        onCopyLink: fn(() => Promise.resolve(true)),
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByRole("button", { name: /add comment/i })).toBe(null);

        const link = canvas.getByRole("button", {
            name: "Copy link to selection",
        });

        await expect(link).toHaveTextContent("Copy link");
        await userEvent.click(link);
        await waitFor(() => canvas.getByRole("button", { name: "Link copied" }));
    },
};
