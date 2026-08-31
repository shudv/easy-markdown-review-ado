import { describe, it, expect, beforeEach } from "vitest";
import { renderMarkdownSync } from "../src/markdown/render";
import {
  decorateDiffRanges,
  DIFF_BLOCK_CLASS,
  DIFF_DELETED_MARKER_CLASS,
  DIFF_INLINE_CLASS,
  DIFF_IMAGE_CLASS,
  DIFF_CELL_CLASS,
  DIFF_CELL_INLINE_CLASS,
  DIFF_CELL_ADDED_CLASS,
  DIFF_CELL_METADATA_CLASS,
  DIFF_CELL_REMOVED_CLASS,
  DIFF_FORMAT_CLASS,
  DIFF_METADATA_CLASS,
  DIFF_SOURCE_ONLY_CLASS,
  DIFF_TOOLTIP_CLASS,
  alignTableColumns,
  alignTableCells,
  reconstructOriginalBlock,
  selectionTouchesDeletedDiff,
  splitTableRow,
} from "../src/markdown/diffDecorations";
import {
  WORD_ADDED_CLASS,
  WORD_REMOVED_CLASS,
} from "../src/markdown/wordDiffDom";
import type { DiffRange } from "../src/types";

// Systematic coverage of diff highlighting across the full range of Markdown
// constructs — headings at every level, paragraphs, ordered/unordered/nested
// lists, tables (single cell / column / row / header), code blocks,
// blockquotes, and formatting-only changes. Renders REAL Markdown through the
// production pipeline (source-line stamped), applies synthetic diff ranges,
// and asserts the exact elements decorate.
//
// NOTE ON GRANULARITY: ADO's diff is LINE-based (a table row is one source
// line), but we recover per-CELL granularity by diffing the original row's
// source against the live cells: a changed cell is marked on its own, and its
// change is shown as an inline word diff INSIDE the cell (green added / struck
// red removed), falling back to a flat cell wash when the words can't be safely
// reconstructed. These tests pin that behaviour.

function render(md: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-body emr-rendered";
  root.innerHTML = renderMarkdownSync(md);
  return root;
}

function decorate(
  root: HTMLElement,
  ranges: DiffRange[],
  originalSource?: string,
  currentSource?: string,
) {
  return decorateDiffRanges(root, ranges, {
    renderInline: renderMarkdownSync,
    originalSource,
    currentSource,
  });
}

/** Text of all added / removed inline word marks under an element. */
function words(el: Element) {
  return {
    added: Array.from(el.querySelectorAll(`.${WORD_ADDED_CLASS}`))
      .map((n) => n.textContent)
      .join(" "),
    removed: Array.from(el.querySelectorAll(`.${WORD_REMOVED_CLASS}`))
      .map((n) => n.textContent)
      .join(" "),
  };
}

function expectPreciseAmber(element: HTMLElement, label: string): void {
  expect(element.classList.contains(DIFF_TOOLTIP_CLASS)).toBe(true);
  expect(element.dataset.diffTooltip).toBe(label);
  expect(element.dataset.diffAmberMode).toBe("explained");
  expect(element.getAttribute("aria-description")).toBe(label);
  expect(element.hasAttribute("title")).toBe(false);
  expect(element.tabIndex).toBe(0);
  expect(
    element.closest(".emr-rendered")?.querySelector(".emr-diff-before-trigger"),
  ).toBeNull();
}

function expectComparisonAmber(root: HTMLElement): void {
  expect(root.querySelector(".emr-diff-before-trigger")).not.toBeNull();
  expect(root.querySelector(`.${DIFF_TOOLTIP_CLASS}`)).toBeNull();
  expect(
    root.querySelector('[data-diff-amber-mode="comparison"]'),
  ).not.toBeNull();
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Headings h1–h6
// ---------------------------------------------------------------------------
describe("headings", () => {
  const cases: Array<[string, string, string, string]> = [
    ["h1", "# Getting Started Guide", "# Getting Started", "Guide"],
    ["h2", "## Configuration Settings", "## Configuration Options", "Settings"],
    ["h3", "### Retry Behaviour Details", "### Retry Behaviour", "Details"],
    ["h4", "#### Edge Case Notes", "#### Edge Notes", "Case"],
    ["h5", "##### Minor Caveat Here", "##### Minor Caveat", "Here"],
    ["h6", "###### Footnote Updated", "###### Footnote", "Updated"],
  ];
  for (const [tag, modified, original, addedWord] of cases) {
    it(`inline word-diffs an edited ${tag}`, () => {
      const root = render(modified);
      const res = decorate(root, [
        { startLine: 1, endLine: 1, kind: "modified", originalText: original },
      ]);
      expect(res.inlined).toBe(1);
      const h = root.querySelector<HTMLElement>(tag)!;
      expect(h.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
      expect(words(h).added).toContain(addedWord);
      // The `#` fence never leaks into a word mark.
      expect(words(h).added).not.toContain("#");
    });
  }

  it("washes a wholly-added heading green", () => {
    const root = render(["## Brand New Section", "", "Body text."].join("\n"));
    const res = decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }]);
    expect(res.decorated).toBe(1);
    const h = root.querySelector<HTMLElement>("h2")!;
    expect(h.classList.contains("emr-diff-block--added")).toBe(true);
    expect(h.classList.contains(DIFF_INLINE_CLASS)).toBe(false);
  });

  it("marks only heading text for a heading-level-only change", () => {
    const root = render("### Approval workflow");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "## Approval workflow",
      },
    ]);
    expect(res.inlined).toBe(1);
    const heading = root.querySelector<HTMLElement>("h3")!;
    expect(heading.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    const mark = heading.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!;
    expect(mark.textContent).toBe("Approval workflow");
    expectPreciseAmber(
      mark,
      "Block changed from heading level 2 to heading level 3",
    );
  });
});

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------
describe("paragraphs", () => {
  it("inline word-diffs a small edit", () => {
    const root = render(["# Doc", "", "The quick brown fox jumps."].join("\n"));
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "The quick red fox jumps.",
      },
    ]);
    expect(res.inlined).toBe(1);
    const p = root.querySelector<HTMLElement>(".emr-diff-block--modified")!;
    expect(words(p).added).toContain("brown");
    expect(words(p).removed).toContain("red");
  });

  it("falls back to the wash for a wholesale rewrite", () => {
    const root = render(
      ["# Doc", "", "Completely different content about widgets now."].join(
        "\n",
      ),
    );
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "Nothing in common at all here.",
      },
    ]);
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
  });

  it("offers Show before for a wholesale rewrite", () => {
    const current = "Completely different content about widgets now.";
    const original = "Nothing in common at all here.";
    const root = render(current);
    decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalStartLine: 1,
          originalEndLine: 1,
          originalText: original,
        },
      ],
      original,
    );
    expectComparisonAmber(root);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;
    expect(trigger.textContent).toBe("Before");
    expect(trigger.getAttribute("aria-label")).toBe("Show previous version");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    trigger.click();
    expect(root.querySelector(".emr-diff-before-panel p")?.textContent).toBe(
      original,
    );
  });

  it("reconstructs a hard-wrapped old paragraph for precise inline diff", () => {
    const original = [
      "The incident commander records the current impact and the affected",
      "regions before choosing the next mitigation step.",
    ].join("\n");
    const current = [
      "The incident commander records the current impact and all affected",
      "regions before choosing the next mitigation step.",
    ].join("\n");
    const root = render(current);
    const res = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalStartLine: 1,
          originalEndLine: 1,
          originalText:
            "The incident commander records the current impact and the affected",
        },
      ],
      original,
    );
    expect(res.inlined).toBe(1);
    const paragraph = root.querySelector("p")!;
    expect(words(paragraph).removed).toContain("the");
    expect(words(paragraph).added).toContain("all");
    expect(root.querySelector(".emr-diff-before-control")).toBeNull();
  });

  it("reconstructs multiple hunks inside one paragraph", () => {
    const original = [
      "Alpha old wording remains on the first line and continues",
      "through a stable middle line for reviewers",
      "before the old ending closes the paragraph.",
    ].join("\n");
    const current = [
      "Alpha new wording remains on the first line and continues",
      "through a stable middle line for reviewers",
      "before the new ending closes the paragraph.",
    ].join("\n");
    const root = render(current);
    const res = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalStartLine: 1,
          originalEndLine: 1,
          originalText:
            "Alpha old wording remains on the first line and continues",
        },
        {
          startLine: 3,
          endLine: 3,
          kind: "modified",
          originalStartLine: 3,
          originalEndLine: 3,
          originalText: "before the old ending closes the paragraph.",
        },
      ],
      original,
    );
    expect(res.inlined).toBe(1);
    expect(
      words(root.querySelector(`p.${DIFF_INLINE_CLASS}`)!).removed,
    ).toContain("old old");
  });

  it("reconstructs adjacent blocks from one equal-length hunk", () => {
    const original = ["## Legacy heading", "Legacy body remains useful."].join(
      "\n",
    );
    const current = ["## Current heading", "Current body remains useful."].join(
      "\n",
    );
    const root = render(current);
    const res = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 2,
          kind: "modified",
          originalStartLine: 1,
          originalEndLine: 2,
          originalText: original,
        },
      ],
      original,
    );
    expect(res.inlined).toBe(2);
    expect(words(root.querySelector("h2")!).removed).toContain("Legacy");
    expect(words(root.querySelector("p")!).removed).toContain("Legacy");
  });

  it("washes an added paragraph green", () => {
    const root = render(
      ["# Doc", "", "First para.", "", "Second added para."].join("\n"),
    );
    const res = decorate(root, [{ startLine: 5, endLine: 5, kind: "added" }]);
    expect(res.decorated).toBe(1);
    const ps = root.querySelectorAll("p");
    expect(ps[0]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(ps[1]!.classList.contains("emr-diff-block--added")).toBe(true);
  });

  it("inserts a marker for a deleted paragraph", () => {
    const root = render(["# Doc", "", "Kept para."].join("\n"));
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "Old removed para.\n",
      },
    ]);
    expect(res.markers).toBe(1);
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).not.toBeNull();
  });

  it("marks only newly bold text amber", () => {
    const root = render(["This is **bold** now."].join("\n"));
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "This is bold now.",
      },
    ]);
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(1);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
    const paragraph = root.querySelector<HTMLElement>(
      "p.emr-diff-block--modified",
    )!;
    expect(paragraph.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(paragraph.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(paragraph.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    const mark = paragraph.querySelector(`.${DIFF_FORMAT_CLASS}`)!;
    expect(mark.textContent).toBe("bold");
    expect(mark.parentElement?.tagName).toBe("STRONG");
    expectPreciseAmber(mark as HTMLElement, "Bold formatting added");
  });

  it("marks only text whose bold formatting was removed", () => {
    const root = render("The release owner confirms the window.");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "The **release owner** confirms the window.",
      },
    ]);
    expect(res.inlined).toBe(1);
    const mark = root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!;
    expect(mark.textContent).toBe("release owner");
    expectPreciseAmber(mark, "Bold formatting removed");
    expect(root.querySelector("strong")).toBeNull();
  });

  it("marks a formatting type switch once", () => {
    const root = render("Use *regional rollout* for this release.");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Use **regional rollout** for this release.",
      },
    ]);
    const marks = root.querySelectorAll(`.${DIFF_FORMAT_CLASS}`);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("regional rollout");
    expect(marks[0]?.parentElement?.tagName).toBe("EM");
    expectPreciseAmber(
      marks[0] as HTMLElement,
      "Formatting changed from bold to italic",
    );
  });

  it("keeps separated formatting changes granular and clears them cleanly", () => {
    const root = render("**Alpha** remains separate from `beta`.");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Alpha remains separate from beta.",
      },
    ]);
    const marks = Array.from(
      root.querySelectorAll<HTMLElement>(`.${DIFF_FORMAT_CLASS}`),
    );
    expect(marks.map((mark) => mark.textContent)).toEqual(["Alpha", "beta"]);
    expect(marks.map((mark) => mark.dataset.diffTooltip)).toEqual([
      "Bold formatting added",
      "Inline code formatting added",
    ]);
    decorate(root, []);
    expect(root.querySelector(`.${DIFF_FORMAT_CLASS}`)).toBeNull();
    expect(root.querySelector("strong")?.textContent).toBe("Alpha");
    expect(root.querySelector("code")?.textContent).toBe("beta");
  });

  it("shows a shared target-change indicator for an ordinary prose link", () => {
    const root = render(
      "Read the [incident guide](https://example.com/guide-v2) before responding.",
    );
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          "Read the [incident guide](https://example.com/guide-v1) before responding.",
      },
    ]);
    expect(res.inlined).toBe(1);
    const paragraph = root.querySelector<HTMLElement>(
      "p.emr-diff-block--modified",
    )!;
    expect(paragraph.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    const visibleContent = paragraph.cloneNode(true) as HTMLElement;
    visibleContent
      .querySelectorAll(`.${DIFF_METADATA_CLASS}`)
      .forEach((el) => el.remove());
    expect(visibleContent.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(visibleContent.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
    const indicator = paragraph.querySelector(`.${DIFF_METADATA_CLASS}`)!;
    expect(
      indicator.querySelectorAll(".emr-diff-metadata-target-diff"),
    ).toHaveLength(1);
    expect(
      indicator.querySelector(".emr-diff-metadata-row--before"),
    ).toBeNull();
    expect(indicator.querySelector(".emr-diff-metadata-row--after")).toBeNull();
    expect(words(indicator).removed).toContain("v1");
    expect(words(indicator).added).toContain("v2");
  });

  it("shows label words and target metadata together for a prose link", () => {
    const root = render(
      "Read the [response guide](https://example.com/guide-v2) before responding.",
    );
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          "Read the [legacy guide](https://example.com/guide-v1) before responding.",
      },
    ]);
    expect(res.inlined).toBe(1);
    const paragraph = root.querySelector("p")!;
    expect(words(paragraph).removed).toContain("legacy");
    expect(words(paragraph).added).toContain("response");
    expect(paragraph.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
  });

  it("warns when a prose link moves to a different host", () => {
    const root = render(
      "Open the [support guide](https://support.fabrikam.test/guide).",
    );
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          "Open the [support guide](https://docs.contoso.test/guide).",
      },
    ]);
    const indicator = root.querySelector<HTMLElement>(
      `.${DIFF_METADATA_CLASS}`,
    )!;
    expect(indicator.classList.contains("is-warning")).toBe(true);
    expect(indicator.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Show link hostname change",
    );
    expect(indicator.querySelector("button")?.textContent).toBe("");
  });

  it("combines a cross-host link target change with added trailing prose", () => {
    const linkLabel = "`docs/TelemetryAnalytics/README.md`";
    const current =
      `The authoritative directory layout and file conventions are documented in [${linkLabel}]` +
      "(https://o365exchange.visualstudio.com/O365%20Core/_git/BlackstoneRA?path=/docs/TelemetryAnalytics/README.md)" +
      " — now hosted in the shared repository.";
    const root = render(current);
    const result = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          `The authoritative directory layout and file conventions are documented in [${linkLabel}]` +
          "(../docs/TelemetryAnalytics/README.md).",
      },
    ]);

    expect(result.inlined).toBe(1);
    const paragraph = root.querySelector<HTMLElement>("p")!;
    expect(words(paragraph).added).toContain(
      "now hosted in the shared repository",
    );
    const indicator = paragraph.querySelector<HTMLElement>(
      `.${DIFF_METADATA_CLASS}`,
    )!;
    expect(indicator.classList.contains("is-warning")).toBe(true);
    expect(indicator.previousElementSibling?.textContent).toContain(
      "docs/TelemetryAnalytics/README.md",
    );
    expect(indicator.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Show link hostname change",
    );
    expect(
      indicator.querySelector(".emr-diff-metadata-target-diff")?.textContent,
    ).toContain("TelemetryAnalytics/README.md");
    expect(words(indicator).removed).toContain("..");
    expect(words(indicator).added).toContain("o365exchange.visualstudio.com");
    expect(paragraph.querySelector(".emr-diff-before-trigger")).toBeNull();
  });

  it("changes one link target while leaving a sibling link stable", () => {
    const root = render(
      "[Changed](https://example.com/v2) and [Stable](https://example.com/stable)",
    );
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          "[Changed](https://example.com/v1) and [Stable](https://example.com/stable)",
      },
    ]);
    expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
  });

  it("clears metadata indicators on re-decorate", () => {
    const root = render("[Guide](https://example.com/v2)");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "[Guide](https://example.com/v1)",
      },
    ]);
    expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
    decorate(root, []);
    expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
  });

  it("marks only text that becomes a link", () => {
    const root = render("Read the [guide](https://example.com/guide).");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Read the guide.",
      },
    ]);
    expect(res.inlined).toBe(1);
    const paragraph = root.querySelector<HTMLElement>(
      "p.emr-diff-block--modified",
    )!;
    expect(paragraph.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(paragraph.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(paragraph.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    const mark = paragraph.querySelector(`.${DIFF_FORMAT_CLASS}`)!;
    expect(mark.textContent).toBe("guide");
    expect(mark.parentElement?.tagName).toBe("A");
    expectPreciseAmber(
      mark as HTMLElement,
      "Link added: https://example.com/guide",
    );
  });

  it("suppresses a native link title while the custom tooltip is active", () => {
    const root = render(
      'Read the [guide](https://example.com/guide "Native link title").',
    );
    const link = root.querySelector<HTMLAnchorElement>("a")!;
    expect(link.title).toBe("Native link title");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Read the guide.",
      },
    ]);
    expect(link.hasAttribute("title")).toBe(false);
    expectPreciseAmber(
      link.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Link added: https://example.com/guide",
    );
    decorate(root, []);
    expect(link.title).toBe("Native link title");
  });

  it("suppresses one native title across multiple rich link text nodes", () => {
    const root = render(
      'Read [**Alpha** and *beta*](https://example.com/rich "Rich title").',
    );
    const link = root.querySelector<HTMLAnchorElement>("a")!;
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Read Alpha and beta.",
      },
    ]);
    expect(link.hasAttribute("title")).toBe(false);
    expect(
      link.querySelectorAll(`.${DIFF_TOOLTIP_CLASS}`).length,
    ).toBeGreaterThan(1);
    decorate(root, []);
    expect(link.title).toBe("Rich title");
  });

  it("includes a removed link destination", () => {
    const root = render("Read the guide.");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Read the [guide](https://example.com/legacy).",
      },
    ]);
    expectPreciseAmber(
      root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Link removed: https://example.com/legacy",
    );
  });

  it("bounds long link destinations in the callout", () => {
    const destination = `https://example.com/${"deep-path/".repeat(16)}guide`;
    const root = render(`Read the [guide](${destination}).`);
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Read the guide.",
      },
    ]);
    const label = root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!
      .dataset.diffTooltip!;
    expect(label).toMatch(/^Link added: https:\/\/example\.com\//);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(108);
    expect(root.querySelector<HTMLAnchorElement>("a")!.href).toContain(
      "deep-path/deep-path",
    );
  });

  it("describes nested formatting and link wrapping together", () => {
    const root = render(
      "Read the [**deployment guide**](https://example.com/deploy).",
    );
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Read the deployment guide.",
      },
    ]);
    expectPreciseAmber(
      root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Bold and link to https://example.com/deploy formatting added",
    );
  });

  it("word-diffs across a block-TYPE change (heading → paragraph)", () => {
    // The line was a heading (`## …`) and is now a paragraph. The block is a
    // <p> but the original renders to an <h2>, so the tag-match lookup misses
    // and we fall back to the whole rendered original's text.
    const root = render(["Now this is plain body text here."].join("\n"));
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "## Now this is heading text here",
      },
    ]);
    expect(res.decorated).toBe(1);
    const p = root.querySelector<HTMLElement>("p")!;
    expect(p.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(words(p).added).toContain("plain");
    expect(p.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
  });

  it("describes an equal-text quote-to-paragraph transition", () => {
    const root = render("Definition");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "> Definition",
      },
    ]);
    expectPreciseAmber(
      root.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Block changed from quote to paragraph",
    );
  });

  it("shows Before for a low-confidence block-type rewrite", () => {
    const root = render("Entirely new operational body text.");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "## Legacy approval workflow",
      },
    ]);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    trigger.click();
    expect(root.querySelector(".emr-diff-before-content h2")?.textContent).toBe(
      "Legacy approval workflow",
    );
  });
});

