import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type ComponentProps,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { flushSync } from "react-dom";
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
      useLayoutEffect(() => {
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

/** Select the whole text of `node` and release the mouse, as a reader would. */
function selectText(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  node.parentElement!.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true }),
  );
}

const REMOVED_WORDS = "words the update removed";

/**
 * Read-only surface: removed words are reference text, not linkable document
 * text, so selecting only them withdraws the link-only bubble.
 */
export const ReadOnlyRemovedWordsOfferNoLink: Story = {
  args: {
    readOnly: true,
    onCopySelectionLink: fn(async () => true),
    pristineHtml:
      '<p data-source-line="1">Kept sentence with ' +
      `<span class="emr-word-removed">${REMOVED_WORDS}</span> and more.</p>`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const removed = await waitFor(() => canvas.getByText(REMOVED_WORDS));

    selectText(removed.parentElement!.firstChild!);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Copy link to selection" }),
      ).toBeTruthy(),
    );

    selectText(removed.firstChild!);
    await waitFor(() =>
      expect(
        canvas.queryByRole("button", { name: "Copy link to selection" }),
      ).toBeNull(),
    );
  },
};

/**
 * Unmounts the article from a theme observer registered after ArticleView's
 * own, i.e. after the theme flip started re-hydrating Mermaid but before that
 * hydration settles.
 */
function UnmountOnThemeFlip(
  props: ComponentProps<typeof ArticleView>,
): ReactElement {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const observer = new MutationObserver(() =>
      flushSync(() => setMounted(false)),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-emr-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return mounted ? <ArticleView {...props} /> : <p>Article closed</p>;
}

/** A theme flip whose Mermaid re-hydration settles after unmount is ignored. */
export const ThemeFlipSettlesAfterUnmount: Story = {
  render: (args) => <UnmountOnThemeFlip {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText(SELECTED_LINE));
    document.documentElement.setAttribute("data-emr-theme", "light");
    await waitFor(() =>
      expect(canvas.getByText("Article closed")).toBeTruthy(),
    );
    // Let the re-hydration started before unmount settle against the null ref.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(canvasElement.querySelector(".emr-article-wrap")).toBeNull();
  },
};
