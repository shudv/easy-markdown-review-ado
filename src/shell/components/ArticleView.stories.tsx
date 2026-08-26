import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fireEvent, fn, waitFor, within } from "storybook/test";

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

const OVERLAPPING_THREADS: CommentThread[] = [
  {
    id: "overlap-outer",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "rendered preview right here",
      prefix: "comment on the ",
      suffix: " in the page",
    },
    comments: [],
  },
  {
    id: "overlap-inner",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "preview right",
      prefix: "rendered ",
      suffix: " here",
    },
    comments: [],
  },
];

const PARTIAL_OVERLAPPING_THREADS: CommentThread[] = [
  {
    id: "partial-leading",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "rendered preview right",
      prefix: "comment on the ",
      suffix: " here",
    },
    comments: [],
  },
  {
    id: "partial-trailing",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "preview right here",
      prefix: "rendered ",
      suffix: " in the page",
    },
    comments: [],
  },
];

const EXACT_OVERLAPPING_THREADS: CommentThread[] = [
  {
    id: "exact-first",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "rendered preview",
      prefix: "comment on the ",
      suffix: " right here",
    },
    comments: [],
  },
  {
    id: "exact-second",
    filePath: "/doc.md",
    status: "active",
    anchor: {
      exact: "rendered preview",
      prefix: "comment on the ",
      suffix: " right here",
    },
    comments: [],
  },
];

function OverlappingAnchorArticle(
  props: React.ComponentProps<typeof ArticleView>,
): React.ReactElement {
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  );
  const [currentSource, setCurrentSource] = React.useState<string>();
  return (
    <>
      <button type="button" onClick={() => setCurrentSource(SOURCE)}>
        Rewrap article
      </button>
      <button type="button" onClick={() => setActiveThreadId(null)}>
        Clear active thread
      </button>
      <div style={{ width: 260 }}>
        <ArticleView
          {...props}
          activeThreadId={activeThreadId}
          currentSource={currentSource}
          onHighlightClick={(threadId) => {
            props.onHighlightClick(threadId);
            setActiveThreadId(threadId);
          }}
        />
      </div>
    </>
  );
}