// ---------------------------------------------------------------------------
// Unordered lists
// ---------------------------------------------------------------------------
describe("unordered lists", () => {
  it("greens only the added item, not the whole list", () => {
    const root = render(["- alpha", "- beta added", "- gamma"].join("\n"));
    const res = decorate(root, [{ startLine: 2, endLine: 2, kind: "added" }]);
    expect(res.decorated).toBe(1);
    expect(root.querySelector("ul")?.classList.contains(DIFF_BLOCK_CLASS)).toBe(
      false,
    );
    const items = Array.from(root.querySelectorAll("li"));
    const marked = items.filter((li) =>
      li.classList.contains(DIFF_BLOCK_CLASS),
    );
    expect(marked.length).toBe(1);
    expect(marked[0]!.textContent).toContain("beta");
  });

  it("inline word-diffs an edited item", () => {
    const root = render(["- alpha", "- beta changed", "- gamma"].join("\n"));
    const res = decorate(root, [
      { startLine: 2, endLine: 2, kind: "modified", originalText: "- beta" },
    ]);
    expect(res.inlined).toBe(1);
    const li = root.querySelectorAll("li")[1]!;
    expect(li.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(words(li).added).toContain("changed");
    expect(li.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
  });

  it("inserts a marker for a deleted item", () => {
    const root = render(["- alpha", "- gamma"].join("\n"));
    const res = decorate(root, [
      {
        startLine: 2,
        endLine: 2,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "- beta\n",
      },
    ]);
    expect(res.markers).toBe(1);
  });

  it("marks only the list marker when an item changes list type", () => {
    const root = render("1. beta");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "- beta",
      },
    ]);
    expect(res.inlined).toBe(1);
    const item = root.querySelector("li")!;
    expect(item.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(item.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(item.classList.contains("emr-diff-list-marker-change")).toBe(true);
    expectPreciseAmber(item, "List marker changed from bulleted to numbered");
    expect(item.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    expect(item.querySelector(".emr-diff-before-trigger")).toBeNull();
    decorate(root, []);
    expect(item.classList.contains("emr-diff-list-marker-change")).toBe(false);
    expect(item.title).toBe("");
  });

  it("marks ONLY the changed nested child, not the parent item", () => {
    const root = render(
      [
        "- parent one",
        "  - child a",
        "  - child b changed",
        "- parent two",
      ].join("\n"),
    );
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "  - child b",
      },
    ]);
    expect(res.decorated).toBe(1);
    // Select by source line, not text: parent one's textContent CONTAINS the
    // nested "child b" text, so a text match would wrongly find the parent.
    const parentOne = root.querySelector<HTMLElement>(
      'li[data-source-line="1"]',
    )!;
    const childB = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;
    expect(childB.textContent).toContain("child b");
    expect(parentOne.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(childB.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
  });

  it("marks list-item formatting without inventing marker semantics", () => {
    const root = render("- **beta** remains stable");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "- beta remains stable",
      },
    ]);
    expect(res.inlined).toBe(1);
    const item = root.querySelector<HTMLElement>("li")!;
    expect(item.classList.contains("emr-diff-list-marker-change")).toBe(false);
    expectPreciseAmber(
      item.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Bold formatting added",
    );
  });
});

