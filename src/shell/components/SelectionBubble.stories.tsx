import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

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
