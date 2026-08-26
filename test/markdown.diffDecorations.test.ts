import { describe, it, expect, beforeEach } from "vitest";
import {
  decorateDiffRanges,
  summarizeDiff,
  diffLegendStats,
  stripMermaidFence,
  selectionTouchesDeletedDiff,
  DIFF_BLOCK_CLASS,
  DIFF_DELETED_MARKER_CLASS,
  DIFF_INLINE_CLASS,
  DIFF_MERMAID_CLASS,
  DIFF_IMAGE_CLASS,
} from "../src/markdown/diffDecorations";
import {
  WORD_ADDED_CLASS,
  WORD_REMOVED_CLASS,
} from "../src/markdown/wordDiffDom";
import type { DiffRange } from "../src/types";

/** A minimal stand-in for `renderMarkdownSync`: wraps text in a paragraph. */
const stubRender = (md: string): string => `<p>${md}</p>`;

/**
 * Build a rendered-article-like root where each block carries the
 * `data-source-line` / `data-source-end-line` attributes that
 * `rehypeSourcePositions` stamps in the real pipeline.
 */
function makeRoot(
  blocks: Array<{ tag: string; start: number; end: number; html?: string }>,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-body emr-rendered";
  for (const b of blocks) {
    const el = document.createElement(b.tag);
    el.setAttribute("data-source-line", String(b.start));
    el.setAttribute("data-source-end-line", String(b.end));
    if (b.html) el.innerHTML = b.html;
    root.appendChild(el);
  }
  return root;
}