// ---------------------------------------------------------------------------
// Ordered (numbered) lists
// ---------------------------------------------------------------------------
describe("ordered lists", () => {
  it("greens only the added numbered item", () => {
    const root = render(["1. one", "2. two added", "3. three"].join("\n"));
    const res = decorate(root, [{ startLine: 2, endLine: 2, kind: "added" }]);
    expect(res.decorated).toBe(1);
    expect(root.querySelector("ol")?.classList.contains(DIFF_BLOCK_CLASS)).toBe(
      false,
    );
    const marked = Array.from(root.querySelectorAll("li")).filter((li) =>
      li.classList.contains(DIFF_BLOCK_CLASS),
    );
    expect(marked.length).toBe(1);
    expect(marked[0]!.textContent).toContain("two");
  });

  it("inline word-diffs an edited numbered item", () => {
    const root = render(
      ["1. one", "2. second step complete", "3. three"].join("\n"),
    );
    const res = decorate(root, [
      {
        startLine: 2,
        endLine: 2,
        kind: "modified",
        originalText: "2. second step pending",
      },
    ]);
    expect(res.inlined).toBe(1);
    const li = root.querySelectorAll("li")[1]!;
    expect(words(li).added).toContain("complete");
    expect(words(li).removed).toContain("pending");
  });

  // Regression: a hard-wrapped (multi-line) numbered item whose whole span was
  // edited must still decorate. This is the exact shape from the field bug
  // report — a design-review checklist item reworded across two source lines
  // ("…To private ip APIs, or public grab them?" → "…To the v3 or v4 OData API,
  // the Planner Graph API, or both? How will clients handle them?"). The item
  // renders as ONE <li> spanning both source lines; the diff must land on it
  // rather than silently no-op (which would make the file look unchanged).
  it("inline word-diffs a hard-wrapped numbered item spanning two source lines", () => {
    const root = render(
      [
        "The following is a checklist of topics to consider when finalizing a design.",
        "",
        "1. Security — what are the implications on AuthN or AuthZ (who has access to",
        "   do what with data?)",
        "2. Does this work make breaking API changes? To the v3 or v4 OData API, the",
        "   Planner Graph API, or both? How will clients handle them?",
        "3. Have you considered risks around code upgrade (schema changes, N-1)?",
      ].join("\n"),
    );
    // Item 2 spans source lines 5–6; both lines were part of the edit.
    const res = decorate(root, [
      {
        startLine: 5,
        endLine: 6,
        kind: "modified",
        originalText:
          "2. Does this work make breaking API changes? To private ip APIs, or\n   public grab them?",
      },
    ]);
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(1);
    const item2 = root.querySelector<HTMLElement>('li[data-source-line="5"]')!;
    expect(item2.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(item2.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(words(item2).added).toContain("v4");
    expect(words(item2).removed).toContain("private");
    // The unchanged neighbours must NOT light up.
    expect(
      root
        .querySelector('li[data-source-line="3"]')!
        .classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
  });

  // When only ONE line of a hard-wrapped item changed, `originalText` is a
  // fragment that doesn't cover the block's span, so the inline word-diff is
  // (correctly) skipped — but the item must STILL decorate with a wash so the
  // reviewer sees that something in it changed. Guards against the "no diff at
  // all" symptom for the partial-edit case.
  it("washes a hard-wrapped numbered item when only its second line changed", () => {
    const root = render(
      [
        "1. First item stays exactly the same across the edit here.",
        "2. Does this work make breaking API changes to the v3 or v4 OData",
        "   API, the Planner Graph API, or both?",
        "3. Third item stays exactly the same too.",
      ].join("\n"),
    );
    // Only the continuation line (3) changed; the item spans lines 2–3.
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "   API only, or neither of them?",
      },
    ]);
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
    const item2 = root.querySelector<HTMLElement>('li[data-source-line="2"]')!;
    expect(item2.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(item2.classList.contains(DIFF_INLINE_CLASS)).toBe(false);
  });

  // A LOOSE list item (its list has blank lines, so each item's prose is
  // wrapped in a <p>) must inline-diff INSIDE that <p>. Regression: the diff
  // used to run against the whole <li>, whose flattened text includes the
  // whitespace text nodes sitting between the <li> and its <p>; those got
  // word-diffed and wrapped in empty <ins>/<del> marks that rendered as blank
  // lines above and below the item. The fix targets the inner <p>, so no marks
  // escape to the item level and the item's legitimate spacing is untouched.
  it("inline word-diffs a LOOSE list item without stray blank-line marks", () => {
    const root = render(
      [
        "1. First item stays exactly the same across this edit here.",
        "",
        "2. Does this work make breaking API changes? To the v3 or v4 OData API?",
        "",
        "3. Third item stays exactly the same too across the edit.",
      ].join("\n"),
    );
    const li2 = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;
    // Precondition: the item really is loose (prose wrapped in a <p>).
    expect(li2.firstElementChild?.tagName).toBe("P");

    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "2. Does this work make breaking API changes? To private 1p APIs?",
      },
    ]);
    expect(res.inlined).toBe(1);
    expect(li2.classList.contains(DIFF_INLINE_CLASS)).toBe(true);

    // The marks land INSIDE the <p>…
    const p = li2.querySelector<HTMLElement>(":scope > p")!;
    expect(p.querySelector(`.${WORD_ADDED_CLASS}`)).not.toBeNull();
    expect(p.querySelector(`.${WORD_REMOVED_CLASS}`)).not.toBeNull();
    // …and NONE escape to the item level as the blank-line-inducing marks.
    expect(li2.querySelectorAll(":scope > ins, :scope > del").length).toBe(0);
    expect(words(li2).added).toContain("v4");
    expect(words(li2).removed).toContain("private");
  });
});

