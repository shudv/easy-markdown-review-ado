import { describe, it, expect, beforeEach } from "vitest";
import { renderMarkdownSync } from "../src/markdown/render";
import {
  decorateDiffRanges,
  DIFF_BLOCK_CLASS,
  DIFF_DELETED_MARKER_CLASS,
  DIFF_INLINE_CLASS,
} from "../src/markdown/diffDecorations";
import {
  WORD_ADDED_CLASS,
  WORD_REMOVED_CLASS,
} from "../src/markdown/wordDiffDom";
import type { DiffRange } from "../src/types";

// End-to-end check that content-level diff highlighting attaches to REAL
// rendered blocks: render Markdown through the production pipeline (which
// stamps `data-source-line` via rehypeSourcePositions), then decorate and
// assert the added / edited washes and the removed marker land on the right
// blocks with their corner labels intact.
describe("diff highlighting over a real rendered document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const source = [
    "# Title", // line 1
    "", // 2
    "Original intro paragraph.", // 3
    "", // 4
    "This paragraph was added.", // 5
    "", // 6
    "This paragraph was edited slightly.", // 7
    "", // 8
    "Trailing unchanged paragraph.", // 9
  ].join("\n");

  function renderRoot(): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(source);
    return root;
  }

  it("marks the added paragraph green and the edited one amber", () => {
    const root = renderRoot();
    const ranges: DiffRange[] = [
      { startLine: 5, endLine: 5, kind: "added" },
      { startLine: 7, endLine: 7, kind: "modified" },
    ];
    const res = decorateDiffRanges(root, ranges);
    expect(res.decorated).toBe(2);

    const added = root.querySelector<HTMLElement>(".emr-diff-block--added");
    const edited = root.querySelector<HTMLElement>(".emr-diff-block--modified");
    expect(added?.textContent).toContain("This paragraph was added.");
    expect(added?.dataset.diffLabel).toBe("Added");
    expect(edited?.textContent).toContain("This paragraph was edited");
    expect(edited?.dataset.diffLabel).toBe("Edited");

    // Unchanged paragraphs carry no decoration.
    const paras = Array.from(root.querySelectorAll("p"));
    const untouched = paras.filter(
      (p) => !p.classList.contains(DIFF_BLOCK_CLASS),
    );
    expect(untouched.length).toBeGreaterThan(0);
  });

  it("does not pollute block text with the corner label", () => {
    // The label is rendered via a CSS ::after using attr(), so decorating must
    // NOT inject any label text into the element — the anchor resolver reads
    // textContent and would break if 'Added'/'Edited' leaked in.
    const root = renderRoot();
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);
    const added = root.querySelector<HTMLElement>(".emr-diff-block--added")!;
    expect(added.textContent).toBe("This paragraph was added.");
  });

  it("inserts a removed-lines marker anchored to the following block", () => {
    const root = renderRoot();
    const res = decorateDiffRanges(root, [
      {
        startLine: 9,
        endLine: 9,
        kind: "deleted-marker",
        linesDeleted: 2,
        deletedContent: "removed line a\nremoved line b\n",
      },
    ]);
    expect(res.markers).toBe(1);
    const marker = root.querySelector<HTMLElement>(
      `.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    expect(marker.getAttribute("aria-label")).toBe("2 lines removed");
    // Sits directly before the trailing paragraph (source line 9).
    expect(marker.nextElementSibling?.textContent).toContain(
      "Trailing unchanged paragraph.",
    );
  });

  it("clears every decoration when the diff is toggled off (empty ranges)", () => {
    const root = renderRoot();
    decorateDiffRanges(root, [
      { startLine: 5, endLine: 5, kind: "added" },
      {
        startLine: 9,
        endLine: 9,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "gone\n",
      },
    ]);
    expect(root.querySelector(`.${DIFF_BLOCK_CLASS}`)).not.toBeNull();
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).not.toBeNull();

    // Re-decorating with no ranges (the "hide changes" state) strips it all.
    const res = decorateDiffRanges(root, []);
    expect(res).toEqual({ decorated: 0, markers: 0, inlined: 0 });
    expect(root.querySelector(`.${DIFF_BLOCK_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).toBeNull();
    // The rendered prose survives untouched.
    expect(root.textContent).toContain("This paragraph was added.");
  });
});