describe("decorateDiffRanges", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does nothing for an empty range list", () => {
    const root = makeRoot([{ tag: "p", start: 1, end: 1 }]);
    const res = decorateDiffRanges(root, []);
    expect(res).toEqual({ decorated: 0, markers: 0, inlined: 0 });
    expect(root.querySelector(`.${DIFF_BLOCK_CLASS}`)).toBeNull();
  });

  it("marks an added block and a modified block with the right kind", () => {
    const root = makeRoot([
      { tag: "p", start: 1, end: 1 },
      { tag: "p", start: 5, end: 7 },
      { tag: "p", start: 20, end: 20 },
    ]);
    const ranges: DiffRange[] = [
      { startLine: 5, endLine: 7, kind: "added" },
      { startLine: 20, endLine: 20, kind: "modified" },
    ];
    const res = decorateDiffRanges(root, ranges);
    expect(res.decorated).toBe(2);
    const ps = root.querySelectorAll("p");
    expect(ps[0].classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(ps[1].classList.contains("emr-diff-block--added")).toBe(true);
    expect(ps[1].dataset.diffKind).toBe("added");
    expect(ps[1].dataset.diffLabel).toBe("Added");
    expect(ps[2].classList.contains("emr-diff-block--modified")).toBe(true);
    expect(ps[2].dataset.diffKind).toBe("modified");
    expect(ps[2].dataset.diffLabel).toBe("Edited");
  });

  it("prefers 'modified' over 'added' when a block overlaps both", () => {
    const root = makeRoot([{ tag: "p", start: 3, end: 8 }]);
    const ranges: DiffRange[] = [
      { startLine: 3, endLine: 4, kind: "added" },
      { startLine: 7, endLine: 8, kind: "modified" },
    ];
    decorateDiffRanges(root, ranges);
    const p = root.querySelector("p")!;
    expect(p.dataset.diffKind).toBe("modified");
  });

  it("does not stack bars on a nested block when its ancestor is marked", () => {
    // Outer blockquote and an inner paragraph (both selectable blocks) carry
    // source lines and both fall inside the changed range; only the outer
    // block should get a bar — the inner one is skipped because an ancestor is
    // already decorated.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const quote = document.createElement("blockquote");
    quote.setAttribute("data-source-line", "4");
    quote.setAttribute("data-source-end-line", "6");
    const inner = document.createElement("p");
    inner.setAttribute("data-source-line", "5");
    inner.setAttribute("data-source-end-line", "5");
    quote.appendChild(inner);
    root.appendChild(quote);

    const res = decorateDiffRanges(root, [
      { startLine: 4, endLine: 6, kind: "added" },
    ]);
    expect(res.decorated).toBe(1);
    expect(quote.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(inner.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("inserts a collapsible deletion marker before the block at the line", () => {
    const root = makeRoot([
      { tag: "p", start: 1, end: 1 },
      { tag: "p", start: 10, end: 12 },
    ]);
    const ranges: DiffRange[] = [
      {
        startLine: 10,
        endLine: 10,
        kind: "deleted-marker",
        linesDeleted: 2,
        deletedContent: "gone line one\ngone line two\n",
      },
    ];
    const res = decorateDiffRanges(root, ranges);
    expect(res.markers).toBe(1);
    const marker = root.querySelector<HTMLElement>(
      `.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    expect(marker).not.toBeNull();
    // Inserted right before the second paragraph.
    expect(marker.nextElementSibling?.getAttribute("data-source-line")).toBe(
      "10",
    );
    expect(marker.getAttribute("aria-label")).toBe("2 lines removed");

    const body = marker.querySelector<HTMLElement>(".emr-diff-deleted-body")!;
    expect(body.hidden).toBe(true);
    expect(body.textContent).toBe("gone line one\ngone line two");

    const chip = marker.querySelector<HTMLButtonElement>(
      ".emr-diff-deleted-chip",
    )!;
    chip.click();
    expect(body.hidden).toBe(false);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    chip.click();
    expect(body.hidden).toBe(true);
  });

  it("singularizes the marker label for a single deleted line", () => {
    const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);
    decorateDiffRanges(root, [
      { startLine: 5, endLine: 5, kind: "deleted-marker", linesDeleted: 1 },
    ]);
    const chip = root.querySelector(".emr-diff-deleted-chip")!;
    expect(chip.textContent).toBe("1 line removed");
  });

  it("defaults the marker count to zero when linesDeleted is absent", () => {
    const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);
    decorateDiffRanges(root, [
      { startLine: 5, endLine: 5, kind: "deleted-marker" },
    ]);
    const chip = root.querySelector(".emr-diff-deleted-chip")!;
    expect(chip.textContent).toBe("0 lines removed");
  });

  it("appends a deletion marker when no block follows the deleted line", () => {
    const root = makeRoot([{ tag: "p", start: 1, end: 1 }]);
    const res = decorateDiffRanges(root, [
      { startLine: 99, endLine: 99, kind: "deleted-marker", linesDeleted: 3 },
    ]);
    expect(res.markers).toBe(1);
    expect(
      root.lastElementChild?.classList.contains(DIFF_DELETED_MARKER_CLASS),
    ).toBe(true);
  });

  it("anchors a deletion marker before a following Mermaid diagram", () => {
    // The block after the deletion is a Mermaid placeholder, which lives
    // outside BLOCK_SELECTOR. The marker must still be inserted BEFORE the
    // diagram (not skipped past it or appended at the end).
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const p = document.createElement("p");
    p.setAttribute("data-source-line", "1");
    p.setAttribute("data-source-end-line", "1");
    root.appendChild(p);
    const mermaid = document.createElement("div");
    mermaid.className = "emr-mermaid";
    mermaid.setAttribute("data-source-line", "10");
    mermaid.setAttribute("data-source-end-line", "14");
    mermaid.setAttribute(
      "data-mermaid-src",
      encodeURIComponent("flowchart LR"),
    );
    root.appendChild(mermaid);

    const res = decorateDiffRanges(root, [
      {
        startLine: 10,
        endLine: 10,
        kind: "deleted-marker",
        linesDeleted: 2,
        deletedContent: "gone\ngone two\n",
      },
    ]);
    expect(res.markers).toBe(1);
    const marker = root.querySelector<HTMLElement>(
      `.${DIFF_DELETED_MARKER_CLASS}`,
    )!;
    // Inserted immediately before the diagram, not appended at the end.
    expect(marker.nextElementSibling).toBe(mermaid);
    expect(root.lastElementChild).toBe(mermaid);
  });

  it("clears a previously-inserted deletion marker on re-decorate", () => {
    const root = makeRoot([
      { tag: "p", start: 1, end: 1 },
      { tag: "p", start: 10, end: 12 },
    ]);
    // First pass inserts a deletion marker.
    decorateDiffRanges(root, [
      {
        startLine: 10,
        endLine: 10,
        kind: "deleted-marker",
        linesDeleted: 1,
        deletedContent: "gone\n",
      },
    ]);
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).not.toBeNull();

    // Second pass has no deletions — clearDecorations must remove the
    // marker the previous pass inserted.
    const res = decorateDiffRanges(root, [
      { startLine: 1, endLine: 1, kind: "added" },
    ]);
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).toBeNull();
    expect(res.markers).toBe(0);
  });

  it("is idempotent: re-decorating clears the previous pass", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 7 },
      { tag: "p", start: 20, end: 20 },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 7, kind: "added" }]);
    // Second pass with a different range set.
    const res = decorateDiffRanges(root, [
      { startLine: 20, endLine: 20, kind: "modified" },
    ]);
    expect(res.decorated).toBe(1);
    const marked = root.querySelectorAll(`.${DIFF_BLOCK_CLASS}`);
    expect(marked.length).toBe(1);
    expect(marked[0].getAttribute("data-source-line")).toBe("20");
  });

  it("clears the diff label when re-decorating removes a block's change", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 7 },
      { tag: "p", start: 20, end: 20 },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 7, kind: "added" }]);
    const first = root.querySelectorAll("p")[0];
    expect(first.dataset.diffLabel).toBe("Added");
    // Second pass no longer marks the first paragraph.
    decorateDiffRanges(root, [
      { startLine: 20, endLine: 20, kind: "modified" },
    ]);
    expect(first.dataset.diffLabel).toBeUndefined();
    expect(first.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("ignores blocks that lack source-line attributes", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    root.appendChild(p);
    const res = decorateDiffRanges(root, [
      { startLine: 1, endLine: 1, kind: "added" },
    ]);
    expect(res.decorated).toBe(0);
  });

  it("ignores blocks whose source-line attribute is non-numeric", () => {
    const root = makeRoot([{ tag: "p", start: 1, end: 1 }]);
    const p = root.querySelector("p")!;
    p.setAttribute("data-source-line", "not-a-number");
    const res = decorateDiffRanges(root, [
      { startLine: 1, endLine: 1, kind: "added" },
    ]);
    expect(res.decorated).toBe(0);
    expect(p.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("highlights only the frontmatter row whose source line changed", () => {
    // Each `.emr-frontmatter-row` carries its key's source span, so a changed
    // key lights up just its row (like a table row), not the whole card.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    card.setAttribute("data-source-line", "1");
    card.setAttribute("data-source-end-line", "5");
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const rowTitle = document.createElement("div");
    rowTitle.className = "emr-frontmatter-row";
    rowTitle.setAttribute("data-source-line", "2");
    rowTitle.setAttribute("data-source-end-line", "2");
    const rowStatus = document.createElement("div");
    rowStatus.className = "emr-frontmatter-row";
    rowStatus.setAttribute("data-source-line", "3");
    rowStatus.setAttribute("data-source-end-line", "3");
    grid.append(rowTitle, rowStatus);
    card.appendChild(grid);
    root.appendChild(card);

    const res = decorateDiffRanges(root, [
      { startLine: 3, endLine: 3, kind: "modified" },
    ]);

    expect(res.decorated).toBe(1);
    expect(rowStatus.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(rowStatus.dataset.diffKind).toBe("modified");
    // Unchanged row and the container card stay clean; rows never group.
    expect(rowTitle.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(card.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(rowStatus.dataset.diffGroup).toBeUndefined();
  });

  it("word-diffs an edited list value (added/removed items inline)", () => {
    // Values render comma-joined, so an item change is a plain word diff:
    // [widgets, config] -> [widgets, platform]: `config` removed, `platform`
    // added, `widgets` unchanged. No background wash on the value cell.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "4");
    row.setAttribute("data-source-end-line", "4");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "tags";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "widgets, platform";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    const res = decorateDiffRanges(root, [
      {
        startLine: 4,
        endLine: 4,
        kind: "modified",
        originalText: "tags: [widgets, config]",
      },
    ]);

    expect(res.decorated).toBe(1);
    expect(row.dataset.diffInline).toBe("true");
    // `platform` shows as an added word, `config` as a removed word.
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "platform",
    );
    expect(
      value.querySelector(`.${WORD_REMOVED_CLASS}`)?.textContent,
    ).toContain("config");
    // The value cell itself is never washed (no diff-block bar classes on it).
    expect(value.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });

  it("word-diffs a block-list value whose changed item spans multiple lines", () => {
    // A block list renders comma-joined, but ADO's per-line diff hands us only
    // the changed item line ("  - Grace Hopper") with no `key:` line. The
    // original value must still be reconstructed so the removed item shows.
    // Row: `maintainers:` on line 7, items on 8-9. Item on line 9 changed.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "7");
    row.setAttribute("data-source-end-line", "9");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "maintainers";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "Ada Lovelace, Alan Turing";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    const res = decorateDiffRanges(root, [
      {
        startLine: 9,
        endLine: 9,
        kind: "modified",
        originalText: "  - Grace Hopper",
      },
    ]);

    expect(res.decorated).toBe(1);
    expect(row.dataset.diffInline).toBe("true");
    // `Alan Turing` added, `Grace Hopper` removed, `Ada Lovelace` unchanged.
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "Alan Turing",
    );
    expect(
      value.querySelector(`.${WORD_REMOVED_CLASS}`)?.textContent,
    ).toContain("Grace Hopper");
    expect(value.textContent).toContain("Ada Lovelace");
  });

  it("reconstructs a block-list value when two items changed at once", () => {
    // maintainers span 7-9; BOTH items changed (two modified ranges) so the
    // reconstruction must sort/apply them — exercises the multi-range path.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "7");
    row.setAttribute("data-source-end-line", "9");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "maintainers";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "Bob Smith, Alan Turing";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    decorateDiffRanges(root, [
      { startLine: 8, endLine: 8, kind: "modified", originalText: "  - Ada" },
      {
        startLine: 9,
        endLine: 9,
        kind: "modified",
        originalText: "  - Grace Hopper",
      },
    ]);

    expect(row.dataset.diffInline).toBe("true");
    // Original reconstructed as "Ada, Grace Hopper" → both removed, new added.
    expect(value.textContent).toContain("Ada");
    expect(value.textContent).toContain("Grace Hopper");
    expect(value.textContent).toContain("Bob Smith");
    expect(value.textContent).toContain("Alan Turing");
  });

  it("reconstructs a block-list value that rendered empty (all items gone)", () => {
    // Synthetic: the value cell rendered empty, so the current item list is
    // empty — exercises the empty-current-text branch.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "7");
    row.setAttribute("data-source-end-line", "9");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "maintainers";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    decorateDiffRanges(root, [
      { startLine: 8, endLine: 8, kind: "modified", originalText: "  - Ghost" },
    ]);

    expect(row.dataset.diffInline).toBe("true");
    expect(
      value.querySelector(`.${WORD_REMOVED_CLASS}`)?.textContent,
    ).toContain("Ghost");
  });

  it("bails on a block-list fragment that maps before the first item", () => {
    // A modified range starting at the KEY line (7) with a bare-item fragment
    // can't map onto an item slot (index < 0) → no diff, no crash.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "7");
    row.setAttribute("data-source-end-line", "9");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "maintainers";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "Ada Lovelace, Alan Turing";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    decorateDiffRanges(root, [
      {
        startLine: 7,
        endLine: 7,
        kind: "modified",
        // Bare item fragment (no `maintainers:` key) anchored at the key line.
        originalText: "  - Ghost",
      },
    ]);

    expect(row.dataset.diffInline).toBeUndefined();
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(value.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
  });

  it("marks the whole value added on a wholly-added row", () => {
    // A brand-new `tags:` line — the value diffs against "" so every word reads
    // as added; no stretching wash.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "4");
    row.setAttribute("data-source-end-line", "4");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "tags";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "alpha, beta";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    const res = decorateDiffRanges(root, [
      { startLine: 4, endLine: 4, kind: "added" },
    ]);

    expect(res.decorated).toBe(1);
    expect(row.dataset.diffInline).toBe("true");
    // Both items read as added words; nothing struck.
    const addedText = Array.from(
      value.querySelectorAll(`.${WORD_ADDED_CLASS}`),
      (el) => el.textContent,
    ).join(" ");
    expect(addedText).toContain("alpha");
    expect(addedText).toContain("beta");
    expect(value.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
  });

  it("word-diffs a scalar value edit (struck old + green new)", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "2");
    row.setAttribute("data-source-end-line", "2");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "status";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "Published";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    const res = decorateDiffRanges(root, [
      {
        startLine: 2,
        endLine: 2,
        kind: "modified",
        originalText: "status: Draft",
      },
    ]);

    expect(res.decorated).toBe(1);
    expect(row.dataset.diffInline).toBe("true");
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "Published",
    );
    expect(
      value.querySelector(`.${WORD_REMOVED_CLASS}`)?.textContent,
    ).toContain("Draft");
  });

  it("re-decorating a value clears the previous word-diff marks", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "4");
    row.setAttribute("data-source-end-line", "4");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "tags";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "widgets, platform";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    decorateDiffRanges(root, [
      {
        startLine: 4,
        endLine: 4,
        kind: "modified",
        originalText: "tags: [widgets, config]",
      },
    ]);
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)).not.toBeNull();
    expect(value.querySelector(`.${WORD_REMOVED_CLASS}`)).not.toBeNull();

    // Second pass with no diff strips the inserted removed word and unwraps the
    // added mark, restoring the plain value text.
    decorateDiffRanges(root, []);
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(value.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
    expect(value.textContent).toBe("widgets, platform");
  });

  it("leaves a value untouched when its key or original value can't resolve", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";

    // Row A: a value but NO key element (key guard).
    const rowNoKey = document.createElement("div");
    rowNoKey.className = "emr-frontmatter-row";
    rowNoKey.setAttribute("data-source-line", "2");
    rowNoKey.setAttribute("data-source-end-line", "2");
    const valNoKey = document.createElement("dd");
    valNoKey.className = "emr-frontmatter-value";
    valNoKey.textContent = "x";
    rowNoKey.appendChild(valNoKey);

    // Row B: a proper key/value, but the change range's originalText does NOT
    // contain this key (originalValues-null guard).
    const rowMissing = document.createElement("div");
    rowMissing.className = "emr-frontmatter-row";
    rowMissing.setAttribute("data-source-line", "3");
    rowMissing.setAttribute("data-source-end-line", "3");
    const keyB = document.createElement("dt");
    keyB.className = "emr-frontmatter-key";
    keyB.textContent = "tags";
    const valB = document.createElement("dd");
    valB.className = "emr-frontmatter-value";
    valB.textContent = "y";
    rowMissing.append(keyB, valB);

    // Row C: a proper key/value, but the change range carries NO originalText.
    const rowNoOrig = document.createElement("div");
    rowNoOrig.className = "emr-frontmatter-row";
    rowNoOrig.setAttribute("data-source-line", "5");
    rowNoOrig.setAttribute("data-source-end-line", "5");
    const keyC = document.createElement("dt");
    keyC.className = "emr-frontmatter-key";
    keyC.textContent = "labels";
    const valC = document.createElement("dd");
    valC.className = "emr-frontmatter-value";
    valC.textContent = "z";
    rowNoOrig.append(keyC, valC);

    grid.append(rowNoKey, rowMissing, rowNoOrig);
    card.appendChild(grid);
    root.appendChild(card);

    decorateDiffRanges(root, [
      { startLine: 2, endLine: 2, kind: "modified" },
      {
        startLine: 3,
        endLine: 3,
        kind: "modified",
        originalText: "title: Doc",
      },
      { startLine: 5, endLine: 5, kind: "modified" },
    ]);

    // No word diff resolved on any row → no marks, no inline flag.
    for (const row of [rowNoKey, rowMissing, rowNoOrig]) {
      expect(row.dataset.diffInline).toBeUndefined();
      expect(row.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
      expect(row.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
    }
  });

  it("leaves an unchanged value untouched", () => {
    // A modified range covers the row but the value is identical (comment-only
    // line change), so no word diff resolves.
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const grid = document.createElement("dl");
    grid.className = "emr-frontmatter-grid";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "4");
    row.setAttribute("data-source-end-line", "4");
    const key = document.createElement("dt");
    key.className = "emr-frontmatter-key";
    key.textContent = "tags";
    const value = document.createElement("dd");
    value.className = "emr-frontmatter-value";
    value.textContent = "widgets, config";
    row.append(key, value);
    grid.appendChild(row);
    card.appendChild(grid);
    root.appendChild(card);

    decorateDiffRanges(root, [
      {
        startLine: 4,
        endLine: 4,
        kind: "modified",
        originalText: "tags: [widgets, config]",
      },
    ]);

    expect(row.dataset.diffInline).toBeUndefined();
    expect(value.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(value.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
  });

  it("leaves frontmatter rows untouched when only body lines changed", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const card = document.createElement("div");
    card.className = "emr-frontmatter";
    const row = document.createElement("div");
    row.className = "emr-frontmatter-row";
    row.setAttribute("data-source-line", "2");
    row.setAttribute("data-source-end-line", "2");
    card.appendChild(row);
    root.appendChild(card);
    const body = document.createElement("p");
    body.setAttribute("data-source-line", "8");
    body.setAttribute("data-source-end-line", "8");
    root.appendChild(body);

    const res = decorateDiffRanges(root, [
      { startLine: 8, endLine: 8, kind: "modified" },
    ]);

    expect(res.decorated).toBe(1);
    expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(body.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
  });
});

describe("summarizeDiff", () => {
  it("returns all zeros for an empty range list", () => {
    expect(summarizeDiff([])).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it("counts added and modified ranges and sums removed lines", () => {
    const ranges: DiffRange[] = [
      { startLine: 1, endLine: 2, kind: "added" },
      { startLine: 5, endLine: 5, kind: "added" },
      { startLine: 9, endLine: 12, kind: "modified" },
      { startLine: 20, endLine: 20, kind: "deleted-marker", linesDeleted: 3 },
      { startLine: 40, endLine: 40, kind: "deleted-marker", linesDeleted: 1 },
    ];
    expect(summarizeDiff(ranges)).toEqual({
      added: 2,
      modified: 1,
      deleted: 4,
    });
  });

  it("treats a deletion marker with no linesDeleted as zero removed", () => {
    const ranges: DiffRange[] = [
      { startLine: 3, endLine: 3, kind: "deleted-marker" },
    ];
    expect(summarizeDiff(ranges)).toEqual({
      added: 0,
      modified: 0,
      deleted: 0,
    });
  });
});

describe("diffLegendStats", () => {
  it("returns no entries when nothing changed", () => {
    expect(diffLegendStats({ added: 0, modified: 0, deleted: 0 })).toEqual([]);
  });

  it("emits one entry per non-zero kind, in add/edit/remove order", () => {
    expect(diffLegendStats({ added: 2, modified: 3, deleted: 4 })).toEqual([
      { kind: "added", label: "2 added" },
      { kind: "modified", label: "3 edited" },
      { kind: "deleted", label: "4 removed" },
    ]);
  });

  it("omits kinds with a zero count", () => {
    expect(diffLegendStats({ added: 0, modified: 1, deleted: 0 })).toEqual([
      { kind: "modified", label: "1 edited" },
    ]);
    expect(diffLegendStats({ added: 5, modified: 0, deleted: 0 })).toEqual([
      { kind: "added", label: "5 added" },
    ]);
  });
});

describe("decorateDiffRanges — inline word diff", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("overlays an inline word diff on a reworded prose block", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "hello world" },
    ]);
    const res = decorateDiffRanges(
      root,
      [{ startLine: 5, endLine: 5, kind: "modified", originalText: "hello" }],
      { renderInline: stubRender },
    );
    expect(res.inlined).toBe(1);
    const p = root.querySelector("p")!;
    expect(p.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
    expect(p.dataset.diffInline).toBe("true");
    expect(p.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "world",
    );
  });

  it("unwraps inline marks + class on re-decorate (idempotent)", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "hello world" },
    ]);
    decorateDiffRanges(
      root,
      // "planet" removed, "world" added → both mark kinds present.
      [
        {
          startLine: 5,
          endLine: 5,
          kind: "modified",
          originalText: "hello planet",
        },
      ],
      { renderInline: stubRender },
    );
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).not.toBeNull();
    expect(root.querySelector(`.${WORD_REMOVED_CLASS}`)).not.toBeNull();

    // Re-decorate with no ranges: marks + class removed, text restored.
    const res = decorateDiffRanges(root, []);
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${DIFF_INLINE_CLASS}`)).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("hello world");
  });

  it("skips added ranges when finding the sole modified range", () => {
    // The block overlaps an ADDED range and a MODIFIED range; classify picks
    // 'modified', and soleModifiedRange must ignore the added one and still
    // find the single modified range to inline-diff.
    const root = makeRoot([
      { tag: "p", start: 5, end: 6, html: "hello world" },
    ]);
    const res = decorateDiffRanges(
      root,
      [
        { startLine: 5, endLine: 5, kind: "added" },
        { startLine: 5, endLine: 6, kind: "modified", originalText: "hello" },
      ],
      { renderInline: stubRender },
    );
    expect(res.inlined).toBe(1);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "world",
    );
  });

  it("inlines two reworded blocks each against its own modified range", () => {
    // Two prose blocks with separate, non-overlapping modified ranges. For
    // each block, soleModifiedRange must skip the OTHER block's range (the
    // non-overlap path) and inline-diff against its own.
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "first world" },
      { tag: "p", start: 20, end: 20, html: "second planet" },
    ]);
    const res = decorateDiffRanges(
      root,
      [
        { startLine: 5, endLine: 5, kind: "modified", originalText: "first" },
        {
          startLine: 20,
          endLine: 20,
          kind: "modified",
          originalText: "second",
        },
      ],
      { renderInline: stubRender },
    );
    expect(res.inlined).toBe(2);
    const ps = root.querySelectorAll("p");
    expect(ps[0]!.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "world",
    );
    expect(ps[1]!.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toContain(
      "planet",
    );
  });

  it("does NOT inline when the change range only partly covers the block", () => {
    // The block spans source lines 5–7 but only line 5 changed. originalText
    // would be a fragment, so word-diffing it against the whole block would
    // mis-mark the unchanged remainder — fall back to the wash instead.
    const root = makeRoot([
      { tag: "p", start: 5, end: 7, html: "hello world" },
    ]);
    const res = decorateDiffRanges(
      root,
      [{ startLine: 5, endLine: 5, kind: "modified", originalText: "hello" }],
      { renderInline: stubRender },
    );
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${DIFF_INLINE_CLASS}`)).toBeNull();
  });

  it("does NOT inline when two modified ranges overlap one block", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 8, html: "hello world" },
    ]);
    const res = decorateDiffRanges(
      root,
      [
        { startLine: 5, endLine: 6, kind: "modified", originalText: "hello" },
        { startLine: 7, endLine: 8, kind: "modified", originalText: "world" },
      ],
      { renderInline: stubRender },
    );
    // Still washed (decorated) but ambiguous → no inline overlay.
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
    expect(root.querySelector(`.${DIFF_INLINE_CLASS}`)).toBeNull();
  });

  it("inline-diffs a code block when its complete original is available", () => {
    const root = makeRoot([
      { tag: "pre", start: 5, end: 5, html: "const x = 2;" },
    ]);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 5,
          endLine: 5,
          kind: "modified",
          originalText: "const x = 1;",
        },
      ],
      { renderInline: stubRender },
    );
    expect(res.inlined).toBe(1);
    expect(root.querySelector(`.${WORD_ADDED_CLASS}`)?.textContent).toBe("2");
    expect(root.querySelector(`.${WORD_REMOVED_CLASS}`)?.textContent).toBe("1");
  });

  it("skips code metadata when the rendered pre has no code child", () => {
    const root = makeRoot([
      { tag: "pre", start: 5, end: 5, html: "const x = 2;" },
    ]);
    expect(() =>
      decorateDiffRanges(
        root,
        [
          {
            startLine: 5,
            endLine: 5,
            kind: "modified",
            originalText: "const x = 1;",
          },
        ],
        {
          renderInline: (markdown) =>
            `<pre><code class="language-ts">${markdown}</code></pre>`,
        },
      ),
    ).not.toThrow();
    expect(root.querySelector(".emr-diff-metadata")).toBeNull();
  });

  it("does NOT inline when the block was mostly rewritten", () => {
    const root = makeRoot([
      {
        tag: "p",
        start: 5,
        end: 5,
        html: "totally different content entirely",
      },
    ]);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 5,
          endLine: 5,
          kind: "modified",
          originalText: "nothing alike whatsoever here",
        },
      ],
      { renderInline: stubRender },
    );
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
  });

  it("does NOT inline a modified block without originalText", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "hello world" },
    ]);
    const res = decorateDiffRanges(
      root,
      [{ startLine: 5, endLine: 5, kind: "modified" }],
      { renderInline: stubRender },
    );
    expect(res.inlined).toBe(0);
  });

  it("skips inline when rendered original equals rendered modified", () => {
    // A pure formatting change: same text, so no word delta → wash only.
    const root = makeRoot([{ tag: "p", start: 5, end: 5, html: "same text" }]);
    const res = decorateDiffRanges(
      root,
      [
        {
          startLine: 5,
          endLine: 5,
          kind: "modified",
          originalText: "same text",
        },
      ],
      { renderInline: stubRender },
    );
    expect(res.decorated).toBe(1);
    expect(res.inlined).toBe(0);
  });
});

describe("decorateDiffRanges — contiguous grouping", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("marks a single decorated block as its own group", () => {
    const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);
    expect(root.querySelector("p")?.dataset.diffGroup).toBe("single");
  });

  it("groups two adjacent same-kind blocks as start + end", () => {
    const root = makeRoot([
      { tag: "h2", start: 5, end: 5 },
      { tag: "p", start: 6, end: 6 },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 6, kind: "added" }]);
    const [h2, p] = Array.from(root.children) as HTMLElement[];
    expect(h2!.dataset.diffGroup).toBe("start");
    expect(p!.dataset.diffGroup).toBe("end");
  });

  it("groups three adjacent same-kind blocks as start + mid + end", () => {
    const root = makeRoot([
      { tag: "h2", start: 5, end: 5 },
      { tag: "p", start: 6, end: 6 },
      { tag: "p", start: 7, end: 7 },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 7, kind: "added" }]);
    const groups = (Array.from(root.children) as HTMLElement[]).map(
      (el) => el.dataset.diffGroup,
    );
    expect(groups).toEqual(["start", "mid", "end"]);
  });

  it("does NOT group blocks of different kinds", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5 },
      { tag: "p", start: 6, end: 6 },
    ]);
    decorateDiffRanges(root, [
      { startLine: 5, endLine: 5, kind: "added" },
      { startLine: 6, endLine: 6, kind: "modified" },
    ]);
    const [a, b] = Array.from(root.children) as HTMLElement[];
    expect(a!.dataset.diffGroup).toBe("single");
    expect(b!.dataset.diffGroup).toBe("single");
  });

  it("does NOT group across an undecorated block between two added blocks", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5 },
      { tag: "p", start: 6, end: 6 }, // unchanged, not decorated
      { tag: "p", start: 7, end: 7 },
    ]);
    decorateDiffRanges(root, [
      { startLine: 5, endLine: 5, kind: "added" },
      { startLine: 7, endLine: 7, kind: "added" },
    ]);
    const [a, , c] = Array.from(root.children) as HTMLElement[];
    expect(a!.dataset.diffGroup).toBe("single");
    expect(c!.dataset.diffGroup).toBe("single");
  });

  it("excludes an inline block from grouping", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "hello world" },
      { tag: "p", start: 6, end: 6, html: "second one" },
    ]);
    decorateDiffRanges(
      root,
      [
        { startLine: 5, endLine: 5, kind: "modified", originalText: "hello" },
        { startLine: 6, endLine: 6, kind: "modified", originalText: "second" },
      ],
      { renderInline: stubRender },
    );
    // Both became inline → neither carries a group marker.
    const [a, b] = Array.from(root.children) as HTMLElement[];
    expect(a!.dataset.diffGroup).toBeUndefined();
    expect(b!.dataset.diffGroup).toBeUndefined();
  });

  it("clears group markers on re-decorate", () => {
    const root = makeRoot([
      { tag: "h2", start: 5, end: 5 },
      { tag: "p", start: 6, end: 6 },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 6, kind: "added" }]);
    expect(root.querySelector("h2")?.dataset.diffGroup).toBe("start");
    decorateDiffRanges(root, []);
    expect(root.querySelector("h2")?.dataset.diffGroup).toBeUndefined();
    expect(root.querySelector("p")?.dataset.diffGroup).toBeUndefined();
  });
});

describe("decorateDiffRanges — minimal line washes", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps rich paragraph content in one inline wash", () => {
    const root = makeRoot([
      {
        tag: "p",
        start: 5,
        end: 5,
        html: "A short <strong>changed line</strong>.",
      },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    const paragraph = root.querySelector<HTMLElement>("p")!;
    const wash = paragraph.querySelector<HTMLElement>(".emr-diff-line-wash")!;
    expect(paragraph.dataset.diffLineWash).toBe("true");
    expect(wash.innerHTML).toBe("A short <strong>changed line</strong>.");
    expect(paragraph.dataset.diffGroup).toBeUndefined();
  });

  it("keeps a section toggle outside a changed heading wash", () => {
    const root = makeRoot([
      {
        tag: "h2",
        start: 5,
        end: 5,
        html: '<button class="emr-section-toggle" type="button"></button>Changed heading',
      },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    const heading = root.querySelector<HTMLElement>("h2")!;
    expect(
      heading.querySelector(":scope > .emr-section-toggle"),
    ).not.toBeNull();
    expect(
      heading.querySelector(":scope > .emr-diff-line-wash")?.textContent,
    ).toBe("Changed heading");
    expect(
      heading.querySelector(".emr-diff-line-wash .emr-section-toggle"),
    ).toBeNull();
  });

  it("gives contiguous changed prose blocks independent line washes", () => {
    const root = makeRoot([
      { tag: "h2", start: 5, end: 5, html: "Quality gates" },
      { tag: "p", start: 6, end: 6, html: "First changed line." },
      { tag: "p", start: 7, end: 7, html: "Second changed line." },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 7, kind: "added" }]);

    const blocks = Array.from(root.children) as HTMLElement[];
    expect(
      blocks.map((block) =>
        block.querySelector(".emr-diff-line-wash")?.textContent?.trim(),
      ),
    ).toEqual(["Quality gates", "First changed line.", "Second changed line."]);
    expect(blocks.map((block) => block.dataset.diffGroup)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("wraps loose-list prose without swallowing its nested list", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML =
      '<li data-source-line="5" data-source-end-line="8"><p>Parent item</p><ul data-source-line="7" data-source-end-line="8"><li data-source-line="8" data-source-end-line="8">Child</li></ul></li>';

    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    const parent = root.querySelector<HTMLElement>(":scope > li")!;
    expect(parent.querySelector("p > .emr-diff-line-wash")?.textContent).toBe(
      "Parent item",
    );
    expect(parent.querySelector(".emr-diff-line-wash ul")).toBeNull();
    expect(parent.querySelector(":scope > ul")).not.toBeNull();
  });

  it("keeps a tight nested ordered list outside its parent's wash", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML =
      '<li data-source-line="5" data-source-end-line="8">Parent item<ol data-source-line="7" data-source-end-line="8"><li data-source-line="8" data-source-end-line="8">Child</li></ol></li>';

    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    const parent = root.querySelector<HTMLElement>(":scope > li")!;
    expect(
      parent.querySelector(":scope > .emr-diff-line-wash")?.textContent,
    ).toBe("Parent item");
    expect(parent.querySelector(".emr-diff-line-wash ol")).toBeNull();
    expect(parent.querySelector(":scope > ol")).not.toBeNull();
  });

  it("keeps unsupported structural blocks broad", () => {
    const root = makeRoot([
      { tag: "dl", start: 5, end: 5, html: "<dt>Term</dt><dd>Meaning</dd>" },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    expect(root.querySelector(".emr-diff-line-wash")).toBeNull();
    expect(root.querySelector("dl")?.dataset.diffGroup).toBe("single");
  });

  it("keeps mixed image prose broad", () => {
    const root = makeRoot([
      {
        tag: "p",
        start: 5,
        end: 5,
        html: 'Caption <img src="diagram.png" alt="Diagram">',
      },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    expect(root.querySelector(".emr-diff-line-wash")).toBeNull();
    expect(root.querySelector("p")?.dataset.diffGroup).toBe("single");
  });

  it("wraps real text even when another child is whitespace-only", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "  <strong>Changed</strong>" },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    expect(root.querySelector(".emr-diff-line-wash")?.textContent).toBe(
      "  Changed",
    );
  });

  it("wraps wholesale code rewrites in a line-fitted wash", () => {
    const root = makeRoot([
      { tag: "pre", start: 5, end: 5, html: "<code>const x = 1;</code>" },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    expect(
      root.querySelector("pre > code > .emr-diff-line-wash")?.textContent,
    ).toBe("const x = 1;");
    expect(root.querySelector("pre")?.dataset.diffLineWash).toBe("true");
    expect(root.querySelector("pre")?.dataset.diffGroup).toBeUndefined();
  });

  it("keeps a changed pre broad when it has no code child", () => {
    const root = makeRoot([
      { tag: "pre", start: 5, end: 5, html: "const x = 1;" },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    expect(root.querySelector(".emr-diff-line-wash")).toBeNull();
    expect(root.querySelector("pre")?.dataset.diffLineWash).toBeUndefined();
    expect(root.querySelector("pre")?.classList).toContain(
      "emr-diff-block--added",
    );
  });

  it("keeps content with no readable text broad", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "Changed content" },
    ]);
    const text = root.querySelector("p")!.firstChild!;
    Object.defineProperty(text, "textContent", {
      configurable: true,
      get: () => null,
    });
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

    expect(root.querySelector(".emr-diff-line-wash")).toBeNull();
    expect(root.querySelector("p")?.classList).toContain(
      "emr-diff-block--added",
    );
  });

  it("unwraps the line wash cleanly on re-decorate", () => {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "Keep <em>this markup</em>." },
    ]);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);
    decorateDiffRanges(root, []);

    const paragraph = root.querySelector<HTMLElement>("p")!;
    expect(paragraph.querySelector(".emr-diff-line-wash")).toBeNull();
    expect(paragraph.innerHTML).toBe("Keep <em>this markup</em>.");
    expect(paragraph.dataset.diffLineWash).toBeUndefined();
  });
});

describe("stripMermaidFence", () => {
  it("strips a triple-backtick mermaid fence", () => {
    expect(stripMermaidFence("```mermaid\nflowchart LR\n  a --> b\n```")).toBe(
      "flowchart LR\n  a --> b",
    );
  });

  it("strips an Azure DevOps colon fence", () => {
    expect(stripMermaidFence(":::mermaid\nsequenceDiagram\n:::")).toBe(
      "sequenceDiagram",
    );
  });

  it("returns the text unchanged when there is no mermaid fence", () => {
    expect(stripMermaidFence("flowchart LR\n  a --> b")).toBe(
      "flowchart LR\n  a --> b",
    );
  });

  it("returns empty string for an empty fence", () => {
    expect(stripMermaidFence("```mermaid\n```")).toBe("");
  });

  it("strips only the opening fence when the block is unterminated", () => {
    expect(stripMermaidFence("```mermaid\nflowchart LR")).toBe("flowchart LR");
  });
});

