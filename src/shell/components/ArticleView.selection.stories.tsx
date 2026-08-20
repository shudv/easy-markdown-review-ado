import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { renderMarkdownSync } from "../../markdown/render";
import { ArticleView } from "./ArticleView";

const SELECTED_LINE =
  "Triple-click selects this entire line for an inline review comment.";
const SOURCE = [
  "# Selection behavior",
  "",
  SELECTED_LINE,
  "",
  "The next paragraph keeps the block boundary realistic.",
  "",
].join("\n");

const meta = {
  title: "Components/ArticleViewSelection",
  component: ArticleView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        const root = document.documentElement;
        const previous = root.getAttribute("data-emr-theme");
        root.setAttribute("data-emr-theme", "dark");
        return () => {
          if (previous) root.setAttribute("data-emr-theme", previous);
          else root.removeAttribute("data-emr-theme");
          window.getSelection()?.removeAllRanges();
        };
      }, []);
      return (
        <div style={{ width: 760, padding: 32 }}>
          <Story />
        </div>
      );
    },
  ],
  args: {
    pristineHtml: renderMarkdownSync(SOURCE),
    documentPath: "/selection-behavior.md",
    threads: [],
    activeThreadId: null,
    draftAnchor: null,
    showDiff: false,
    storageKey: "selection-behavior.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Real Chromium triple-click: full line selected and Add comment available. */
export const TripleClickLineDark: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const paragraph = await waitFor(() => canvas.getByText(SELECTED_LINE));
    await userEvent.tripleClick(paragraph);

    await waitFor(() =>
      expect(canvas.getByRole("button", { name: /add comment/i })).toBeTruthy(),
    );
    expect(window.getSelection()?.toString().trim()).toBe(SELECTED_LINE);
    expect(getComputedStyle(paragraph, "::selection").backgroundColor).toBe(
      "rgba(76, 194, 255, 0.42)",
    );
    await userEvent.click(canvas.getByRole("button", { name: /add comment/i }));
    expect(args.onSelection).toHaveBeenCalledWith(
      expect.objectContaining({ exact: SELECTED_LINE, line: 3, endLine: 3 }),
    );
  },
};

/** Stable visual equivalent of the browser triple-click selection. */
export const FullLineSelectionDark: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const paragraph = await waitFor(() => canvas.getByText(SELECTED_LINE));
    const text = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await waitFor(() =>
      expect(canvas.getByRole("button", { name: /add comment/i })).toBeTruthy(),
    );
    expect(getComputedStyle(paragraph, "::selection").backgroundColor).toBe(
      "rgba(76, 194, 255, 0.42)",
    );
  },
};