/** Overlapping comments share one underline and cycle on repeated clicks. */
export const OverlappingAnchors: Story = {
  args: {
    threads: OVERLAPPING_THREADS,
    activeThreadId: null,
    draftAnchor: null,
    diff: [],
  },
  render: (args) => <OverlappingAnchorArticle {...args} />,
  play: async ({ args, canvasElement }) => {
    const outer = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(
        '[data-thread-id="overlap-outer"]',
      );
      if (!element) throw new Error("outer overlap anchor missing");
      return element;
    });
    const inner = outer.querySelector<HTMLElement>(
      '[data-thread-id="overlap-inner"]',
    )!;
    await expect(inner).toBeTruthy();
    await expect(outer.getAttribute("role")).toBe("button");
    await expect(outer.tabIndex).toBe(0);
    await expect(inner.hasAttribute("role")).toBe(false);
    await expect(inner.tabIndex).toBe(-1);
    const innerTextRange = document.createRange();
    innerTextRange.selectNodeContents(inner);
    const innerTextRect = innerTextRange.getBoundingClientRect();
    const underlineHit = document.elementFromPoint(
      innerTextRect.left + innerTextRect.width / 2,
      innerTextRect.bottom + 2,
    );
    await expect(
      underlineHit?.closest<HTMLElement>(".emr-highlight")?.dataset.threadId,
    ).toBe("overlap-inner");
    await expect(getComputedStyle(outer).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
    await expect(getComputedStyle(outer).textDecorationLine).toContain(
      "underline",
    );
    await expect(getComputedStyle(outer).textDecorationStyle).toBe("dotted");
    const decorationAtScale = (scale: number) => {
      canvasElement.style.setProperty("--emr-reader-scale", String(scale));
      const style = getComputedStyle(outer);
      return {
        thickness: Number.parseFloat(style.textDecorationThickness),
        offset: Number.parseFloat(style.textUnderlineOffset),
      };
    };
    await expect(decorationAtScale(0.5)).toEqual({ thickness: 2.5, offset: 3 });
    await expect(decorationAtScale(1).thickness).toBeCloseTo(3.48, 3);
    await expect(decorationAtScale(1).offset).toBeCloseTo(3.9875, 3);
    await expect(decorationAtScale(1.5)).toEqual({ thickness: 5, offset: 5 });
    canvasElement.style.setProperty("--emr-reader-scale", "1");
    await expect(getComputedStyle(inner).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
    await expect(getComputedStyle(inner).textDecorationLine).toBe("none");

    inner.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await expect(inner.classList.contains("is-hover")).toBe(true);
    await expect(getComputedStyle(inner).textDecorationStyle).toBe("solid");
    await expect(getComputedStyle(outer).textDecorationLine).toBe("none");

    inner.click();
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "overlap-inner",
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(
          '[data-thread-id="overlap-inner"].is-active',
        ),
      ).toBeTruthy(),
    );
    await expect(getComputedStyle(outer).textDecorationLine).toBe("none");
    const selectedInner = canvasElement.querySelector<HTMLElement>(
      '[data-thread-id="overlap-inner"]',
    )!;
    const selectedThicknessAtScale = (scale: number) => {
      canvasElement.style.setProperty("--emr-reader-scale", String(scale));
      return Number.parseFloat(
        getComputedStyle(selectedInner).textDecorationThickness,
      );
    };
    await expect(selectedThicknessAtScale(0.5)).toBe(3);
    await expect(selectedThicknessAtScale(1)).toBeCloseTo(3.9875, 3);
    await expect(selectedThicknessAtScale(1.5)).toBe(5);
    canvasElement.style.setProperty("--emr-reader-scale", "1");
    await expect(getComputedStyle(selectedInner).textDecorationStyle).toBe(
      "solid",
    );
    const selectedStyle = getComputedStyle(selectedInner);
    const selectedAnimation = selectedStyle.animationName;
    await expect(selectedAnimation).toBe("emr-anchor-land");
    await expect(selectedStyle.boxShadow).not.toBe("none");
    await expect(selectedStyle.boxDecorationBreak).toBe("clone");
    await expect(getComputedStyle(selectedInner, "::after").content).toBe(
      "none",
    );

    outer.focus();
    await expect(document.activeElement).toBe(outer);
    within(canvasElement)
      .getByRole("button", { name: "Rewrap article" })
      .click();
    const rewrappedInner = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(
        '[data-thread-id="overlap-inner"].is-active',
      );
      if (!element || element === selectedInner) {
        throw new Error("active overlap not replaced after rewrap");
      }
      return element;
    });
    await expect(rewrappedInner.classList.contains("is-landing")).toBe(false);
    await expect(getComputedStyle(rewrappedInner).animationName).toBe("none");
    const rewrappedOuter = rewrappedInner.closest<HTMLElement>(
      '[data-thread-id="overlap-outer"]',
    )!;
    await expect(document.activeElement).toBe(rewrappedOuter);
    const outerBeforeLanding = rewrappedOuter;
    const outerRectBeforeLanding = outerBeforeLanding.getBoundingClientRect();

    rewrappedInner.click();
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "overlap-outer",
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(
          '[data-thread-id="overlap-outer"].is-landing',
        ),
      ).toBeTruthy(),
    );
    const selectedOuter = canvasElement.querySelector<HTMLElement>(
      '[data-thread-id="overlap-outer"].is-active',
    )!;
    const outerTextRange = document.createRange();
    outerTextRange.selectNodeContents(selectedOuter);
    await expect(outerTextRange.getClientRects().length).toBeGreaterThan(1);
    await expect(selectedOuter.getBoundingClientRect().width).toBeCloseTo(
      outerRectBeforeLanding.width,
      3,
    );
    await expect(selectedOuter.getBoundingClientRect().height).toBeCloseTo(
      outerRectBeforeLanding.height,
      3,
    );
    await expect(getComputedStyle(selectedOuter).textDecorationLine).toContain(
      "underline",
    );
  },
};