// ---------------------------------------------------------------------------
// Nested + mixed lists (ul>ul, ol>ul, ul>ol, deep) — the parent item must not
// light up when only a nested descendant changed.
// ---------------------------------------------------------------------------
describe("nested and mixed lists", () => {
  it("ul > ul: marks only the changed grandchild-level item", () => {
    const root = render(
      ["- a", "  - b", "    - c updated deeply", "- d"].join("\n"),
    );
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "    - c pending deeply",
      },
    ]);
    expect(res.decorated).toBe(1);
    const changed = root.querySelector<HTMLElement>(
      'li[data-source-line="3"]',
    )!;
    const parentB = root.querySelector<HTMLElement>(
      'li[data-source-line="2"]',
    )!;
    const parentA = root.querySelector<HTMLElement>(
      'li[data-source-line="1"]',
    )!;
    expect(changed.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(parentB.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(parentA.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("ol > ul: marks only the nested unordered child", () => {
    const root = render(
      ["1. first", "   - sub a", "   - sub b added", "2. second"].join("\n"),
    );
    const res = decorate(root, [{ startLine: 3, endLine: 3, kind: "added" }]);
    expect(res.decorated).toBe(1);
    expect(
      root
        .querySelector<HTMLElement>('li[data-source-line="1"]')!
        .classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
    expect(
      root
        .querySelector<HTMLElement>('li[data-source-line="3"]')!
        .classList.contains("emr-diff-block--added"),
    ).toBe(true);
  });

  it("ul > ol: marks only the nested ordered child", () => {
    const root = render(
      ["- alpha", "  1. one", "  2. two changed", "- beta"].join("\n"),
    );
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "  2. two pending",
      },
    ]);
    expect(res.decorated).toBe(1);
    expect(
      root
        .querySelector<HTMLElement>('li[data-source-line="1"]')!
        .classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
    const nested = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;
    expect(nested.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task lists (GFM checkboxes)
// ---------------------------------------------------------------------------
describe("task lists", () => {
  it("marks a ticked-off task item without disturbing the others", () => {
    const root = render(
      ["- [ ] write tests", "- [ ] ship it", "- [ ] celebrate"].join("\n"),
    );
    // First item checked off: `[ ]` → `[x]`.
    const res = decorate(root, [
      { startLine: 1, endLine: 1, kind: "modified" },
    ]);
    expect(res.decorated).toBe(1);
    const items = Array.from(root.querySelectorAll("li"));
    expect(items[0]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(items[1]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(items[2]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    // The checkbox input survives inside the highlighted item.
    expect(items[0]!.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it("greens an added task item", () => {
    const root = render(
      ["- [ ] alpha", "- [ ] beta added", "- [ ] gamma"].join("\n"),
    );
    const res = decorate(root, [{ startLine: 2, endLine: 2, kind: "added" }]);
    expect(res.decorated).toBe(1);
    expect(
      root
        .querySelectorAll("li")[1]!
        .classList.contains("emr-diff-block--added"),
    ).toBe(true);
  });
  it("marks only the checkbox when checklist state changes", () => {
    const root = render("- [x] Run tests");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "- [ ] Run tests",
      },
    ]);
    expect(res.inlined).toBe(1);
    const item = root.querySelector("li")!;
    expect(item.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(item.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(item.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    const checkbox = item.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(checkbox.classList.contains("emr-diff-task-state-change")).toBe(
      true,
    );
    expect(checkbox.hasAttribute("title")).toBe(false);
    expectPreciseAmber(
      checkbox.closest<HTMLElement>(".emr-diff-task-tooltip-anchor")!,
      "Checklist item changed from unchecked to checked",
    );
    decorate(root, []);
    expect(checkbox.classList.contains("emr-diff-task-state-change")).toBe(
      false,
    );
    expect(checkbox.hasAttribute("title")).toBe(false);
    expect(item.querySelector(".emr-diff-task-tooltip-anchor")).toBeNull();
  });

  it("describes a checked checklist item becoming unchecked", () => {
    const root = render("- [ ] Confirm release");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "- [x] Confirm release",
      },
    ]);
    expectPreciseAmber(
      root.querySelector<HTMLElement>(".emr-diff-task-tooltip-anchor")!,
      "Checklist item changed from checked to unchecked",
    );
  });

  it("combines marker and checklist-state changes into one item callout", () => {
    const root = render("- [x] Confirm release");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "1. [ ] Confirm release",
      },
    ]);
    const item = root.querySelector<HTMLElement>("li")!;
    expectPreciseAmber(
      item,
      "List item changed: marker numbered to bulleted; checklist item unchecked to checked",
    );
    expect(item.querySelector(".emr-diff-task-tooltip-anchor")).toBeNull();
    expect(
      item
        .querySelector('input[type="checkbox"]')
        ?.classList.contains("emr-diff-task-state-change"),
    ).toBe(true);
  });

  it("offers compact Before for a low-confidence list-item rewrite", () => {
    const root = render("- Escalate immediately to the regional owner.");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "- Archive the weekly report after documentation review.",
      },
    ]);
    const item = root.querySelector<HTMLElement>("li")!;
    const trigger = item.querySelector<HTMLButtonElement>(
      ":scope > .emr-diff-before-control .emr-diff-before-trigger",
    )!;
    trigger.click();
    expect(trigger.textContent).toBe("Hide");
    expect(trigger.getAttribute("aria-label")).toBe("Hide previous version");
    expect(
      item.querySelector(".emr-diff-before-content")?.textContent,
    ).toContain("Archive the weekly report");
    trigger.click();
    expect(trigger.textContent).toBe("Before");
    expect(trigger.getAttribute("aria-label")).toBe("Show previous version");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("reconstructOriginalBlock", () => {
  it("returns null without an overlapping modified range", () => {
    expect(reconstructOriginalBlock(3, 3, [], "one\ntwo\nthree")).toBeNull();
  });

  it("rejects invalid inferred original coordinates", () => {
    expect(
      reconstructOriginalBlock(
        1,
        2,
        [
          {
            start: 2,
            end: 2,
            kind: "modified",
            originalStart: 1,
            originalEnd: 1,
            originalText: "old",
          },
        ],
        "old",
      ),
    ).toBeNull();
  });

  it("rejects a mismatched hunk extending beyond the block", () => {
    expect(
      reconstructOriginalBlock(
        2,
        2,
        [
          {
            start: 1,
            end: 3,
            kind: "modified",
            originalStart: 1,
            originalEnd: 2,
            originalText: "old one\nold two",
          },
        ],
        "old one\nold two",
      ),
    ).toBeNull();
  });
});

describe("source-only changes", () => {
  it("shows a reference-link definition target change with raw Before source", () => {
    const original = [
      "[ch16]: http://localhost:3000/ch16-00-concurrency.html",
      "",
      "Continue with [Chapter 16][ch16].",
    ].join("\n");
    const current = [
      "[ch16]: ch16-00-concurrency.html",
      "",
      "Continue with [Chapter 16][ch16].",
    ].join("\n");
    const root = render(current);

    const result = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalText:
            "[ch16]: http://localhost:3000/ch16-00-concurrency.html",
        },
      ],
      original,
      current,
    );

    expect(result.decorated).toBe(1);
    const marker = root.querySelector<HTMLElement>(
      `.${DIFF_SOURCE_ONLY_CLASS}`,
    )!;
    expect(
      marker.querySelector(".emr-diff-source-only-current code")?.textContent,
    ).toBe("[ch16]: ch16-00-concurrency.html");
    expect(marker.nextElementSibling?.tagName).toBe("P");
    expect(selectionTouchesDeletedDiff(marker, marker)).toBe(true);
    const trigger = marker.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    expect(trigger.getAttribute("aria-label")).toBe("Show previous source");
    trigger.click();
    expect(
      marker.querySelector(".emr-diff-before-panel code")?.textContent,
    ).toBe("[ch16]: http://localhost:3000/ch16-00-concurrency.html");
    trigger.click();
    expect(trigger.textContent).toBe("Before");
    expect(trigger.getAttribute("aria-label")).toBe("Show previous source");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    decorate(root, []);
    expect(root.querySelector(`.${DIFF_SOURCE_ONLY_CLASS}`)).toBeNull();
  });

  it("shows an added dialect directive that renders no DOM node", () => {
    const current = ["<Feature enabled />", "", "Visible prose."].join("\n");
    const root = render(current);
    decorate(
      root,
      [{ startLine: 1, endLine: 1, kind: "added" }],
      undefined,
      current,
    );

    const marker = root.querySelector<HTMLElement>(
      `.${DIFF_SOURCE_ONLY_CLASS}`,
    )!;
    expect(marker.dataset.diffKind).toBe("added");
    expect(marker.textContent).toContain("<Feature enabled />");
    expect(marker.querySelector(".emr-diff-before-trigger")).toBeNull();
  });

  it("appends a source-only change when the document has no rendered blocks", () => {
    const root = render("<!-- current directive -->");
    const result = decorate(
      root,
      [{ startLine: 1, endLine: 1, kind: "added" }],
      undefined,
      "<!-- current directive -->",
    );
    expect(result.decorated).toBe(1);
    expect(
      root.lastElementChild?.classList.contains(DIFF_SOURCE_ONLY_CLASS),
    ).toBe(true);
  });

  it("does not invent a source strip for a changed blank line", () => {
    const root = render("Visible prose.\n\n");
    const result = decorate(
      root,
      [{ startLine: 2, endLine: 2, kind: "added" }],
      undefined,
      "Visible prose.\n\n",
    );
    expect(result.decorated).toBe(0);
    expect(root.querySelector(`.${DIFF_SOURCE_ONLY_CLASS}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tables — row-level granularity (line-based diff can't isolate a cell)
// ---------------------------------------------------------------------------
describe("tables", () => {
  const table = [
    "| Option | Default |", // 1 (header)
    "| --- | --- |", // 2 (separator)
    "| theme | light |", // 3
    "| retries | 3 |", // 4
    "| timeout | 5000 |", // 5
  ].join("\n");

  it("highlights ONLY the changed cell when a single cell changed", () => {
    const root = render(table);
    // Live row renders `theme | light`; the original was `theme | dark`, so
    // only the second cell (Default) changed.
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | dark |",
      },
    ]);
    expect(res.decorated).toBe(1);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    const row = rows[0]!;
    expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect((row as HTMLElement).dataset.diffCells).toBe("true");
    const cells = Array.from(row.querySelectorAll("td"));
    // First cell (`theme`) unchanged, second cell (`light`→`auto`) marked.
    expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    expect(cells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    // Untouched rows carry no cell marks.
    expect(rows[1]!.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
  });

  it("shows an inline word diff inside a changed multi-word cell", () => {
    const multi = [
      "| Option | Description |",
      "| --- | --- |",
      "| theme | the widget colour scheme |",
    ].join("\n");
    const root = render(multi);
    // Live cell reads "the widget colour scheme"; the original said
    // "...colour palette" — only the last word changed, so the rest of the
    // cell must stay neutral while just that word is marked.
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | the widget colour palette |",
      },
    ]);
    expect(res.decorated).toBe(1);
    const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(cell.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    // The inline modifier drops the flat wash so the word marks read cleanly.
    expect(cell.classList.contains("emr-diff-cell--inline")).toBe(true);
    const w = words(cell);
    expect(w.added).toContain("scheme");
    expect(w.removed).toContain("palette");
    // Unchanged words are left untouched.
    expect(cell.textContent).toContain("colour");
  });

  it("uses a neutral metadata indicator when only a link destination changed", () => {
    const rich = [
      "| Resource | Link | Owner |",
      "| --- | --- | --- |",
      "| Guide | [Open guide](https://example.com/v2) | Platform |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "| Guide | [Open guide](https://example.com/v1) | Platform |",
      },
    ]);
    const cells = Array.from(root.querySelectorAll("tbody td"));
    expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    expect(cells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    expect(cells[1]!.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(true);
    expect(cells[1]!.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/v2",
    );
    const indicator = cells[1]!.querySelector<HTMLElement>(
      `.${DIFF_METADATA_CLASS}`,
    )!;
    const trigger = indicator.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("Show link target change");
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(trigger.textContent).toBe("");
    expect(
      indicator.querySelectorAll(".emr-diff-metadata-target-diff"),
    ).toHaveLength(1);
    expect(
      indicator.querySelector(".emr-diff-metadata-row--before"),
    ).toBeNull();
    expect(indicator.querySelector(".emr-diff-metadata-row--after")).toBeNull();
    expect(words(indicator).removed).toContain("v1");
    expect(words(indicator).added).toContain("v2");
    trigger.click();
    expect(indicator.classList.contains("is-open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger.click();
    expect(indicator.classList.contains("is-open")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(cells[2]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
  });

  it("combines inline label marks with a neutral target-change indicator", () => {
    const rich = [
      "| Resource | Link |",
      "| --- | --- |",
      "| Guide | [Incident response](https://example.com/v2) |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Guide | [Legacy guide](https://example.com/v1) |",
      },
    ]);
    const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(cell.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    expect(cell.classList.contains("emr-diff-cell--inline")).toBe(true);
    expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(true);
    expect(words(cell).removed).toContain("Legacy guide");
    expect(words(cell).added).toContain("Incident response");
    expect(cell.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/v2",
    );
    expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
  });

  it("combines formatting-only and target metadata changes", () => {
    const root = render(
      [
        "| Resource | Link |",
        "| --- | --- |",
        "| Guide | [**Incident guide**](https://example.com/v2) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Guide | [Incident guide](https://example.com/v1) |",
      },
    ]);
    const cell = root.querySelectorAll<HTMLElement>("tbody td")[1]!;
    expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(true);
    expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(true);
    expectPreciseAmber(
      cell.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Bold formatting added",
    );
    expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
  });

  it("warns when a table link moves to a different host", () => {
    const root = render(
      [
        "| Resource | Link |",
        "| --- | --- |",
        "| Guide | [Incident guide](https://support.fabrikam.test/v2) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "| Guide | [Incident guide](https://docs.contoso.test/v1) |",
      },
    ]);
    const indicator = root.querySelector<HTMLElement>(
      `tbody td:nth-child(2) .${DIFF_METADATA_CLASS}`,
    )!;
    expect(indicator.classList.contains("is-warning")).toBe(true);
    expect(indicator.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Show link hostname change",
    );
  });

  it("marks link wrapping inside a cell with its destination", () => {
    const root = render(
      [
        "| Resource | Link |",
        "| --- | --- |",
        "| Guide | [Incident guide](https://example.com/guide) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Guide | Incident guide |",
      },
    ]);
    const cell = root.querySelectorAll<HTMLElement>("tbody td")[1]!;
    expectPreciseAmber(
      cell.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
      "Link added: https://example.com/guide",
    );
  });

  it("changes one table link while leaving a sibling stable", () => {
    const root = render(
      [
        "| Links |",
        "| --- |",
        "| [Changed](https://example.com/v2) and [Stable](https://example.com/stable) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "| [Changed](https://example.com/v1) and [Stable](https://example.com/stable) |",
      },
    ]);
    const cell = root.querySelector<HTMLElement>("tbody td")!;
    expect(cell.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
    expect(cell.querySelectorAll("a")[1]?.getAttribute("href")).toBe(
      "https://example.com/stable",
    );
  });

  it("preserves inline code and emphasis while diffing their text", () => {
    const rich = [
      "| Setting | Required value |",
      "| --- | --- |",
      "| Retry | Set `retry.mode` to **adaptive**. |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Retry | Set `retry.mode` to **legacy**. |",
      },
    ]);
    const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(cell.classList.contains("emr-diff-cell--inline")).toBe(true);
    expect(cell.querySelector("code")?.textContent).toBe("retry.mode");
    expect(cell.querySelector("strong")?.textContent).toContain("adaptive");
    expect(words(cell).removed).toContain("legacy");
    expect(words(cell).added).toContain("adaptive");
  });

  it("handles nested rich markup inside a table link", () => {
    const rich = [
      "| Resource | Link |",
      "| --- | --- |",
      "| Guide | [**Current guide**](https://example.com/v2) |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Guide | [**Legacy guide**](https://example.com/v1) |",
      },
    ]);
    const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(cell.querySelector("a strong")?.textContent).toContain("Current");
    expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
  });

  it("shows image metadata without washing its table cell", () => {
    const root = render(
      [
        "| Resource | Preview |",
        "| --- | --- |",
        "| Diagram | ![Architecture](https://example.com/v2.png) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "| Diagram | ![Architecture](https://example.com/v1.png) |",
      },
    ]);
    const cell = root.querySelectorAll<HTMLElement>("tbody td")[1]!;
    expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(true);
    expect(
      cell.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent,
    ).toContain("v1.png");
    expect(
      cell.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent,
    ).toContain("v2.png");
  });

  it("combines changed text and image metadata inside a cell", () => {
    const root = render(
      [
        "| Preview |",
        "| --- |",
        "| Current ![Architecture](https://example.com/v2.png) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Legacy ![Architecture](https://example.com/v1.png) |",
      },
    ]);
    const cell = root.querySelector<HTMLElement>("tbody td")!;
    expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(true);
    expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(true);
    expect(words(cell).removed).toContain("Legacy");
    expect(words(cell).added).toContain("Current");
    expect(
      cell.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent,
    ).toContain("v1.png");
  });

  it("changes one table image while leaving a sibling stable", () => {
    const root = render(
      [
        "| Previews |",
        "| --- |",
        "| ![Changed](https://example.com/v2.png) ![Stable](https://example.com/stable.png) |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "| ![Changed](https://example.com/v1.png) ![Stable](https://example.com/stable.png) |",
      },
    ]);
    const cell = root.querySelector<HTMLElement>("tbody td")!;
    expect(cell.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
    expect(cell.querySelectorAll("img")[1]?.getAttribute("src")).toBe(
      "https://example.com/stable.png",
    );
  });

  it("keeps amber cell fallback for unsupported equal-text structure", () => {
    const root = render(table);
    const cell = root.querySelector<HTMLElement>("tbody td:nth-child(2)")!;
    const wrapper = document.createElement("span");
    wrapper.title = "custom semantic wrapper";
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    cell.appendChild(wrapper);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | light |",
      },
    ]);
    expect(cell.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(false);
    expect(cell.querySelector(`.${DIFF_FORMAT_CLASS}`)).toBeNull();
    expectPreciseAmber(
      cell,
      "Rendered structure changed from plain text to span",
    );
  });

  it("restores existing tooltip and focus metadata after clearing diffs", () => {
    const root = render(table);
    const cell = root.querySelector<HTMLElement>("tbody td:nth-child(2)")!;
    cell.title = "Existing native detail";
    cell.setAttribute("aria-description", "Existing accessible detail");
    cell.tabIndex = -1;
    const wrapper = document.createElement("span");
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    cell.appendChild(wrapper);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | light |",
      },
    ]);
    expect(cell.hasAttribute("title")).toBe(false);
    expect(cell.getAttribute("aria-description")).toBe(
      "Rendered structure changed from plain text to span",
    );
    expect(cell.tabIndex).toBe(-1);
    decorate(root, []);
    expect(cell.title).toBe("Existing native detail");
    expect(cell.getAttribute("aria-description")).toBe(
      "Existing accessible detail",
    );
    expect(cell.tabIndex).toBe(-1);
  });

  it("describes multiple unsupported rendered structures", () => {
    const root = render(table);
    const cell = root.querySelector<HTMLElement>("tbody td:nth-child(2)")!;
    const wrapper = document.createElement("span");
    while (cell.firstChild) wrapper.appendChild(cell.firstChild);
    wrapper.appendChild(document.createElement("img"));
    cell.appendChild(wrapper);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | light |",
      },
    ]);
    expectPreciseAmber(
      cell,
      "Rendered structure changed from plain text to span and image",
    );
  });

  it("marks only formatting-changed text inside a table cell", () => {
    const rich = [
      "| Resource | Description |",
      "| --- | --- |",
      "| Runbook | **incident guide** |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Runbook | incident guide |",
      },
    ]);
    const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(cell.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(false);
    expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(true);
    expect(cell.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(cell.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
    expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    const mark = cell.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!;
    expect(mark.textContent).toBe("incident guide");
    expectPreciseAmber(mark, "Bold formatting added");
  });

  it("shows text marks without a formatting indicator in a mixed cell edit", () => {
    const rich = [
      "| Setting | Value |",
      "| --- | --- |",
      "| Retry | **adaptive mode** |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Retry | legacy mode |",
      },
    ]);
    const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
    expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(true);
    expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(false);
    expect(words(cell).removed).toContain("legacy");
    expect(words(cell).added).toContain("adaptive");
    expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
  });

  it("diffs long rich prose without losing an escaped pipe", () => {
    const rich = [
      "| Policy | Guidance | Query |",
      "| --- | --- | --- |",
      '| Escalation | Notify after the first failed mitigation attempt and include affected regions in the response log. | `state == "active" \\| state == "waiting"` |',
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          '| Escalation | Notify after the second failed mitigation attempt and include customer impact in the response log. | `state == "active" \\| state == "queued"` |',
      },
    ]);
    const cells = Array.from(root.querySelectorAll("tbody td"));
    expect(cells).toHaveLength(3);
    expect(words(cells[1]!).removed).toContain("second");
    expect(words(cells[1]!).added).toContain("first");
    expect(cells[2]!.querySelector("code")?.textContent).toContain("|");
    expect(words(cells[2]!).removed).toContain("queued");
    expect(words(cells[2]!).added).toContain("waiting");
  });

  it("shows filled and cleared empty cells precisely", () => {
    const rich = [
      "| Service | Escalation |",
      "| --- | --- |",
      "| Checkout | Pager |",
      "| Search | |",
    ].join("\n");
    const root = render(rich);
    decorate(root, [
      {
        startLine: 3,
        endLine: 4,
        kind: "modified",
        originalText: "| Checkout | |\n| Search | Pager |",
      },
    ]);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(words(rows[0]!.children[1]!).added).toContain("Pager");
    expect(words(rows[0]!.children[1]!).removed).toHaveLength(0);
    expect(words(rows[1]!.children[1]!).removed).toContain("Pager");
    expect(words(rows[1]!.children[1]!).added).toHaveLength(0);
  });

  it("shows each edited cell precisely when several cells in a row changed", () => {
    const matrix = [
      "| Option | Default | Owner |",
      "| --- | --- | --- |",
      "| palette | light | Runtime |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | dark | Platform |",
      },
    ]);
    const row = Array.from(root.querySelectorAll("table"))
      .at(-1)!
      .querySelector("tbody tr") as HTMLElement;
    const cells = Array.from(row.querySelectorAll("td"));
    expect(row.dataset.diffCells).toBe("true");
    expect(cells).toHaveLength(3);
    expect(
      cells.every((cell) => cell.classList.contains(DIFF_CELL_CLASS)),
    ).toBe(true);
    expect(words(cells[0]!).removed).toContain("theme");
    expect(words(cells[0]!).added).toContain("palette");
    expect(words(cells[1]!).removed).toContain("dark");
    expect(words(cells[1]!).added).toContain("light");
    expect(words(cells[2]!).removed).toContain("Platform");
    expect(words(cells[2]!).added).toContain("Runtime");
  });

  it("highlights only the changed column across rows", () => {
    const root = render(table);
    // The Default column changed in the theme + retries rows (lines 3-4);
    // the Option column is unchanged in both.
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | dark |",
      },
      {
        startLine: 4,
        endLine: 4,
        kind: "modified",
        originalText: "| retries | 1 |",
      },
    ]);
    expect(res.decorated).toBe(2);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    for (const row of [rows[0]!, rows[1]!]) {
      const cells = Array.from(row.querySelectorAll("td"));
      expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
      expect(cells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    }
    expect(rows[2]!.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
  });

  it("shows an added column green across the header and every row", () => {
    const matrix = [
      "| Option | Cadence | Owner |",
      "| --- | --- | --- |",
      "| theme | On change | Platform |",
      "| retries | Every minute | Runtime |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 1,
        endLine: 4,
        kind: "modified",
        originalText: [
          "| Option | Owner |",
          "| --- | --- |",
          "| theme | Platform |",
          "| retries | Runtime |",
        ].join("\n"),
      },
    ]);
    const rows = Array.from(root.querySelectorAll("tr"));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect((row as HTMLElement).dataset.diffCells).toBe("true");
      const added = row.querySelectorAll(`.${DIFF_CELL_ADDED_CLASS}`);
      expect(added).toHaveLength(1);
      expect(added[0]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    }
    expect(
      rows[0]!.querySelector(`.${DIFF_CELL_ADDED_CLASS}`)?.textContent,
    ).toBe("Cadence");
    expect(
      rows[1]!.querySelector(`.${DIFF_CELL_ADDED_CLASS}`)?.textContent,
    ).toBe("On change");
    expect(
      rows[2]!.querySelector(`.${DIFF_CELL_ADDED_CLASS}`)?.textContent,
    ).toBe("Every minute");
  });

  it("shows a removed column struck red across the header and every row", () => {
    const root = render(
      [
        "| Option | Owner |",
        "| --- | --- |",
        "| theme | Platform |",
        "| retries | Runtime |",
      ].join("\n"),
    );
    decorate(root, [
      {
        startLine: 1,
        endLine: 4,
        kind: "modified",
        originalText: [
          "| Option | Legacy | Owner |",
          "| --- | --- | --- |",
          "| theme | dark | Platform |",
          "| retries | 1 | Runtime |",
        ].join("\n"),
      },
    ]);
    const rows = Array.from(root.querySelectorAll("tr"));
    expect(rows).toHaveLength(3);
    expect(words(rows[0]!).removed).toContain("Legacy");
    expect(words(rows[1]!).removed).toContain("dark");
    expect(words(rows[2]!).removed).toContain("1");
    for (const row of rows) {
      expect(row.querySelectorAll(`.${DIFF_CELL_REMOVED_CLASS}`)).toHaveLength(
        1,
      );
    }
  });

  it("shows an inserted cell as added when an unchanged cell anchors the row", () => {
    const root = render(table);
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme |",
      },
    ]);
    expect(res.decorated).toBe(1);
    const row = Array.from(root.querySelectorAll("table"))
      .at(-1)!
      .querySelector("tbody tr") as HTMLElement;
    expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(row.dataset.diffCells).toBe("true");
    const cells = Array.from(row.querySelectorAll("td"));
    expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    expect(cells[1]!.classList.contains(DIFF_CELL_ADDED_CLASS)).toBe(true);
    expect(cells[1]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(words(cells[1]!).removed).toHaveLength(0);
  });

  it("inserts a struck-red synthetic cell where a cell was removed", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | legacy | light |",
      },
    ]);
    const row = root.querySelector("tbody tr") as HTMLElement;
    expect(row.dataset.diffCells).toBe("true");
    const cells = Array.from(row.querySelectorAll("td"));
    expect(cells).toHaveLength(3);
    expect(cells[1]!.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
    expect(words(cells[1]!).removed).toContain("legacy");
    expect(cells[0]!.textContent).toBe("theme");
    expect(cells[2]!.textContent).toBe("light");
  });

  it("appends a struck-red synthetic cell when the final cell was removed", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | light | legacy |",
      },
    ]);
    const cells = Array.from(root.querySelectorAll("tbody tr:first-child td"));
    expect(cells).toHaveLength(3);
    expect(cells[2]!.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
    expect(words(cells[2]!).removed).toContain("legacy");
  });

  it("shows an inserted middle cell and a paired trailing edit precisely", () => {
    const matrix = [
      "| Change shape | Cadence | Owner |",
      "| --- | --- | --- |",
      "| Columns restructured | On material change | Communications lead |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| Columns restructured | Response team |",
      },
    ]);
    const cells = Array.from(root.querySelectorAll("tbody td"));
    expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    expect(cells[1]!.classList.contains(DIFF_CELL_ADDED_CLASS)).toBe(true);
    expect(cells[1]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(words(cells[1]!).removed).toHaveLength(0);
    expect(words(cells[2]!).removed).toContain("Response team");
    expect(words(cells[2]!).added).toContain("Communications lead");
  });

  it("falls back to amber when unequal rows have no unchanged anchor", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| palette | dark | inherited |",
      },
    ]);
    const row = Array.from(root.querySelectorAll("table"))
      .at(-1)!
      .querySelector("tbody tr") as HTMLElement;
    expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(row.dataset.diffCells).toBeUndefined();
    expect(row.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
    expectComparisonAmber(root);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;
    const comparison = root.querySelector<HTMLElement>(
      ".emr-diff-table-comparison",
    )!;
    expect(Array.from(comparison.children)).toEqual(
      expect.arrayContaining([
        trigger.parentElement,
        panel,
        row.closest("table"),
      ]),
    );
    expect(trigger.textContent).toBe("Before");
    expect(trigger.getAttribute("aria-label")).toBe("Show previous version");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
    trigger.click();
    expect(trigger.textContent).toBe("Hide");
    expect(trigger.getAttribute("aria-label")).toBe("Hide previous version");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".emr-diff-before-label")?.textContent).toBe(
      "Before",
    );
    expect(
      Array.from(panel.querySelectorAll("tbody td")).map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["palette", "dark", "inherited"]);
    const beforeText = panel.querySelector("td")!.firstChild!;
    expect(selectionTouchesDeletedDiff(beforeText, beforeText)).toBe(true);
    trigger.click();
    expect(panel.hidden).toBe(true);
    decorate(root, []);
    expect(root.querySelector(".emr-diff-before-control")).toBeNull();
    expect(root.querySelector(".emr-diff-before-panel")).toBeNull();
    expect(root.querySelector(".emr-diff-table-comparison")).toBeNull();
    expect(root.querySelector("table")).not.toBeNull();
  });

  it("falls back to the whole row when no original text is available", () => {
    const root = render(table);
    // Without originalText we can't tell which cell changed → whole row.
    const res = decorate(root, [
      { startLine: 3, endLine: 3, kind: "modified" },
    ]);
    expect(res.decorated).toBe(1);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    const marked = rows.filter((tr) => tr.classList.contains(DIFF_BLOCK_CLASS));
    expect(marked.length).toBe(1);
    expect(marked[0]!.textContent).toContain("theme");
    const markedRow = marked[0] as HTMLElement;
    expect(markedRow.dataset.diffCells).toBeUndefined();
    expectPreciseAmber(
      markedRow,
      "Previous content unavailable; exact comparison cannot be shown",
    );
    expect(rows[1]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(rows[2]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("shows non-table original text in Before without inventing cells", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "Original row unavailable as structured Markdown",
      },
    ]);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    trigger.click();
    const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;
    expect(panel.querySelector("table")).toBeNull();
    expect(panel.textContent).toContain(
      "Original row unavailable as structured Markdown",
    );
  });

  it("clears per-cell highlights on re-decorate", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | dark |",
      },
    ]);
    expect(root.querySelector(`.${DIFF_CELL_CLASS}`)).not.toBeNull();
    // Re-decorating with no ranges must wipe the earlier cell marks.
    decorate(root, []);
    expect(root.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
    const row = root.querySelector("tbody tr") as HTMLElement;
    expect(row.dataset.diffCells).toBeUndefined();
  });

  it("removes synthetic deleted cells on re-decorate", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | legacy | light |",
      },
    ]);
    expect(root.querySelector(`.${DIFF_CELL_REMOVED_CLASS}`)).not.toBeNull();
    decorate(root, []);
    expect(root.querySelector(`.${DIFF_CELL_REMOVED_CLASS}`)).toBeNull();
    expect(root.querySelectorAll("tbody tr:first-child td")).toHaveLength(2);
  });

  it("highlights each affected row when a COLUMN changed across rows", () => {
    const root = render(table);
    // The Default column changed in the theme + retries rows (lines 3-4).
    const res = decorate(root, [
      { startLine: 3, endLine: 4, kind: "modified" },
    ]);
    expect(res.decorated).toBe(2);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows[0]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(rows[1]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(rows[2]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("highlights the header row when the header changed", () => {
    const root = render(table);
    const res = decorate(root, [
      { startLine: 1, endLine: 1, kind: "modified" },
    ]);
    expect(res.decorated).toBe(1);
    const headRow = root.querySelector("thead tr")!;
    expect(headRow.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
  });

  it("greens an added row", () => {
    const root = render(table);
    const res = decorate(root, [{ startLine: 5, endLine: 5, kind: "added" }]);
    expect(res.decorated).toBe(1);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows[2]!.classList.contains("emr-diff-block--added")).toBe(true);
  });

  it("inserts a visible removed row directly in the table", () => {
    const root = render(table);
    const res = decorate(root, [
      {
        startLine: 5,
        endLine: 5,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "| extra | 9 |\n",
      },
    ]);
    expect(res.markers).toBe(1);
    const removedRow = root.querySelector<HTMLTableRowElement>(
      `tr.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    expect(removedRow.classList.contains("emr-diff-deleted-table-row")).toBe(
      true,
    );
    expect(removedRow.hidden).toBe(false);
    expect(removedRow.getAttribute("aria-label")).toBe("Removed table row");
    const cells = Array.from(removedRow.querySelectorAll("td"));
    expect(cells.map((cell) => cell.textContent)).toEqual(["extra", "9"]);
    expect(removedRow.querySelector(".emr-diff-deleted-chip")).toBeNull();
  });

  it("falls back to the normal removal card when deleted cells do not fit the table", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 4,
        endLine: 4,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "| too | many | cells |\n",
      },
    ]);
    const marker = root.querySelector<HTMLElement>(
      `.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    expect(marker.tagName).toBe("DIV");
    expect(
      marker.querySelector(".emr-diff-deleted-body")?.textContent,
    ).toContain("too | many | cells");
  });

  it("shows all deleted rows when linesDeleted is absent", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 4,
        endLine: 4,
        kind: "deleted-marker",
        deletedContent: "| legacy | 1 |\n| obsolete | 0 |\n",
      },
    ]);
    const removedRows = root.querySelectorAll(
      "tbody tr.emr-diff-deleted-table-row",
    );
    expect(removedRows).toHaveLength(2);
  });

  it("appends a deleted row after the final current table row", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 6,
        endLine: 6,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "| legacy | disabled |\n",
      },
    ]);
    const bodyRows = Array.from(root.querySelectorAll("tbody tr"));
    expect(
      bodyRows.at(-1)?.classList.contains("emr-diff-deleted-table-row"),
    ).toBe(true);
    expect(bodyRows.at(-1)?.classList.contains(DIFF_DELETED_MARKER_CLASS)).toBe(
      true,
    );
  });

  it("reveals multiple adjacent deleted rows in the same table grid", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 4,
        endLine: 4,
        kind: "deleted-marker",
        linesDeleted: 2,
        deletedContent: "| legacy | 1 |\n| obsolete | 0 |\n",
      },
    ]);
    const removedRows = Array.from(
      root.querySelectorAll<HTMLTableRowElement>(
        "tbody tr.emr-diff-deleted-table-row",
      ),
    );
    expect(removedRows).toHaveLength(2);
    expect(
      removedRows.map((row) =>
        Array.from(row.cells).map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["legacy", "1"],
      ["obsolete", "0"],
    ]);
    expect(removedRows.every((row) => !row.hidden)).toBe(true);
    expect(
      removedRows.every(
        (row) => row.querySelector(".emr-diff-deleted-chip") == null,
      ),
    ).toBe(true);
  });

  it("does not treat ordinary removed prose containing a pipe as a table", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "Choose A | B before continuing.\n",
      },
    ]);
    const body = root.querySelector<HTMLElement>(".emr-diff-deleted-body")!;
    expect(body.querySelector("table")).toBeNull();
    expect(body.querySelector("p")?.textContent).toBe(
      "Choose A | B before continuing.",
    );
  });

  it("does not attach fully-piped prose to a non-adjacent earlier table", () => {
    const root = render(
      [table, "", "After the table.", "", "Next section."].join("\n"),
    );
    decorate(root, [
      {
        startLine: 9,
        endLine: 9,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "| legacy | note |\n",
      },
    ]);
    expect(root.querySelector("tbody .emr-diff-deleted-table-row")).toBeNull();
    const marker = root.querySelector<HTMLElement>(
      `div.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    expect(
      marker.querySelector(".emr-diff-deleted-body")?.textContent,
    ).toContain("legacy");
  });

  it("does NOT word-diff a table row (row source isn't reconstructable)", () => {
    const root = render(table);
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | light |",
      },
    ]);
    // Row washed, never inlined.
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
  });

  it("marks only the changed header (TH) cell", () => {
    const root = render(table);
    // Header was `| Choice | Default |`; the first column label changed.
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "| Choice | Default |",
      },
    ]);
    expect(res.decorated).toBe(1);
    const headCells = Array.from(root.querySelectorAll("thead th"));
    expect(headCells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    expect(headCells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
  });

  it("shows a renamed column header as an inline edit", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "| Option | Initial value |",
      },
    ]);
    const cells = Array.from(root.querySelectorAll("thead th"));
    expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    expect(words(cells[1]!).removed).toContain("Initial value");
    expect(words(cells[1]!).added).toContain("Default");
  });

  it("keeps body cells neutral when a header is renamed across the table hunk", () => {
    const matrix = [
      "| Service | Primary owner |",
      "| --- | --- |",
      "| Checkout | Platform |",
      "| Search | Discovery |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 1,
        endLine: 4,
        kind: "modified",
        originalText: [
          "| Service | Response owner |",
          "| --- | --- |",
          "| Checkout | Platform |",
          "| Search | Discovery |",
        ].join("\n"),
      },
    ]);
    expect(words(root.querySelector("thead")!).removed).toContain("Response");
    expect(words(root.querySelector("thead")!).added).toContain("Primary");
    expect(root.querySelector("tbody .emr-diff-cell")).toBeNull();
    expect(root.querySelector(".emr-diff-before-control")).toBeNull();
  });

  it("falls back for repeated headers despite repeated body values", () => {
    const matrix = [
      "| Yes | Inserted | Yes |",
      "| --- | --- | --- |",
      "| Yes | New | Yes |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 1,
        endLine: 3,
        kind: "modified",
        originalText: ["| Yes | Yes |", "| --- | --- |", "| Yes | Yes |"].join(
          "\n",
        ),
      },
    ]);
    expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
    expect(
      root.querySelectorAll("table:last-of-type tr.emr-diff-block--modified"),
    ).toHaveLength(2);
  });

  it("falls back when a stable header surrounds both removed and added headers", () => {
    const matrix = [
      "| Service | Cadence | Owner |",
      "| --- | --- | --- |",
      "| Checkout | Continuous | Platform |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 1,
        endLine: 3,
        kind: "modified",
        originalText: [
          "| Service | Legacy mode |",
          "| --- | --- |",
          "| Checkout | Enabled |",
        ].join("\n"),
      },
    ]);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    trigger.click();
    const before = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;
    expect(before.querySelectorAll("table")).toHaveLength(1);
    expect(before.querySelectorAll("thead th")).toHaveLength(2);
    expect(before.querySelectorAll("tbody td")).toHaveLength(2);
    expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
  });

  it("shows a swapped header order while keeping moved body values neutral", () => {
    const matrix = [
      "| Owner | Cadence |",
      "| --- | --- |",
      "| Platform | Every hour |",
      "| Operations | Every day |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 1,
        endLine: 4,
        kind: "modified",
        originalText: [
          "| Cadence | Owner |",
          "| --- | --- |",
          "| Every hour | Platform |",
          "| Every day | Operations |",
        ].join("\n"),
      },
    ]);
    const rows = Array.from(root.querySelectorAll("tr"));
    expect(rows).toHaveLength(3);
    const headers = Array.from(rows[0]!.querySelectorAll("th"));
    expect(headers.every((cell) => words(cell).added.length > 0)).toBe(true);
    expect(headers.every((cell) => words(cell).removed.length > 0)).toBe(true);
    for (const row of rows.slice(1)) {
      expect(row.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
      expect((row as HTMLElement).dataset.diffCells).toBe("true");
    }
  });

  it("shows a swapped row as removed at its old position and added at its new position", () => {
    const matrix = [
      "| Service | Owner |",
      "| --- | --- |",
      "| Search | Discovery |",
      "| Checkout | Platform |",
      "| Billing | Finance |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "| Checkout | Platform |\n",
      },
      { startLine: 4, endLine: 4, kind: "added", linesAdded: 1 },
    ]);
    const marker = root.querySelector<HTMLTableRowElement>(
      `tr.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    expect(Array.from(marker.cells).map((cell) => cell.textContent)).toEqual([
      "Checkout",
      "Platform",
    ]);
    const added = Array.from(root.querySelectorAll("tbody tr")).find((row) =>
      row.classList.contains("emr-diff-block--added"),
    );
    expect(added?.textContent).toContain("Checkout");
  });

  it("marks an inserted header cell green instead of washing the header row", () => {
    const matrix = [
      "| Option | Cadence | Owner |",
      "| --- | --- | --- |",
      "| theme | On change | Platform |",
    ].join("\n");
    const root = render(matrix);
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "| Option | Owner |",
      },
    ]);
    const cells = Array.from(root.querySelectorAll("thead th"));
    expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    expect(cells[1]!.classList.contains(DIFF_CELL_ADDED_CLASS)).toBe(true);
    expect(cells[1]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(cells[2]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
  });

  it("restores a removed header cell in its original position", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "| Option | Legacy | Default |",
      },
    ]);
    const cells = Array.from(root.querySelectorAll("thead th"));
    expect(cells).toHaveLength(3);
    expect(cells[1]!.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
    expect(words(cells[1]!).removed).toContain("Legacy");
  });
  it("marks nothing (returns whole-row fallback off) when no cell differs", () => {
    const root = render(table);
    // originalText matches the live row exactly, so no rendered cell changed
    // and the line hunk must not leave a phantom amber row wash.
    const res = decorate(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "| theme | light |",
      },
    ]);
    expect(res.decorated).toBe(0);
    const row = Array.from(root.querySelectorAll("table"))
      .at(-1)!
      .querySelector("tbody tr") as HTMLElement;
    expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(row.dataset.diffCells).toBeUndefined();
    expect(row.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
    expect(root.querySelector(".emr-diff-before-control")).toBeNull();
  });

  it("does not insert a removed body row into the table header", () => {
    const root = render(table);
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "| legacy | value |",
      },
    ]);
    expect(root.querySelector("thead .emr-diff-deleted-table-row")).toBeNull();
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).not.toBeNull();
  });
});

describe("splitTableRow", () => {
  it("splits a fully piped row", () => {
    expect(splitTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  it("splits a row without leading/trailing pipes", () => {
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
  });

  it("trims surrounding whitespace before stripping the outer pipes", () => {
    // Leading/trailing spaces would defeat the startsWith/endsWith pipe strip
    // if the row weren't trimmed first.
    expect(splitTableRow("  | a | b |  ")).toEqual(["a", "b"]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });
});

describe("alignTableCells", () => {
  it("handles empty and single-cell rows at the loop boundaries", () => {
    expect(alignTableCells([], [])).toEqual([]);
    expect(alignTableCells([""], [""])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
    ]);
  });

  it("keeps positional edits for equal-length rows", () => {
    expect(alignTableCells(["a", "old"], ["a", "new"])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "modified", originalIndex: 1, currentIndex: 1 },
    ]);
  });

  it("returns null for an unanchored structural rewrite", () => {
    expect(alignTableCells(["a", "b"], ["x", "y", "z"])).toBeNull();
  });

  it("aligns an insertion around unique ordered anchors", () => {
    expect(alignTableCells(["a", "b"], ["a", "new", "b"])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "added", currentIndex: 1 },
      { kind: "equal", originalIndex: 1, currentIndex: 2 },
    ]);
  });

  it("aligns structural edits at both row boundaries", () => {
    expect(alignTableCells(["anchor"], ["new", "anchor"])).toEqual([
      { kind: "added", currentIndex: 0 },
      { kind: "equal", originalIndex: 0, currentIndex: 1 },
    ]);
    expect(alignTableCells(["old", "anchor"], ["anchor"])).toEqual([
      { kind: "removed", originalIndex: 0, currentIndex: 0 },
      { kind: "equal", originalIndex: 1, currentIndex: 0 },
    ]);
    expect(alignTableCells(["anchor"], ["anchor", "new"])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "added", currentIndex: 1 },
    ]);
    expect(alignTableCells(["anchor", "old"], ["anchor"])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "removed", originalIndex: 1, currentIndex: 1 },
    ]);
  });

  it("does not use repeated or empty values as structural anchors", () => {
    expect(alignTableCells(["yes", "yes"], ["yes", "new", "yes"])).toBeNull();
    expect(alignTableCells([""], ["", "new"])).toBeNull();
  });
});

describe("alignTableColumns", () => {
  it("handles empty and duplicate same-width schemas positionally", () => {
    expect(alignTableColumns([], [])).toEqual([]);
    expect(alignTableColumns(["Owner", "Owner"], ["Owner", "Owner"])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "equal", originalIndex: 1, currentIndex: 1 },
    ]);
    expect(alignTableColumns(["", "Owner"], ["", "Owner"])).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "equal", originalIndex: 1, currentIndex: 1 },
    ]);
  });

  it("keeps same-width header renames positional", () => {
    expect(
      alignTableColumns(
        ["Service", "Response owner"],
        ["Service", "Primary owner"],
      ),
    ).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "modified", originalIndex: 1, currentIndex: 1 },
    ]);
  });

  it("maps uniquely named swapped columns by identity", () => {
    expect(
      alignTableColumns(["Cadence", "Owner"], ["Owner", "Cadence"]),
    ).toEqual([
      { kind: "equal", originalIndex: 1, currentIndex: 0 },
      { kind: "equal", originalIndex: 0, currentIndex: 1 },
    ]);
  });

  it("identifies added and removed columns around stable headers", () => {
    expect(
      alignTableColumns(["Legacy", "Service", "Owner"], ["Service", "Owner"]),
    ).toEqual([
      { kind: "removed", originalIndex: 0, currentIndex: 0 },
      { kind: "equal", originalIndex: 1, currentIndex: 0 },
      { kind: "equal", originalIndex: 2, currentIndex: 1 },
    ]);
    expect(
      alignTableColumns(["Service", "Owner"], ["Service", "Cadence", "Owner"]),
    ).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "added", currentIndex: 1 },
      { kind: "equal", originalIndex: 1, currentIndex: 2 },
    ]);
    expect(
      alignTableColumns(["Service", "Legacy", "Owner"], ["Service", "Owner"]),
    ).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "removed", originalIndex: 1, currentIndex: 1 },
      { kind: "equal", originalIndex: 2, currentIndex: 1 },
    ]);
    expect(
      alignTableColumns(["Service", "Owner", "Legacy"], ["Service", "Owner"]),
    ).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "equal", originalIndex: 1, currentIndex: 1 },
      { kind: "removed", originalIndex: 2, currentIndex: 2 },
    ]);
    expect(
      alignTableColumns(
        ["Service", "Legacy", "Owner", "Tier"],
        ["Service", "Owner", "Tier"],
      ),
    ).toEqual([
      { kind: "equal", originalIndex: 0, currentIndex: 0 },
      { kind: "removed", originalIndex: 1, currentIndex: 1 },
      { kind: "equal", originalIndex: 2, currentIndex: 1 },
      { kind: "equal", originalIndex: 3, currentIndex: 2 },
    ]);
  });

  it("rejects unequal schemas with no unique anchor or changes on both sides", () => {
    expect(alignTableColumns(["Yes", "Yes"], ["Yes", "New", "Yes"])).toBeNull();
    expect(
      alignTableColumns(["Service", "Legacy"], ["Service", "Cadence", "Owner"]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------
describe("code blocks", () => {
  it("washes an edited code block when its complete original is unavailable", () => {
    const root = render(["```", "const x = 2;", "```"].join("\n"));
    const res = decorate(root, [
      {
        startLine: 2,
        endLine: 2,
        kind: "modified",
        originalText: "const x = 1;",
      },
    ]);
    expect(res.inlined).toBe(0);
    const pre = root.querySelector<HTMLElement>("pre")!;
    expect(pre.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expectPreciseAmber(
      pre,
      "Previous content unavailable; exact comparison cannot be shown",
    );
  });

  it("inline-diffs a reconstructed one-token code edit", () => {
    const original = ["```js", "const value = 1;", "```"].join("\n");
    const current = ["```js", "const value = 2;", "```"].join("\n");
    const root = render(current);
    decorate(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalStartLine: 2,
          originalEndLine: 2,
          originalText: "const value = 1;",
        },
      ],
      original,
    );
    const pre = root.querySelector<HTMLElement>("pre")!;
    expect(pre.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(words(pre).removed).toContain("1");
    expect(words(pre).added).toContain("2");
    expect(root.querySelector(".emr-diff-before-trigger")).toBeNull();
  });

  it("inline-diffs code from a wider hunk without complete base source", () => {
    const root = render(
      ["```js", "const value = 2;", "```", "Stable."].join("\n"),
    );
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 4,
        kind: "modified",
        originalText: ["```js", "const value = 1;", "```", "Stable."].join(
          "\n",
        ),
      },
    ]);
    expect(res.inlined).toBe(1);
    expect(words(root.querySelector("pre")!).removed).toContain("1");
    expect(words(root.querySelector("pre")!).added).toContain("2");
  });

  it("keeps a wider code hunk amber when original text is absent", () => {
    const root = render(
      ["```js", "const value = 2;", "```", "Stable."].join("\n"),
    );
    const res = decorate(root, [
      { startLine: 1, endLine: 4, kind: "modified" },
    ]);
    expect(res.inlined).toBe(0);
    expect(
      root.querySelector("pre")?.classList.contains("emr-diff-block--modified"),
    ).toBe(true);
    expectPreciseAmber(
      root.querySelector<HTMLElement>("pre")!,
      "Previous content unavailable; exact comparison cannot be shown",
    );
  });

  it("offers Show before for a low-confidence code rewrite", () => {
    const original = [
      "```powershell",
      "Remove-Item legacy.cache -Force",
      "```",
    ].join("\n");
    const current = [
      "```powershell",
      "Invoke-RestMethod $healthEndpoint",
      "```",
    ].join("\n");
    const root = render(current);
    decorate(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalStartLine: 2,
          originalEndLine: 2,
          originalText: "Remove-Item legacy.cache -Force",
        },
      ],
      original,
    );
    expectComparisonAmber(root);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    trigger.click();
    expect(root.querySelector(".emr-diff-before-panel pre")?.textContent).toBe(
      "Remove-Item legacy.cache -Force\n",
    );
  });

  it("inline-diffs multiple reconstructed code lines", () => {
    const original = [
      "```ts",
      "const retries = 3;",
      "const timeout = 15;",
      "```",
    ].join("\n");
    const current = [
      "```ts",
      "const retries = 4;",
      "const timeout = 30;",
      "```",
    ].join("\n");
    const root = render(current);
    const res = decorate(
      root,
      [
        {
          startLine: 2,
          endLine: 3,
          kind: "modified",
          originalStartLine: 2,
          originalEndLine: 3,
          originalText: ["const retries = 3;", "const timeout = 15;"].join(
            "\n",
          ),
        },
      ],
      original,
    );
    expect(res.inlined).toBe(1);
    const pre = root.querySelector<HTMLElement>("pre")!;
    expect(words(pre).removed).toContain("3");
    expect(words(pre).removed).toContain("15");
    expect(words(pre).added).toContain("4");
    expect(words(pre).added).toContain("30");
  });

  it("shows code words and language metadata together", () => {
    const original = ["```bash", "echo deployment old", "```"].join("\n");
    const current = ["```powershell", "echo deployment new", "```"].join("\n");
    const root = render(current);
    const res = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 2,
          kind: "modified",
          originalText: ["```bash", "echo deployment old"].join("\n"),
          originalStartLine: 1,
          originalEndLine: 2,
        },
      ],
      original,
    );
    expect(res.inlined).toBe(1);
    const pre = root.querySelector<HTMLElement>("pre")!;
    expect(words(pre).removed).toContain("old");
    expect(words(pre).added).toContain("new");
    expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
      "Before bash",
    );
    expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
      "After powershell",
    );
  });

  it("keeps Before when language metadata accompanies a code rewrite", () => {
    const original = ["```bash", "rm legacy.cache --force", "```"].join("\n");
    const current = [
      "```powershell",
      "Invoke-RestMethod $healthEndpoint",
      "```",
    ].join("\n");
    const root = render(current);
    const res = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 2,
          kind: "modified",
          originalText: ["```bash", "rm legacy.cache --force"].join("\n"),
          originalStartLine: 1,
          originalEndLine: 2,
        },
      ],
      original,
    );
    expect(res.inlined).toBe(0);
    const pre = root.querySelector<HTMLElement>(
      "pre.emr-diff-block--modified",
    )!;
    expect(pre.classList.contains(DIFF_INLINE_CLASS)).toBe(false);
    const metadata = pre.querySelector(`.${DIFF_METADATA_CLASS}`);
    expect(metadata, pre.outerHTML).not.toBeNull();
    expect(metadata?.textContent).toContain("Before bash");
    expect(root.querySelector(".emr-diff-before-trigger")).not.toBeNull();
  });

  it("greens a wholly-added code block", () => {
    const root = render(["```", "new code", "```"].join("\n"));
    const res = decorate(root, [{ startLine: 1, endLine: 3, kind: "added" }]);
    expect(res.decorated).toBe(1);
    expect(
      root.querySelector("pre")?.classList.contains("emr-diff-block--added"),
    ).toBe(true);
  });

  it("shows a language indicator when code text is unchanged", () => {
    const root = render(["```powershell", "Get-Service", "```"].join("\n"));
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 3,
        kind: "modified",
        originalText: ["```bash", "Get-Service", "```"].join("\n"),
      },
    ]);
    expect(res.inlined).toBe(1);
    const pre = root.querySelector("pre")!;
    expect(pre.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
      "Before bash",
    );
    expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
      "After powershell",
    );
    const trigger = pre.querySelector<HTMLButtonElement>(
      ".emr-diff-metadata-trigger",
    )!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows same-language fence option changes without an identical Before panel", () => {
    const original = [
      '```js [[1, 3, "updateName"], [2, 23, "submitAction"]]',
      '"use client";',
      "```",
    ].join("\n");
    const current = [
      '```js [[1, 3, "updateName"], [2, 25, "submitAction"]]',
      '"use client";',
      "```",
    ].join("\n");
    const root = render(current);
    const result = decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalStartLine: 1,
          originalEndLine: 1,
          originalText: '```js [[1, 3, "updateName"], [2, 23, "submitAction"]]',
        },
      ],
      original,
      current,
    );

    expect(result.inlined).toBe(1);
    const metadata = root.querySelector<HTMLElement>(
      `.${DIFF_METADATA_CLASS}`,
    )!;
    expect(metadata.textContent).toContain(
      'Before [[1, 3, "updateName"], [2, 23, "submitAction"]]',
    );
    expect(metadata.textContent).toContain(
      'After [[1, 3, "updateName"], [2, 25, "submitAction"]]',
    );
    expect(root.querySelector(".emr-diff-before-trigger")).toBeNull();
  });

  it.each([
    {
      name: "adds language and options",
      original: ["```", '"use client";', "```"].join("\n"),
      current: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join(
        "\n",
      ),
      before: "Before plain text; options: none",
      after: 'After js; options: [[1, 3, "updateName"]]',
    },
    {
      name: "removes options while changing language",
      original: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join(
        "\n",
      ),
      current: ["```ts", '"use client";', "```"].join("\n"),
      before: 'Before js; options: [[1, 3, "updateName"]]',
      after: "After ts; options: none",
    },
  ])("$name", ({ original, current, before, after }) => {
    const root = render(current);
    decorate(root, [
      { startLine: 1, endLine: 3, kind: "modified", originalText: original },
    ]);
    const metadata = root.querySelector(`.${DIFF_METADATA_CLASS}`)!;
    expect(metadata.textContent).toContain(before);
    expect(metadata.textContent).toContain(after);
  });

  it.each([
    {
      name: "adds options without changing language",
      original: ["```js", '"use client";', "```"].join("\n"),
      current: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join(
        "\n",
      ),
      before: "Before none",
      after: 'After [[1, 3, "updateName"]]',
    },
    {
      name: "removes options without changing language",
      original: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join(
        "\n",
      ),
      current: ["```js", '"use client";', "```"].join("\n"),
      before: 'Before [[1, 3, "updateName"]]',
      after: "After none",
    },
  ])("$name", ({ original, current, before, after }) => {
    const root = render(current);
    decorate(root, [
      { startLine: 1, endLine: 3, kind: "modified", originalText: original },
    ]);
    const metadata = root.querySelector(`.${DIFF_METADATA_CLASS}`)!;
    expect(metadata.textContent).toContain(before);
    expect(metadata.textContent).toContain(after);
  });

  it("describes an unlabeled code fence as plain text", () => {
    const root = render(["```powershell", "Get-Service", "```"].join("\n"));
    decorate(root, [
      {
        startLine: 1,
        endLine: 3,
        kind: "modified",
        originalText: ["```", "Get-Service", "```"].join("\n"),
      },
    ]);
    expect(
      root.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent,
    ).toContain("Before plain text");
  });
});