describe("decorateDiffRanges — direct images", () => {
  it("marks a direct image with the minimal media class and clears it", () => {
    const root = makeRoot([{ tag: "img", start: 4, end: 4, html: "" }]);
    const image = root.querySelector<HTMLImageElement>("img")!;

    const result = decorateDiffRanges(root, [
      { startLine: 4, endLine: 4, kind: "added" },
    ]);
    expect(result.decorated).toBe(1);
    expect(image.classList.contains(DIFF_IMAGE_CLASS)).toBe(true);

    decorateDiffRanges(root, []);
    expect(image.classList.contains(DIFF_IMAGE_CLASS)).toBe(false);
    expect(image.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });
});

describe("decorateDiffRanges — mermaid diagrams", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function mermaidRoot(start: number, end: number): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const div = document.createElement("div");
    div.className = "emr-mermaid";
    div.setAttribute("data-source-line", String(start));
    div.setAttribute("data-source-end-line", String(end));
    div.setAttribute("data-mermaid-src", encodeURIComponent("flowchart LR"));
    root.appendChild(div);
    return root;
  }

  it("marks a changed diagram with the mermaid diff class + kind (no wash)", () => {
    const root = mermaidRoot(5, 8);
    const res = decorateDiffRanges(root, [
      { startLine: 5, endLine: 8, kind: "modified" },
    ]);
    expect(res.decorated).toBe(1);
    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    expect(el.classList.contains(DIFF_MERMAID_CLASS)).toBe(true);
    expect(el.classList.contains("emr-diff-block--modified")).toBe(true);
    expect(el.dataset.diffKind).toBe("modified");
  });

  it("stashes the original diagram source when the range covers the block", () => {
    const root = mermaidRoot(5, 8);
    decorateDiffRanges(root, [
      {
        startLine: 5,
        endLine: 8,
        kind: "modified",
        originalText: "```mermaid\nflowchart TB\n  x --> y\n```",
      },
    ]);
    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.dataset.diffOriginal).toBe("flowchart TB\n  x --> y");
  });

  it("does NOT stash original when the range only partly covers the block", () => {
    const root = mermaidRoot(5, 8);
    decorateDiffRanges(root, [
      {
        startLine: 6,
        endLine: 6,
        kind: "modified",
        originalText: "  x --> y",
      },
    ]);
    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.dataset.diffOriginal).toBeUndefined();
    // Still bar-marked as changed.
    expect(el.classList.contains(DIFF_MERMAID_CLASS)).toBe(true);
  });

  it("leaves an unchanged diagram untouched", () => {
    const root = mermaidRoot(5, 8);
    const res = decorateDiffRanges(root, [
      { startLine: 20, endLine: 20, kind: "added" },
    ]);
    expect(res.decorated).toBe(0);
    expect(
      root.querySelector(".emr-mermaid")?.classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
  });

  it("marks a wholly-added diagram green", () => {
    const root = mermaidRoot(5, 8);
    const res = decorateDiffRanges(root, [
      { startLine: 5, endLine: 8, kind: "added" },
    ]);
    expect(res.decorated).toBe(1);
    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.classList.contains("emr-diff-block--added")).toBe(true);
    expect(el.dataset.diffKind).toBe("added");
    // No original to stash for a pure add.
    expect(el.dataset.diffOriginal).toBeUndefined();
  });

  it("ignores a diagram with no source-line attributes", () => {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const div = document.createElement("div");
    div.className = "emr-mermaid";
    div.setAttribute("data-mermaid-src", encodeURIComponent("flowchart LR"));
    root.appendChild(div);
    const res = decorateDiffRanges(root, [
      { startLine: 1, endLine: 1, kind: "modified" },
    ]);
    expect(res.decorated).toBe(0);
    expect(div.classList.contains(DIFF_MERMAID_CLASS)).toBe(false);
  });

  it("does not double-decorate a diagram nested in a decorated block", () => {
    // A mermaid inside an already-decorated block is skipped (the outer block
    // owns the decoration).
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    const quote = document.createElement("blockquote");
    quote.setAttribute("data-source-line", "5");
    quote.setAttribute("data-source-end-line", "9");
    const inner = document.createElement("div");
    inner.className = "emr-mermaid";
    inner.setAttribute("data-source-line", "6");
    inner.setAttribute("data-source-end-line", "8");
    inner.setAttribute("data-mermaid-src", encodeURIComponent("flowchart LR"));
    quote.appendChild(inner);
    root.appendChild(quote);
    decorateDiffRanges(root, [{ startLine: 5, endLine: 9, kind: "modified" }]);
    expect(inner.classList.contains(DIFF_MERMAID_CLASS)).toBe(false);
  });

  it("does not stash an empty original (fence-only) but still marks the diagram", () => {
    const root = mermaidRoot(5, 8);
    decorateDiffRanges(root, [
      {
        startLine: 5,
        endLine: 8,
        kind: "modified",
        originalText: "```mermaid\n```",
      },
    ]);
    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.dataset.diffOriginal).toBeUndefined();
    expect(el.classList.contains(DIFF_MERMAID_CLASS)).toBe(true);
  });

  it("clears the mermaid diff class + original on re-decorate", () => {
    const root = mermaidRoot(5, 8);
    decorateDiffRanges(root, [
      {
        startLine: 5,
        endLine: 8,
        kind: "modified",
        originalText: "```mermaid\nflowchart TB\n```",
      },
    ]);
    expect(
      root
        .querySelector(".emr-mermaid")
        ?.classList.contains(DIFF_MERMAID_CLASS),
    ).toBe(true);
    decorateDiffRanges(root, []);
    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.classList.contains(DIFF_MERMAID_CLASS)).toBe(false);
    expect(el.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(el.dataset.diffOriginal).toBeUndefined();
  });
});

