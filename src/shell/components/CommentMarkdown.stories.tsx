import type { Meta, StoryObj } from "@storybook/react-vite";

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

export const Rich: Story = {};

export const PlainText: Story = {
  args: { body: "Just a plain sentence, no formatting." },
};