describe("images", () => {
  it("marks an added image with a minimal media diff instead of a wash", () => {
    const root = render("![Architecture](https://example.com/v2.png)");
    const res = decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }]);
    const owner = root.querySelector<HTMLElement>("p")!;

    expect(res.decorated).toBe(1);
    expect(owner.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);
    expect(owner.classList.contains("emr-diff-block--added")).toBe(true);
    expect(owner.dataset.diffKind).toBe("added");
  });

  it("keeps mixed prose and images on the normal granular diff path", () => {
    const root = render("Current ![Architecture](https://example.com/v2.png)");
    decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }]);

    expect(root.querySelector("p")?.classList.contains(DIFF_IMAGE_CLASS)).toBe(
      false,
    );
  });

  it("keeps an uncertain modified image minimal without generic amber UI", () => {
    const root = render("![Architecture](https://example.com/v2.png)");
    decorate(root, [{ startLine: 1, endLine: 1, kind: "modified" }]);
    const owner = root.querySelector<HTMLElement>("p")!;

    expect(owner.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);
    expect(root.querySelector(".emr-diff-before-control")).toBeNull();
    expect(owner.classList.contains(DIFF_TOOLTIP_CLASS)).toBe(false);
  });

  it("shows image source, alt, and title metadata changes", () => {
    const root = render(
      '![Current architecture](https://example.com/v2.png "Current")',
    );
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          '![Legacy architecture](https://example.com/v1.png "Legacy")',
      },
    ]);
    expect(res.inlined).toBe(1);
    const image = root.querySelector("img")!;
    expect(root.querySelector("p")?.classList.contains(DIFF_IMAGE_CLASS)).toBe(
      true,
    );
    expect(root.querySelector("p")?.classList.contains(DIFF_INLINE_CLASS)).toBe(
      true,
    );
    const indicator = image.nextElementSibling!;
    expect(indicator.classList.contains(DIFF_METADATA_CLASS)).toBe(true);
    expect(indicator.textContent).toContain("https://example.com/v1.png");
    expect(indicator.textContent).toContain("alt: Legacy architecture");
    expect(indicator.textContent).toContain("https://example.com/v2.png");
    expect(indicator.textContent).toContain("alt: Current architecture");
  });

  it("describes title-less image source and alt changes", () => {
    const root = render("![Current](https://example.com/v2.png)");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "![Legacy](https://example.com/v1.png)",
      },
    ]);
    const indicator = root.querySelector(`.${DIFF_METADATA_CLASS}`)!;
    expect(indicator.textContent).toContain(
      "Before https://example.com/v1.png (alt: Legacy)",
    );
    expect(indicator.textContent).toContain(
      "After https://example.com/v2.png (alt: Current)",
    );
  });

  it("changes one image while leaving a sibling image unchanged", () => {
    const root = render(
      "![Current](https://example.com/v2.png) ![Stable](https://example.com/stable.png)",
    );
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText:
          "![Legacy](https://example.com/v1.png) ![Stable](https://example.com/stable.png)",
      },
    ]);
    expect(root.querySelectorAll(`.${DIFF_METADATA_CLASS}`)).toHaveLength(1);
  });

  it("shows removed text when an image is introduced with no image to pair", () => {
    const root = render("![Architecture](https://example.com/v2.png)");
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Architecture",
      },
    ]);
    expect(res.inlined).toBe(1);
    expect(words(root).removed).toContain("Architecture");
    expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blockquotes