/** Partially overlapping comments decorate split fragments as one active range. */
export const PartialOverlappingAnchors: Story = {
  args: {
    threads: PARTIAL_OVERLAPPING_THREADS,
    activeThreadId: null,
    draftAnchor: null,
    diff: [],
  },
  render: (args) => <OverlappingAnchorArticle {...args} />,
  play: async ({ args, canvasElement }) => {
    const leading = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(
        '[data-thread-id="partial-leading"]',
      );
      if (!element) throw new Error("leading partial anchor missing");
      return element;
    });
    const trailing = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        '[data-thread-id="partial-trailing"]',
      ),
    );
    await expect(trailing).toHaveLength(2);
    const overlapFragment = trailing.find((element) =>
      leading.contains(element),
    )!;
    const trailingOnlyFragment = trailing.find(
      (element) => !leading.contains(element),
    )!;
    await expect(overlapFragment).toBeTruthy();
    await expect(trailingOnlyFragment).toBeTruthy();
    await expect(leading.getAttribute("role")).toBe("button");
    await expect(overlapFragment.hasAttribute("role")).toBe(false);
    await expect(trailingOnlyFragment.hasAttribute("role")).toBe(false);
    await expect(
      canvasElement.querySelectorAll('.emr-highlight[role="button"]'),
    ).toHaveLength(1);

    trailingOnlyFragment.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    );
    await expect(
      trailing.every((element) => element.classList.contains("is-hover")),
    ).toBe(true);
    await expect(getComputedStyle(overlapFragment).textDecorationStyle).toBe(
      "solid",
    );

    overlapFragment.click();
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "partial-trailing",
    );
    await waitFor(() =>
      expect(
        trailing.every((element) => element.classList.contains("is-active")),
      ).toBe(true),
    );
    await expect(getComputedStyle(leading).textDecorationLine).toBe("none");

    trailingOnlyFragment.click();
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "partial-trailing",
    );

    overlapFragment.click();
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "partial-leading",
    );
    await waitFor(() =>
      expect(leading.classList.contains("is-active")).toBe(true),
    );
    await expect(getComputedStyle(leading).textDecorationLine).toContain(
      "underline",
    );
  },
};

/** Exact overlaps remain individually reachable without doubled decoration. */
export const ExactOverlappingAnchors: Story = {
  args: {
    threads: EXACT_OVERLAPPING_THREADS,
    activeThreadId: null,
    draftAnchor: null,
    diff: [],
  },
  render: (args) => <OverlappingAnchorArticle {...args} />,
  play: async ({ args, canvasElement }) => {
    const first = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(
        '[data-thread-id="exact-first"]',
      );
      if (!element) throw new Error("first exact anchor missing");
      return element;
    });
    const second = first.querySelector<HTMLElement>(
      '[data-thread-id="exact-second"]',
    )!;
    await expect(second).toBeTruthy();
    await expect(getComputedStyle(first).textDecorationLine).toContain(
      "underline",
    );
    await expect(getComputedStyle(second).textDecorationLine).toBe("none");

    await expect(first.getAttribute("role")).toBe("button");
    await expect(first.tabIndex).toBe(0);
    await expect(second.hasAttribute("role")).toBe(false);
    const article = canvasElement.querySelector<HTMLElement>(".emr-rendered")!;
    await expect(
      article.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    ).toBe(true);
    const sectionToggle = canvasElement.querySelector<HTMLButtonElement>(
      ".emr-section-toggle",
    )!;
    await expect(
      sectionToggle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      ),
    ).toBe(true);
    await expect(
      article.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      ),
    ).toBe(true);
    first.focus();
    await expect(document.activeElement).toBe(first);
    await expect(getComputedStyle(first).outlineWidth).toBe("2px");
    await expect(
      Number.parseFloat(getComputedStyle(first).textDecorationThickness),
    ).toBeCloseTo(3.9875, 3);
    const initialSpace = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    await expect(first.dispatchEvent(initialSpace)).toBe(false);
    const initialSpaceUp = new KeyboardEvent("keyup", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    await expect(first.dispatchEvent(initialSpaceUp)).toBe(false);
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "exact-second",
    );
    await waitFor(() =>
      expect(second.classList.contains("is-active")).toBe(true),
    );
    within(canvasElement)
      .getByRole("button", { name: "Clear active thread" })
      .click();
    await waitFor(() =>
      expect(second.classList.contains("is-active")).toBe(false),
    );
    first.focus();
    const initialEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await expect(first.dispatchEvent(initialEnter)).toBe(false);
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "exact-second",
    );
    await waitFor(() =>
      expect(second.classList.contains("is-active")).toBe(true),
    );
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await expect(first.dispatchEvent(enter)).toBe(false);
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith("exact-first");
    await waitFor(() =>
      expect(first.classList.contains("is-active")).toBe(true),
    );
    await expect(getComputedStyle(first).textDecorationLine).toContain(
      "underline",
    );

    const space = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    await expect(first.dispatchEvent(space)).toBe(false);
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith("exact-first");
    const spaceUp = new KeyboardEvent("keyup", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    await expect(first.dispatchEvent(spaceUp)).toBe(false);
    await expect(args.onHighlightClick).toHaveBeenLastCalledWith(
      "exact-second",
    );
    await waitFor(() =>
      expect(second.classList.contains("is-active")).toBe(true),
    );
    await expect(getComputedStyle(first).textDecorationLine).toBe("none");
    fireEvent.pointerOut(article, { relatedTarget: document.body });
    await expect(
      canvasElement.querySelector(".emr-highlight.is-hover"),
    ).toBeNull();
  },
};

