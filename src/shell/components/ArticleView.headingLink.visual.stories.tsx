// Visual-regression fixture for the "Copy link to section" heading button.
//
// ArticleView appends an icon-only link button after each heading's text when
// the host can build a shareable URL. It is hidden until the heading is
// hovered, so the curated spec hovers a heading with Playwright's real pointer
// and crops tight to it — the glyph is small, and only a focused shot gives it
// enough of the frame for the tolerance to notice a change. The `Retention`
// heading is an added (diff-washed) block, pinning that the link button sits
// OUTSIDE the line wash, next to the heading text, rather than inside it.
// Deterministic: no time, no animation, no Mermaid.
//
// Screenshotted by visual/curated.visual.spec.ts.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { fn, waitFor } from "storybook/test";

import type { DiffRange } from "../../types";
import { renderMarkdownSync } from "../../markdown/render";
import { setMarkdownDark } from "../../theme/markdownStyles";
import { ArticleView } from "./ArticleView";

const SOURCE = [
  "# Glossary",
  "",
  "Shared vocabulary for the data-semantics instructions.",
  "",
  "## Classifiers & Hashing",
  "",
  "How records are bucketed before they are hashed.",
  "",
  "### Retention",
  "",
  "How long hashed records are kept.",
  "",
].join("\n");

const HTML = renderMarkdownSync(SOURCE);

// Lines 9-11 (the `### Retention` heading and its paragraph) are new.
const DIFF: DiffRange[] = [{ startLine: 9, endLine: 11, kind: "added" }];

/** Applies an EMR theme to the document root for the story's lifetime. */
function ThemeFrame({
  theme,
  children,
}: {
  theme?: "dark";
  children: React.ReactNode;
}): React.ReactElement {
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("data-emr-theme");
    if (theme) el.setAttribute("data-emr-theme", theme);
    else el.removeAttribute("data-emr-theme");
    // The same github-markdown-css the shipped reader injects, so heading
    // sizes (which the button scales with) match production.
    setMarkdownDark(theme === "dark");
    return () => {
      if (prev) el.setAttribute("data-emr-theme", prev);
      else el.removeAttribute("data-emr-theme");
    };
  }, [theme]);
  return (
    <div
      style={{
        background: "var(--emr-bg)",
        color: "var(--emr-fg)",
        padding: "24px 24px 24px 48px",
        width: 640,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Visual/HeadingLink",
  component: ArticleView,
  parameters: { layout: "fullscreen" },
  args: {
    pristineHtml: HTML,
    documentPath: "/docs/glossary.md",
    threads: [],
    activeThreadId: null,
    draftAnchor: null,
    diff: DIFF,
    showDiff: true,
    storageKey: "visual-heading-link.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
    onCopyHeadingLink: fn(() => Promise.resolve(true)),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

async function waitForHeadingLinks(canvasElement: HTMLElement): Promise<void> {
  await waitFor(
    () => {
      if (
        !canvasElement.querySelector(
          "#retention.emr-diff-block > .emr-heading-link",
        )
      ) {
        throw new Error("heading links / diff wash not applied yet");
      }
    },
    { timeout: 5000 },
  );
}

/** Light theme. */
export const Light: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForHeadingLinks(canvasElement);
  },
};

/** Dark theme: the same headings, verifying the dark colour tokens. */
export const Dark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForHeadingLinks(canvasElement);
  },
};