describe("selectionTouchesDeletedDiff", () => {
  function setup() {
    const root = makeRoot([{ tag: "p", start: 5, end: 5, html: "live text" }]);
    decorateDiffRanges(
      root,
      [
        {
          startLine: 5,
          endLine: 5,
          kind: "deleted-marker",
          linesDeleted: 1,
          deletedContent: "removed sentence\n",
        },
      ],
      { renderInline: stubRender },
    );
    const outEl = [...root.children].find(
      (c) => c.tagName === "P",
    ) as HTMLElement;
    const body = root.querySelector<HTMLElement>(".emr-diff-deleted-body")!;
    return {
      outEl,
      outText: outEl.firstChild,
      inText: body.querySelector("p")!.firstChild,
    };
  }

  it("is true when the anchor endpoint is inside a deletion marker", () => {
    const { inText, outText } = setup();
    expect(selectionTouchesDeletedDiff(inText, outText)).toBe(true);
  });

  it("is true when only the focus endpoint is inside a deletion marker", () => {
    const { outEl, inText } = setup();
    expect(selectionTouchesDeletedDiff(outEl, inText)).toBe(true);
  });

  it("is false when neither endpoint is inside a deletion marker", () => {
    const { outEl, outText } = setup();
    expect(selectionTouchesDeletedDiff(outEl, outText)).toBe(false);
    expect(selectionTouchesDeletedDiff(null, null)).toBe(false);
  });

  it("is false when only one endpoint is present", () => {
    const { outEl, outText } = setup();
    // A lone endpoint outside every marker can't span or sit in removed
    // content; each guard side must independently bail out.
    expect(selectionTouchesDeletedDiff(null, outText)).toBe(false);
    expect(selectionTouchesDeletedDiff(outEl, null)).toBe(false);
  });

  /**
   * Build `[pBefore, marker, pAfter]` so a selection can span across the
   * deletion marker with both endpoints in live paragraphs on either side.
   */
  function setupSpanning() {
    const root = makeRoot([
      { tag: "p", start: 5, end: 5, html: "before text" },
      { tag: "p", start: 10, end: 10, html: "after text" },
    ]);
    decorateDiffRanges(
      root,
      [
        {
          startLine: 10,
          endLine: 10,
          kind: "deleted-marker",
          linesDeleted: 1,
          deletedContent: "removed sentence\n",
        },
      ],
      { renderInline: stubRender },
    );
    const paras = [...root.querySelectorAll("p")].filter(
      (p) => !p.closest(`.${DIFF_DELETED_MARKER_CLASS}`),
    );
    return {
      beforeText: paras[0].firstChild,
      afterText: paras[1].firstChild,
    };
  }

  it("is true when the selection spans across a deletion marker", () => {
    const { beforeText, afterText } = setupSpanning();
    // Both endpoints sit in live paragraphs on either side of the marker.
    expect(selectionTouchesDeletedDiff(beforeText, afterText)).toBe(true);
  });

  it("is true regardless of anchor/focus order when spanning a marker", () => {
    const { beforeText, afterText } = setupSpanning();
    // Reverse (backwards) selection: focus precedes anchor.
    expect(selectionTouchesDeletedDiff(afterText, beforeText)).toBe(true);
  });
});