/** Implicit file anchors report layout positions without decorating prose. */
export const ImplicitAnchors: Story = {
  args: {
    threads: [
      {
        id: "t-implicit",
        filePath: "/doc.md",
        status: "active",
        anchor: {
          exact: "",
          prefix: "",
          suffix: "",
          line: 1,
          endLine: 1,
          column: 1,
          endColumn: 1,
          implicit: true,
        },
        comments: [],
      },
    ],
    activeThreadId: null,
    draftAnchor: {
      exact: "",
      prefix: "",
      suffix: "",
      line: 1,
      endLine: 1,
      column: 1,
      endColumn: 1,
      implicit: true,
    },
    diff: [],
  },
  play: async ({ args, canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelectorAll(".emr-implicit-anchor").length,
      ).toBe(2),
    );
    await expect(canvasElement.querySelector(".emr-highlight")).toBeNull();
    await expect(args.onAnchorsResolved).toHaveBeenCalled();
  },
};

/** Empty rendered content still gives an implicit comment a top-of-file marker. */
export const ImplicitAnchorEmptyDocument: Story = {
  args: {
    pristineHtml: "",
    threads: [
      {
        id: "t-implicit-empty",
        filePath: "/empty.md",
        status: "active",
        anchor: {
          exact: "",
          prefix: "",
          suffix: "",
          line: 1,
          implicit: true,
        },
        comments: [],
      },
    ],
    activeThreadId: null,
    draftAnchor: null,
    diff: [],
  },
  play: async ({ args, canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-implicit-anchor")).toBeTruthy(),
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

/** Only the section chevron collapses; heading text remains selectable. */
export const CollapseSection: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-section h2")).toBeTruthy(),
    );
    const heading =
      canvasElement.querySelector<HTMLElement>(".emr-section > h2")!;
    const toggle = heading.querySelector<HTMLButtonElement>(
      ".emr-section-toggle",
    )!;
    heading.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heading.parentElement?.getAttribute("data-collapsed")).toBeNull();
    toggle.click();
    await waitFor(() =>
      expect(heading.parentElement?.getAttribute("data-collapsed")).toBe(
        "true",
      ),
    );
    expect(toggle.getAttribute("aria-label")).toBe("Expand section");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    await waitFor(() =>
      expect(heading.parentElement?.getAttribute("data-collapsed")).toBeNull(),
    );
    expect(toggle.getAttribute("aria-label")).toBe("Collapse section");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
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
    expect(title.querySelector(".emr-section-toggle")).toBeNull();
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