// Inline word-level diff: for a reworded prose block we render the ORIGINAL
// source and overlay only the changed words, comparing rendered-plain-text on
// both sides (so Markdown syntax never leaks in as spurious changes).
describe("inline word-level diff over a real rendered document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function renderRoot(md: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(md);
    return root;
  }

  it("colours only the changed words in a reworded paragraph", () => {
    // Original line 3: "open the console and look for a stack trace"
    // Modified line 3: "open the console and check the network tab"
    const modified = [
      "# Title", // 1
      "", // 2
      "If it fails, open the console and check the network tab.", // 3
    ].join("\n");
    const root = renderRoot(modified);
    const ranges: DiffRange[] = [
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText:
          "If it fails, open the console and look for a stack trace.",
      },
    ];
    const res = decorateDiffRanges(root, ranges, {
      renderInline: renderMarkdownSync,
    });
    expect(res.inlined).toBe(1);

    const block = root.querySelector<HTMLElement>(`.${DIFF_INLINE_CLASS}`)!;
    expect(block).not.toBeNull();
    // Unchanged words are NOT wrapped.
    expect(block.textContent).toContain("open the console");
    // Added words are green <ins>, removed words are struck <del>.
    const added =
      block.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent ?? "";
    const removed =
      Array.from(block.querySelectorAll(`.${WORD_REMOVED_CLASS}`))
        .map((n) => n.textContent)
        .join(" ") ?? "";
    expect(added).toMatch(/network|check/);
    expect(removed).toMatch(/stack|trace|look/);
  });

  it("does NOT leak Markdown syntax as word changes (formatting-aware)", () => {
    // Only the word 'fast' was added; 'quick' was emphasised (**quick**) but
    // its TEXT is unchanged, so bolding must NOT show as a word change.
    const modified = ["Make it **quick** and fast."].join("\n");
    const root = renderRoot(modified);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalText: "Make it quick.",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    expect(res.inlined).toBe(1);
    const block = root.querySelector<HTMLElement>(`.${DIFF_INLINE_CLASS}`)!;
    // The bold survived as an element, its text unchanged and NOT marked.
    expect(block.querySelector("strong")?.textContent).toBe("quick");
    expect(
      block.querySelector("strong")?.classList.contains(WORD_ADDED_CLASS),
    ).toBe(false);
    // No asterisks leaked into any mark.
    const allMarks = Array.from(
      block.querySelectorAll(`.${WORD_ADDED_CLASS}, .${WORD_REMOVED_CLASS}`),
    )
      .map((n) => n.textContent)
      .join("");
    expect(allMarks).not.toContain("*");
    expect(allMarks).toMatch(/fast|and/);
  });

  it("falls back to the block wash when the block was mostly rewritten", () => {
    const modified = ["Completely different sentence about widgets."].join(
      "\n",
    );
    const root = renderRoot(modified);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 1,
          endLine: 1,
          kind: "modified",
          originalText: "Nothing in common here at all really.",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    // Block is still decorated (amber wash) but NOT inlined.
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${DIFF_INLINE_CLASS}`)).toBeNull();
  });

  it("does not inline-diff a code block (keeps the wash)", () => {
    const modified = ["```", "const x = 2;", "```"].join("\n");
    const root = renderRoot(modified);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalText: "const x = 1;",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
  });

  it("skips inline diff when no renderInline is provided", () => {
    const root = renderRoot("Reworded sentence here now.");
    const res = decorateDiffRanges(root, [
      {
        startLine: 1,
        endLine: 1,
        kind: "modified",
        originalText: "Reworded sentence here.",
      },
    ]);
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
  });

  it("renders removed content as Markdown in the deletion marker body", () => {
    const root = renderRoot(["# Title", "", "Kept paragraph."].join("\n"));
    decorateDiffRanges(
      root,
      [
        {
          startLine: 3,
          endLine: 3,
          kind: "deleted-marker",
          linesDeleted: 2,
          deletedContent: "## Legacy Options\n\nThe `flag` is retained.\n",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    const body = root.querySelector<HTMLElement>(".emr-diff-deleted-body")!;
    // Rendered as Markdown: heading + code element, NOT raw "##"/backticks.
    expect(body.classList.contains("markdown-body")).toBe(true);
    expect(body.querySelector("h2")?.textContent).toBe("Legacy Options");
    expect(body.querySelector("code")?.textContent).toBe("flag");
    expect(body.textContent).not.toContain("##");
    expect(body.textContent).not.toContain("`");
  });

  it("falls back to a plain <pre> body when no renderInline is given", () => {
    const root = renderRoot(["# Title", "", "Kept paragraph."].join("\n"));
    decorateDiffRanges(root, [
      {
        startLine: 3,
        endLine: 3,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "## Legacy Options\n",
      },
    ]);
    const body = root.querySelector<HTMLElement>(".emr-diff-deleted-body")!;
    expect(body.tagName).toBe("PRE");
    expect(body.textContent).toBe("## Legacy Options");
  });
});

