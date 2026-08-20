// Visual-regression fixture for the YAML frontmatter metadata card.
//
// `extractFrontmatter` lifts a leading `---…---` block off the source and
// `renderFrontmatterHtml` renders it as an `.emr-frontmatter` card prepended
// to the article. This story pins that card's pixels (scalars + value tags,
// light AND dark) so a regression in the frontmatter styling shows up as a
// diff. Deterministic: no time, no animation, no diff layer, no Mermaid.
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
  "---",
  "title: Q3 Architecture Review",
  "author: Ada Lovelace",
  "status: In Review",
  "tags: [architecture, backend, rfc]",
  "reviewers:",
  "  - Grace Hopper",
  "  - Alan Turing",
  "---",
  "",
  "# Q3 Architecture Review",
  "",
  "This document proposes the migration plan for the ingestion service.",
  "",
  "## Goals",
  "",
  "- Reduce end-to-end latency.",
  "- Improve backpressure handling.",
  "",
].join("\n");

const HTML = renderMarkdownSync(SOURCE);

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
    // Load the SAME github-markdown-css the shipped reader injects at runtime.
    // Storybook's preview only loads styles.scss, so without this the `.emr-
    // frontmatter` card renders WITHOUT github's `.markdown-body dl dt/dd`
    // margins — which is exactly why an earlier compact-looking baseline hid
    // the heavy spacing seen in the real PR. Loading it here keeps the visual
    // loop faithful to production.
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
        padding: 24,
        width: 720,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Visual/ArticleFrontmatter",
  component: ArticleView,
  parameters: { layout: "fullscreen" },
  args: {
    pristineHtml: HTML,
    threads: [],
    activeThreadId: null,
    draftAnchor: null,
    diff: [],
    showDiff: false,
    storageKey: "visual-frontmatter.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

async function waitForCard(canvasElement: HTMLElement): Promise<void> {
  await waitFor(
    () => {
      if (!canvasElement.querySelector(".emr-frontmatter-row")) {
        throw new Error("frontmatter card not rendered yet");
      }
    },
    { timeout: 5000 },
  );
}

/** Light theme: tinted metadata card with scalar rows and value tags. */
export const Light: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForCard(canvasElement);
  },
};

/** Dark theme: the same card, verifying the dark colour tokens. */
export const Dark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForCard(canvasElement);
  },
};

// Frontmatter diff fixture. Lines (in SOURCE): status=4, tags=5, and the
// `reviewers` block list = 6 (key) with items on 7-8. The ranges edit the
// `status` scalar, rework the inline `tags` array, and change one `reviewers`
// block-list item — each shown as an inline word-diff of the value.
const DIFF: DiffRange[] = [
  // Scalar edit: `Draft` → `In Review`, struck-old + green-new inline.
  {
    startLine: 4,
    endLine: 4,
    kind: "modified",
    originalText: "status: Draft",
    linesAdded: 1,
    linesDeleted: 1,
  },
  // Inline-array edit: original tags were [architecture, frontend, rfc]; now
  // [architecture, backend, rfc] — `frontend` removed, `backend` added.
  {
    startLine: 5,
    endLine: 5,
    kind: "modified",
    originalText: "tags: [architecture, frontend, rfc]",
    linesAdded: 1,
    linesDeleted: 1,
  },
  // Block-list item edit: the reviewer on line 8 was `Ada Lovelace`, now
  // `Alan Turing`. ADO hands us only the changed item line (no `reviewers:`
  // key), so this pins the block-list original-value reconstruction.
  {
    startLine: 8,
    endLine: 8,
    kind: "modified",
    originalText: "  - Ada Lovelace",
    linesAdded: 1,
    linesDeleted: 1,
  },
];

async function waitForFrontmatterDiff(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitFor(
    () => {
      if (
        !canvasElement.querySelector(".emr-frontmatter-value .emr-word-added")
      ) {
        throw new Error("frontmatter value word-diff (added) not applied yet");
      }
      if (
        !canvasElement.querySelector(".emr-frontmatter-value .emr-word-removed")
      ) {
        throw new Error(
          "frontmatter value word-diff (removed) not applied yet",
        );
      }
    },
    { timeout: 5000 },
  );
}

/**
 * Light theme frontmatter DIFF: a scalar value wash (`status`), interleaved
 * added/removed tag pills (`tags`), and an added block-list row (`reviewers`).
 */
export const Diff: Story = {
  args: { diff: DIFF, showDiff: true },
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForFrontmatterDiff(canvasElement);
  },
};

/** Dark theme frontmatter DIFF: same edits, verifying the dark diff tokens. */
export const DiffDark: Story = {
  args: { diff: DIFF, showDiff: true },
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForFrontmatterDiff(canvasElement);
  },
};
