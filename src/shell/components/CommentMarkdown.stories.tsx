import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { CommentMarkdown } from "./CommentMarkdown";

const meta = {
    title: "Components/CommentMarkdown",
    component: CommentMarkdown,
    args: {
        body: "A **bold** idea with `code`, a [link](https://example.com), and a list:\n\n- one\n- two",
    },
} satisfies Meta<typeof CommentMarkdown>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A comment's Markdown renders as formatted text: bold, code, a link and a list. */
export const Rich: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("bold").tagName).toBe("STRONG");
        await expect(canvas.getByText("code").tagName).toBe("CODE");
        await expect(canvas.getByRole("link", { name: "link" })).toHaveAttribute(
            "href",
            "https://example.com",
        );
        await expect(canvas.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
            "one",
            "two",
        ]);
    },
};

/** A plain sentence shows as written. */
export const PlainText: Story = {
    args: { body: "Just a plain sentence, no formatting." },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText("Just a plain sentence, no formatting."),
        ).toBeVisible();
    },
};