// Granular list-item / table-row highlighting: a change to ONE item or row
// must decorate only that leaf, not the whole list/table container.
describe("granular list + table diffs over a real rendered document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function renderRoot(md: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(md);
    return root;
  }

  it("highlights only the ADDED list item, not the whole list", () => {
    // Lines 1-4 are a list; line 3 (`refresh`) is the newly added item.
    const md = [
      "- init step", // 1
      "- mount step", // 2
      "- refresh step", // 3 (added)
      "- teardown step", // 4
    ].join("\n");
    const root = renderRoot(md);
    const res = decorateDiffRanges(root, [
      { startLine: 3, endLine: 3, kind: "added" },
    ]);
    expect(res.decorated).toBe(1);
    // The <ul> itself is NOT decorated.
    expect(root.querySelector("ul")?.classList.contains(DIFF_BLOCK_CLASS)).toBe(
      false,
    );
    const items = Array.from(root.querySelectorAll("li"));
    const decorated = items.filter((li) =>
      li.classList.contains(DIFF_BLOCK_CLASS),
    );
    expect(decorated.length).toBe(1);
    expect(decorated[0]!.textContent).toContain("refresh");
    expect(decorated[0]!.classList.contains("emr-diff-block--added")).toBe(
      true,
    );
  });

  it("highlights only the EDITED table rows, not the whole table", () => {
    const md = [
      "| Option | Default |", // 1 header
      "| --- | --- |", // 2 separator
      "| theme | auto |", // 3 (edited)
      "| retries | 5 |", // 4 (edited)
      "| timeout | 5000 |", // 5 (unchanged)
    ].join("\n");
    const root = renderRoot(md);
    const res = decorateDiffRanges(root, [
      { startLine: 3, endLine: 4, kind: "modified" },
    ]);
    // Two rows decorated; the <table> itself is not.
    expect(res.decorated).toBe(2);
    expect(
      root.querySelector("table")?.classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    const decorated = rows.filter((tr) =>
      tr.classList.contains(DIFF_BLOCK_CLASS),
    );
    expect(decorated.length).toBe(2);
    expect(decorated[0]!.textContent).toContain("theme");
    expect(decorated[1]!.textContent).toContain("retries");
    // The unchanged `timeout` row is untouched.
    const timeoutRow = rows.find((r) => r.textContent?.includes("timeout"))!;
    expect(timeoutRow.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("highlights every row of a wholly-added table", () => {
    const md = [
      "| A | B |", // 1
      "| --- | --- |", // 2
      "| 1 | 2 |", // 3
    ].join("\n");
    const root = renderRoot(md);
    decorateDiffRanges(root, [{ startLine: 1, endLine: 3, kind: "added" }]);
    const rows = Array.from(root.querySelectorAll("tr"));
    expect(
      rows.every((r) => r.classList.contains("emr-diff-block--added")),
    ).toBe(true);
  });
});

// Frontmatter value diffs over a REAL rendered card. These go through the full
// render pipeline (which lifts the `---` block and stamps per-row source lines)
// so they exercise the exact original-value RECONSTRUCTION the hand-built DOM
// tests missed — this is the class of case behind the "removed reviewer didn't
// show" bug. A helper resolves each key's rendered `<dd>` for assertions.
describe("frontmatter value diffs over a real rendered document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function renderRoot(md: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(md);
    return root;
  }

  /** The `<dd>` value cell for a given frontmatter key. */
  function valueFor(root: HTMLElement, key: string): HTMLElement {
    const row = Array.from(
      root.querySelectorAll<HTMLElement>(".emr-frontmatter-row"),
    ).find(
      (r) =>
        r.querySelector(".emr-frontmatter-key")?.textContent?.trim() === key,
    );
    if (!row) throw new Error(`no frontmatter row for key "${key}"`);
    return row.querySelector<HTMLElement>(".emr-frontmatter-value")!;
  }

  const added = (el: HTMLElement): string =>
    Array.from(el.querySelectorAll(`.${WORD_ADDED_CLASS}`))
      .map((n) => n.textContent)
      .join(" ");
  const removed = (el: HTMLElement): string =>
    Array.from(el.querySelectorAll(`.${WORD_REMOVED_CLASS}`))
      .map((n) => n.textContent)
      .join(" ");

  it("word-diffs a scalar value edit (Draft → Published)", () => {
    // Frontmatter occupies lines 1-4; `status` is source line 3.
    const md = [
      "---", // 1
      "title: Guide", // 2
      "status: Published", // 3
      "---", // 4
      "", // 5
      "# Body", // 6
    ].join("\n");
    const root = renderRoot(md);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 3,
          endLine: 3,
          kind: "modified",
          originalText: "status: Draft",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    expect(res.decorated).toBe(1);
    const status = valueFor(root, "status");
    expect(added(status)).toContain("Published");
    expect(removed(status)).toContain("Draft");
    // The unchanged `title` row is not touched.
    expect(
      valueFor(root, "title").querySelector(`.${WORD_ADDED_CLASS}`),
    ).toBeNull();
  });

  it("word-diffs an inline-array edit (item added + removed)", () => {
    // `tags` is source line 3.
    const md = [
      "---", // 1
      "title: Guide", // 2
      "tags: [widgets, platform, rfc]", // 3
      "---", // 4
      "", // 5
      "# Body", // 6
    ].join("\n");
    const root = renderRoot(md);
    decorateDiffRanges(
      root,
      [
        {
          startLine: 3,
          endLine: 3,
          kind: "modified",
          originalText: "tags: [widgets, config, rfc]",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    const tags = valueFor(root, "tags");
    expect(tags.textContent).toContain("widgets");
    expect(added(tags)).toContain("platform");
    expect(removed(tags)).toContain("config");
  });

  it("shows a removed BLOCK-LIST item (the reviewer-removal regression)", () => {
    // The exact bug shape: a block list where ADO hands us only the changed
    // item line. `maintainers` key = line 3, items on lines 4-5. Line 5 (the
    // second maintainer) changed from `Grace Hopper` to `Alan Turing`.
    const md = [
      "---", // 1
      "title: Guide", // 2
      "maintainers:", // 3
      "  - Ada Lovelace", // 4
      "  - Alan Turing", // 5
      "---", // 6
      "", // 7
      "# Body", // 8
    ].join("\n");
    const root = renderRoot(md);
    // Sanity: the block list renders comma-joined.
    expect(valueFor(root, "maintainers").textContent).toBe(
      "Ada Lovelace, Alan Turing",
    );

    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 5,
          endLine: 5,
          kind: "modified",
          // Only the changed item line — NO `maintainers:` key line.
          originalText: "  - Grace Hopper",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    expect(res.decorated).toBe(1);
    const maint = valueFor(root, "maintainers");
    // Grace Hopper struck-through (removed), Alan Turing green (added).
    expect(removed(maint)).toContain("Grace Hopper");
    expect(added(maint)).toContain("Alan Turing");
    // Ada Lovelace (unchanged) is neither.
    expect(maint.textContent).toContain("Ada Lovelace");
  });

  it("shows a removed block-list item when the FIRST item changed", () => {
    // Guards the index math: first item is on `keyLine + 1`, so a change there
    // must map to item index 0, not underflow.
    const md = [
      "---", // 1
      "reviewers:", // 2
      "  - Alan Turing", // 3
      "  - Bob Jones", // 4
      "---", // 5
      "", // 6
      "# Body", // 7
    ].join("\n");
    const root = renderRoot(md);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 3,
          endLine: 3,
          kind: "modified",
          originalText: "  - Ada Lovelace",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    expect(res.decorated).toBe(1);
    const rev = valueFor(root, "reviewers");
    expect(removed(rev)).toContain("Ada Lovelace");
    expect(added(rev)).toContain("Alan Turing");
    expect(rev.textContent).toContain("Bob Jones");
  });

  it("marks the whole value green on a newly-added key row", () => {
    // A brand-new `owner` key (added range) diffs against "" → all green, and
    // its KEY label washes green while the value words read as added.
    const md = [
      "---", // 1
      "title: Guide", // 2
      "owner: Platform Team", // 3
      "---", // 4
      "", // 5
      "# Body", // 6
    ].join("\n");
    const root = renderRoot(md);
    decorateDiffRanges(root, [{ startLine: 3, endLine: 3, kind: "added" }], {
      renderInline: renderMarkdownSync,
    });
    const ownerRow = Array.from(
      root.querySelectorAll<HTMLElement>(".emr-frontmatter-row"),
    ).find(
      (r) =>
        r.querySelector(".emr-frontmatter-key")?.textContent?.trim() ===
        "owner",
    )!;
    expect(ownerRow.classList.contains("emr-diff-block--added")).toBe(true);
    const owner = valueFor(root, "owner");
    expect(added(owner)).toContain("Platform Team");
    expect(removed(owner)).toBe("");
  });

  it("leaves the value cell without a stretching background wash", () => {
    // A tags/list value must NEVER get a block wash — only inline word marks.
    const md = [
      "---", // 1
      "tags: [widgets, platform]", // 2
      "---", // 3
      "", // 4
      "# Body", // 5
    ].join("\n");
    const root = renderRoot(md);
    decorateDiffRanges(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalText: "tags: [widgets, config]",
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    const tags = valueFor(root, "tags");
    // The value cell itself carries no diff-block wash classes.
    expect(tags.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(tags.classList.contains("emr-diff-block--modified")).toBe(false);
    // Change is expressed purely as inline word marks.
    expect(tags.querySelector(`.${WORD_ADDED_CLASS}`)).not.toBeNull();
  });

  it("does not touch frontmatter rows when only body lines changed", () => {
    const md = [
      "---", // 1
      "status: Published", // 2
      "---", // 3
      "", // 4
      "Body paragraph.", // 5
    ].join("\n");
    const root = renderRoot(md);
    decorateDiffRanges(
      root,
      [{ startLine: 5, endLine: 5, kind: "modified", originalText: "Old." }],
      { renderInline: renderMarkdownSync },
    );
    const status = valueFor(root, "status");
    expect(status.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(
      status
        .closest(".emr-frontmatter-row")!
        .classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
  });

  it("is idempotent: re-decorating a frontmatter value is stable", () => {
    const md = [
      "---", // 1
      "status: Published", // 2
      "---", // 3
      "", // 4
      "# Body", // 5
    ].join("\n");
    const root = renderRoot(md);
    const range: DiffRange = {
      startLine: 2,
      endLine: 2,
      kind: "modified",
      originalText: "status: Draft",
    };
    decorateDiffRanges(root, [range], { renderInline: renderMarkdownSync });
    const firstHtml = valueFor(root, "status").innerHTML;
    // Decorate again with the same range — output must be identical.
    decorateDiffRanges(root, [range], { renderInline: renderMarkdownSync });
    expect(valueFor(root, "status").innerHTML).toBe(firstHtml);

    // And clearing restores the plain rendered value.
    decorateDiffRanges(root, []);
    expect(valueFor(root, "status").textContent).toBe("Published");
    expect(valueFor(root, "status").querySelector(`.${WORD_ADDED_CLASS}`)).toBe(
      null,
    );
  });
});
