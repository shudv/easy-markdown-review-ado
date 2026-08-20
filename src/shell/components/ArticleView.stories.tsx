import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, waitFor, within } from "storybook/test";

import type { CommentThread, DiffRange, TextQuoteAnchor } from "../../types";
import { renderMarkdownSync } from "../../markdown/render";
import { ArticleView } from "./ArticleView";

const SOURCE = [
  "# Goals",
  "",
  "We want **Word-doc-style** review of Markdown files in the browser.",
  "",
  "## Approach",
  "",
  "Reviewers comment on the rendered preview right here in the page.",
  "",
  "```mermaid",
  "graph TD; A-->B;",
  "```",
  "",
  "```mermaid",
  "@@@ not a valid diagram @@@",
  "```",
  "",
].join("\n");

const HTML = renderMarkdownSync(SOURCE);
const SECTION_IDS = [...HTML.matchAll(/data-section-id="([^"]+)"/g)].map(
  (m) => m[1]!,
);

const THREADS: CommentThread[] = [
  {
    id: "t1",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "want Word-doc-style review",
      prefix: "We ",
      suffix: " of Markdown",
    },
    comments: [],
  },
  {
    id: "t2",
    filePath: "/doc.md",
    status: "resolved",
    anchor: {
      exact: "rendered preview",
      prefix: "comment on the ",
      suffix: " right here",
    },
    comments: [],
  },
  {
    id: "t3",
    filePath: "/doc.md",
    status: "active",
    anchor: { exact: "Goals", prefix: "", suffix: "" },
    comments: [],
  },
  {
    id: "t-orphan",
    filePath: "/doc.md",
    status: "active",
    anchor: { exact: "text that does not exist", prefix: "", suffix: "" },
    comments: [],
  },
];

const DRAFT: TextQuoteAnchor = {
  exact: "Markdown files",
  prefix: "review of ",
  suffix: " in the",
};

const DIFF: DiffRange[] = [{ startLine: 1, endLine: 3, kind: "added" }];

const meta = {
  title: "Components/ArticleView",
  component: ArticleView,
  decorators: [
    (Story) => (
      <>
        <style>{`[data-collapsed="true"] > :not(h1):not(h2):not(h3) { display: none; }`}</style>
        <div style={{ position: "relative", width: 640 }}>
          <Story />
        </div>
      </>
    ),
  ],
  args: {
    pristineHtml: HTML,
    documentPath: "/story-doc.md",
    threads: THREADS,
    activeThreadId: "t1",
    draftAnchor: DRAFT,
    diff: DIFF,
    showDiff: true,
    storageKey: "story-doc.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-highlight")).toBeTruthy(),
    );
    await expect(args.onAnchorsResolved).toHaveBeenCalled();
  },
};

/** Repository-relative images hydrate from the host; external images pass through. */
export const RepositoryImage: Story = {
  args: {
    pristineHtml: renderMarkdownSync(
      [
        "# Images",
        "",
        "![Architecture](../../assets/architecture.svg)",
        "",
        "![External](https://example.com/external.png)",
      ].join("\n"),
    ),
    documentPath: "/docs/guides/install.md",
    threads: [],
    draftAnchor: null,
    diff: [],
    resolveDocumentImage: fn(async () =>
      URL.createObjectURL(
        new Blob(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#008272"/></svg>',
          ],
          { type: "image/svg+xml" },
        ),
      ),
    ),
  },
  play: async ({ args, canvasElement }) => {
    const image = await waitFor(() => {
      const element =
        canvasElement.querySelector<HTMLImageElement>(".emr-repo-image");
      if (!element?.src.startsWith("blob:")) {
        throw new Error("repository image has not hydrated");
      }
      return element;
    });
    await expect(args.resolveDocumentImage).toHaveBeenCalledWith(
      "/assets/architecture.svg",
    );
    await waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0));
    await expect(
      canvasElement.querySelector<HTMLImageElement>('img[alt="External"]')?.src,
    ).toBe("https://example.com/external.png");
  },
};

/** Direct ArticleView embeds may use their storage key as the document path. */
export const RepositoryImageStorageFallback: Story = {
  args: {
    pristineHtml: renderMarkdownSync("# Image\n\n![Fallback](./fallback.svg)"),
    documentPath: undefined,
    storageKey: "/docs/fallback.md",
    threads: [],
    draftAnchor: null,
    diff: [],
    resolveDocumentImage: fn(async () =>
      URL.createObjectURL(
        new Blob(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#0078d4"/></svg>',
          ],
          { type: "image/svg+xml" },
        ),
      ),
    ),
  },
  play: async ({ args, canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector<HTMLImageElement>(".emr-repo-image")?.src,
      ).toMatch(/^blob:/),
    );
    await expect(args.resolveDocumentImage).toHaveBeenCalledWith(
      "/docs/fallback.svg",
    );
  },
};

/** Clicking a highlight opens its thread; the draft highlight is inert. */
export const ClickHighlight: Story = {
  play: async ({ args, canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-highlight[data-thread-id="t1"]'),
      ).toBeTruthy(),
    );
    const hl = canvasElement.querySelector<HTMLElement>(
      '.emr-highlight[data-thread-id="t1"]',
    )!;
    hl.click();
    await expect(args.onHighlightClick).toHaveBeenCalledWith("t1");
    const draft = canvasElement.querySelector<HTMLElement>(
      '.emr-highlight[data-thread-id="__draft__"]',
    );
    draft?.click();
    // Clicking empty article space hits no highlight (early return).
    canvasElement.querySelector<HTMLElement>(".emr-rendered")!.click();
  },
};

