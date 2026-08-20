import { describe, it, expect, beforeEach } from "vitest";
import {
  applyInlineWordDiff,
  WORD_ADDED_CLASS,
  WORD_REMOVED_CLASS,
  WORD_REMOVED_TIGHT_CLASS,
} from "../src/markdown/wordDiffDom";
import { diffWords } from "../src/markdown/wordDiff";

function block(html: string): HTMLElement {
  const p = document.createElement("p");
  p.innerHTML = html;
  document.body.appendChild(p);
  return p;
}

/** The visible text a reader sees (ins kept, del kept — both are rendered). */
function marks(el: HTMLElement) {
  return {
    added: Array.from(el.querySelectorAll(`.${WORD_ADDED_CLASS}`)).map(
      (n) => n.textContent,
    ),
    removed: Array.from(el.querySelectorAll(`.${WORD_REMOVED_CLASS}`)).map(
      (n) => n.textContent,
    ),
  };
}

/** Text with removed marks stripped = the current (modified) reading. */
function modifiedText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${WORD_REMOVED_CLASS}`).forEach((n) => n.remove());
  return clone.textContent ?? "";
}

describe("applyInlineWordDiff", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps a single added word in an <ins>", () => {
    const el = block("hello world");
    const ops = diffWords("hello", "hello world");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    expect(res!.added).toBeGreaterThan(0);
    const m = marks(el);
    expect(m.added.join("")).toContain("world");
    // The modified reading is intact.
    expect(modifiedText(el)).toBe("hello world");
  });

  it("splices a removed word back in as a <del>", () => {
    const el = block("hello");
    const ops = diffWords("hello world", "hello");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    expect(res!.removed).toBeGreaterThan(0);
    const m = marks(el);
    expect(m.removed.join("")).toContain("world");
    // Stripping the del leaves the current text.
    expect(modifiedText(el)).toBe("hello");
  });

  it("shows a replaced word as removed-then-added in order", () => {
    const el = block("The quick red fox");
    const ops = diffWords("The quick brown fox", "The quick red fox");
    applyInlineWordDiff(el, ops);
    const m = marks(el);
    expect(m.removed.join("")).toContain("brown");
    expect(m.added.join("")).toContain("red");
    // In document order the del precedes the ins (was → now).
    const delEl = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
    const insEl = el.querySelector(`.${WORD_ADDED_CLASS}`)!;
    expect(
      delEl.compareDocumentPosition(insEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(modifiedText(el)).toBe("The quick red fox");
  });

  it("preserves inline formatting on unchanged words", () => {
    // "important" is bold and unchanged; only "note" was added.
    const el = block("This <strong>important</strong> note");
    const ops = diffWords("This important", "This important note");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    // The <strong> survives.
    expect(el.querySelector("strong")?.textContent).toBe("important");
    expect(marks(el).added.join("")).toContain("note");
    expect(modifiedText(el)).toBe("This important note");
  });

  it("preserves an existing comment-anchor highlight span", () => {
    const el = block(
      'Keep <span class="emr-highlight" data-thread-id="t1">this</span> words',
    );
    // Only "word" → "words" changes; the anchored "this" is untouched.
    const ops = diffWords("Keep this word", "Keep this words");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    const anchor = el.querySelector(".emr-highlight");
    expect(anchor?.getAttribute("data-thread-id")).toBe("t1");
    expect(anchor?.textContent).toBe("this");
  });

  it("returns null (no mutation) when ops don't reconstruct the text", () => {
    const el = block("actual text here");
    const before = el.innerHTML;
    // ops for a DIFFERENT modified string.
    const ops = diffWords("something", "something else");
    const res = applyInlineWordDiff(el, ops);
    expect(res).toBeNull();
    expect(el.innerHTML).toBe(before);
  });

  it("handles a change spanning two text nodes / elements", () => {
    // "two"→"three"; the modified block already renders "three" in <em>.
    const el = block("one <em>three</em> end");
    const ops = diffWords("one two end", "one three end");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    expect(marks(el).removed.join("")).toContain("two");
    expect(marks(el).added.join("")).toContain("three");
    expect(modifiedText(el)).toBe("one three end");
  });

  it("no-ops (zero marks) when text is identical", () => {
    const el = block("unchanged text");
    const ops = diffWords("unchanged text", "unchanged text");
    const res = applyInlineWordDiff(el, ops);
    expect(res).toEqual({ added: 0, removed: 0 });
    expect(el.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    expect(el.querySelector(`.${WORD_REMOVED_CLASS}`)).toBeNull();
  });

  it("appends a trailing removal at the very end of the block", () => {
    const el = block("keep");
    const ops = diffWords("keep gone", "keep");
    const res = applyInlineWordDiff(el, ops);
    expect(res!.removed).toBeGreaterThan(0);
    // The del is the last child and carries the removed tail.
    const last = el.lastElementChild;
    expect(last?.classList.contains(WORD_REMOVED_CLASS)).toBe(true);
    expect(last?.textContent).toContain("gone");
    expect(modifiedText(el)).toBe("keep");
  });

  it("marks multiple separate edits in one block", () => {
    const el = block("alpha two gamma four");
    const ops = diffWords("alpha 2 gamma 4", "alpha two gamma four");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    expect(marks(el).added.join(" ")).toContain("two");
    expect(marks(el).added.join(" ")).toContain("four");
    expect(marks(el).removed.join(" ")).toContain("2");
    expect(marks(el).removed.join(" ")).toContain("4");
    expect(modifiedText(el)).toBe("alpha two gamma four");
  });

  it("ignores empty text nodes when flattening", () => {
    const el = block("hello world");
    // Inject an empty text node (as can occur after DOM splits) — the walker
    // must skip it without shifting offsets.
    el.appendChild(document.createTextNode(""));
    const ops = diffWords("hello", "hello world");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    expect(marks(el).added.join("")).toContain("world");
    expect(modifiedText(el)).toBe("hello world");
  });

  // A strikethrough sits at x-height centre, so on a glyph with no ink there —
  // a lone comma, period, dash, or a merged space — it floats above as a
  // detached dash. Those removals get the "tight" modifier so the styles can
  // drop the strike; real words (which the strike crosses cleanly) do not.
  it("marks a punctuation-only removal 'tight'", () => {
    const el = block("Monday Tuesday");
    const ops = diffWords("Monday, Tuesday", "Monday Tuesday");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    const del = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
    expect(del.textContent).toBe(",");
    expect(del.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(true);
  });

  it("marks a merged whitespace / dash-only removal 'tight'", () => {
    const el = block("fast and simple");
    const ops = diffWords("fast — and simple", "fast and simple");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    const del = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
    // The removed run is punctuation + whitespace only (no letters/digits).
    expect(/[\p{L}\p{N}]/u.test(del.textContent ?? "")).toBe(false);
    expect(del.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(true);
  });

  it("does NOT mark a word removal 'tight' (keeps the strikethrough)", () => {
    const el = block("the brown fox");
    const ops = diffWords("the quick brown fox", "the brown fox");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    const del = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
    expect(del.textContent).toContain("quick");
    expect(del.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(false);
  });

  it("keeps the strike when a removed run mixes a word and punctuation", () => {
    // "quick," removed as one run — it has letters, so the strike reads fine.
    const el = block("the brown fox");
    const ops = diffWords("the quick, brown fox", "the brown fox");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    const del = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
    expect(del.textContent).toContain("quick");
    expect(del.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(false);
  });

  it("does NOT mark a digit-only removal 'tight' (digits have ink)", () => {
    // A removed number keeps its strikethrough — digits sit at strike height,
    // so the strike crosses them cleanly (guards the \p{N} half of the rule).
    const el = block("scale to nodes");
    const ops = diffWords("scale to 100 nodes", "scale to nodes");
    const res = applyInlineWordDiff(el, ops);
    expect(res).not.toBeNull();
    const del = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
    expect(del.textContent).toContain("100");
    expect(del.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(false);
  });

  it("marks a trailing punctuation-only removal 'tight'", () => {
    const el = block("done");
    const ops = diffWords("done.", "done");
    const res = applyInlineWordDiff(el, ops);
    expect(res!.removed).toBeGreaterThan(0);
    const last = el.lastElementChild!;
    expect(last.textContent).toBe(".");
    expect(last.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(true);
  });
});