// ---------------------------------------------------------------------------
describe("blockquotes", () => {
  it("inline word-diffs an edited blockquote", () => {
    const root = render(["> Updated note here."].join("\n"));
    const res = decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "> Original note here.",
      },
    ]);
    expect(res.inlined).toBe(1);
    const bq = root.querySelector<HTMLElement>("blockquote")!;
    expect(bq.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(words(bq).added).toContain("Updated");
    expect(words(bq).removed).toContain("Original");
  });

  it("greens an added blockquote", () => {
    const root = render(["# Doc", "", "> New callout."].join("\n"));
    const res = decorate(root, [{ startLine: 3, endLine: 3, kind: "added" }]);
    expect(res.decorated).toBe(1);
    expect(
      root
        .querySelector("blockquote")
        ?.classList.contains("emr-diff-block--added"),
    ).toBe(true);
  });

  it("offers Show before for a rewritten blockquote", () => {
    const root = render("> Entirely different operational guidance now.");
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalStartLine: 1,
        originalEndLine: 1,
        originalText: "> Nothing in common with the current quote.",
      },
    ]);
    expectComparisonAmber(root);
    const trigger = root.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    trigger.click();
    expect(
      root.querySelector(".emr-diff-before-panel blockquote")?.textContent,
    ).toContain("Nothing in common");
  });

  it("inline-diffs a GitHub-style admonition without changing its label", () => {
    const original = [
      "> [!NOTE]",
      "> The browser may omit capabilities from the map.",
    ].join("\n");
    const current = [
      "> [!NOTE]",
      "> The browser may omit capabilities from the object.",
    ].join("\n");
    const root = render(current);
    decorate(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalStartLine: 2,
          originalEndLine: 2,
          originalText: "> The browser may omit capabilities from the map.",
        },
      ],
      original,
      current,
    );
    const alert = root.querySelector<HTMLElement>(".markdown-alert")!;
    expect(words(alert).removed).toContain("map");
    expect(words(alert).added).toContain("object");
    expect(alert.querySelector(".markdown-alert-title")?.textContent).toBe(
      "Note",
    );
  });

  it("diffs a blockquote whose safe HTML has no prose paragraph", () => {
    const original =
      "> <details><summary>Previous question</summary></details>";
    const current = "> <details><summary>Current question</summary></details>";
    const root = render(current);
    decorate(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: original,
      },
    ]);
    const quote = root.querySelector<HTMLElement>("blockquote")!;
    expect(words(quote).removed).toContain("Previous");
    expect(words(quote).added).toContain("Current");
  });

  it("diffs an MDN definition continuation as the nested leaf", () => {
    const original = [
      "- `browserBoundKeyHardware`",
      "  - : Returns support from the user agent.",
    ].join("\n");
    const current = [
      "- `browserBoundKeyHardware`",
      "  - : Returns support from the current browser.",
    ].join("\n");
    const root = render(current);
    decorate(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalStartLine: 2,
          originalEndLine: 2,
          originalText: "  - : Returns support from the user agent.",
        },
      ],
      original,
      current,
    );
    const nested = root.querySelector<HTMLElement>("li li")!;
    expect(words(nested).removed).toContain("user agent");
    expect(words(nested).added).toContain("current browser");
    expect(root.querySelector("li")!.classList.contains(DIFF_BLOCK_CLASS)).toBe(
      false,
    );
  });

  it("explains a fence de-indentation as code structure and content changes", () => {
    const original = [
      "    ```bash",
      '    git config --global user.name "Your Name"',
      "    ```",
    ].join("\n");
    const current = [
      "```bash",
      'git config --global user.name "Your Name"',
      "```",
    ].join("\n");
    const root = render(current);
    decorate(
      root,
      [
        {
          startLine: 1,
          endLine: 3,
          kind: "modified",
          originalStartLine: 1,
          originalEndLine: 3,
          originalText: original,
        },
      ],
      original,
      current,
    );
    const pre = root.querySelector<HTMLElement>("pre")!;
    expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
      "Before plain text",
    );
    expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
      "After bash",
    );
    expect(words(pre).removed).toContain("```bash");
  });

  it("shows a moved section as one removal and one addition", () => {
    const current = [
      "# Guide",
      "",
      "## Stable",
      "",
      "Stable body.",
      "",
      "## Moved",
      "",
      "Moved body.",
    ].join("\n");
    const root = render(current);
    const result = decorate(
      root,
      [
        {
          startLine: 3,
          endLine: 3,
          kind: "deleted-marker",
          linesDeleted: 3,
          deletedContent: "## Moved\n\nMoved body.",
        },
        { startLine: 7, endLine: 9, kind: "added", linesAdded: 3 },
      ],
      undefined,
      current,
    );
    expect(result.markers).toBe(1);
    expect(
      root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)?.textContent,
    ).toContain("Moved");
    expect(
      root
        .querySelector("h2[data-source-line='7']")
        ?.classList.contains("emr-diff-block--added"),
    ).toBe(true);
  });
});