/** Clicking a section heading collapses it (and re-measures), then expands. */
export const CollapseSection: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-section h2")).toBeTruthy(),
    );
    const heading =
      canvasElement.querySelector<HTMLElement>(".emr-section > h2")!;
    heading.click();
    await waitFor(() =>
      expect(heading.parentElement?.getAttribute("data-collapsed")).toBe(
        "true",
      ),
    );
    heading.click();
    await waitFor(() =>
      expect(heading.parentElement?.getAttribute("data-collapsed")).toBeNull(),
    );
  },
};

/**
 * The document-title section (the single H1 wrapping the whole doc) is not
 * collapsible — clicking its heading does nothing.
 */
export const TitleNotCollapsible: Story = {
  play: async ({ canvasElement }) => {
    const title = await waitFor(() => {
      const h1 = canvasElement.querySelector<HTMLElement>(
        ".emr-section--doc-title > h1",
      );
      if (!h1) throw new Error("no doc-title heading");
      return h1;
    });
    title.click();
    // It never gains a collapsed state.
    await new Promise((r) => setTimeout(r, 50));
    expect(title.parentElement?.getAttribute("data-collapsed")).toBeNull();
  },
};

/** The mermaid "view source" button opens the source modal. */
export const MermaidSource: Story = {
  play: async ({ canvasElement }) => {
    const btn = await waitFor(
      () => {
        const b = canvasElement.querySelector<HTMLElement>(
          ".emr-mermaid-source-btn",
        );
        if (!b) throw new Error("no button yet");
        return b;
      },
      { timeout: 15000 },
    );
    btn.click();
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-mermaid-modal-overlay"),
      ).toBeTruthy(),
    );
    // Closing the modal clears the source state.
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-mermaid-modal-overlay"),
      ).toBeNull(),
    );
  },
};

/**
 * Diagrams follow the reader's mode: flipping the host theme to dark redraws the
 * Mermaid SVG with Mermaid's dark palette (it bakes colours in at render time,
 * so a re-draw — not just CSS — is required).
 */
export const MermaidThemeSwap: Story = {
  play: async ({ canvasElement }) => {
    // The diagram first hydrates in the default (light) theme.
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(
            '.emr-mermaid[data-mermaid-theme="default"]',
          ),
        ).toBeTruthy(),
      { timeout: 15000 },
    );
    // Flip the host mode; the ArticleView observer re-hydrates every diagram in
    // the dark palette.
    document.documentElement.setAttribute("data-emr-theme", "dark");
    try {
      await waitFor(
        () =>
          expect(
            canvasElement.querySelectorAll(
              '.emr-mermaid[data-mermaid-theme="dark"]',
            ).length,
          ).toBeGreaterThan(0),
        { timeout: 15000 },
      );
    } finally {
      document.documentElement.removeAttribute("data-emr-theme");
    }
  },
};

/** Selecting text shows the bubble; clicking it reports the anchor. */
export const SelectionBubble: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const para = await waitFor(() => {
      const ps = canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p");
      const p = ps[ps.length - 1];
      if (!p || !(p.firstChild instanceof Text) || p.firstChild.length < 8)
        throw new Error("no selectable paragraph");
      return p;
    });
    const textNode = para.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const addBtn = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    // A mousedown inside the bubble must NOT dismiss it.
    addBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn.click();
    await expect(args.onSelection).toHaveBeenCalled();
    // A mousedown outside clears any bubble.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    // A mouseup with no selection collapses the bubble (anchor === null).
    window.getSelection()!.removeAllRanges();
    para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  },
};

/**
 * Selecting inside a removed (deleted-diff) section must NOT offer the comment
 * bubble — that text isn't part of the document, so the anchor would orphan.
 */
export const SelectionInDeletedRegion: Story = {
  args: {
    diff: [
      {
        startLine: 5,
        endLine: 5,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "The old approach used a separate reviewer tool.",
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const body = await waitFor(() => {
      const b = canvasElement.querySelector<HTMLElement>(
        ".emr-diff-deleted-body",
      );
      if (!b || (b.textContent?.length ?? 0) < 12)
        throw new Error("no deleted body yet");
      return b;
    });
    // Reveal the removed lines (as a user would), then select inside them.
    canvasElement.querySelector<HTMLElement>(".emr-diff-deleted-chip")!.click();
    const textNode = document
      .createTreeWalker(body, NodeFilter.SHOW_TEXT)
      .nextNode() as Text;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 16);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    canvasElement
      .querySelector<HTMLElement>(".emr-rendered")!
      .dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    // No bubble, and no selection reported to the host.
    expect(canvasElement.querySelector(".emr-selection-bubble")).toBeNull();
    await expect(args.onSelection).not.toHaveBeenCalled();
  },
};

/** A section persisted as collapsed renders collapsed on first mount. */
export const PreCollapsed: Story = {
  args: { storageKey: "story-precollapsed.md" },
  decorators: [
    (Story) => {
      // Use a nested (non-title) section — the title section can't collapse.
      sessionStorage.setItem(
        `emr.section.story-precollapsed.md.${SECTION_IDS[1]}`,
        "1",
      );
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-section[data-collapsed='true']"),
      ).toBeTruthy(),
    );
  },
};

/** Read-only mode suppresses the selection bubble. */
export const ReadOnly: Story = {
  args: { readOnly: true, draftAnchor: null, diff: undefined },
  play: async ({ canvasElement }) => {
    const para = await waitFor(() => {
      const p = canvasElement.querySelector<HTMLElement>(".emr-rendered p");
      if (!p) throw new Error("no paragraph");
      return p;
    });
    para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await expect(
      canvasElement.querySelector(".emr-selection-bubble"),
    ).toBeNull();
  },
};
