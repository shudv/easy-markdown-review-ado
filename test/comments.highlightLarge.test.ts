// Regression: large / complex selections (tables, code blocks, multi-block
// prose) must NOT produce whitespace-only highlight slivers or inject stray
// spans into table structure — those are what visibly break Markdown rendering
// (the yellow vertical bars) on big selections.
//
// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { renderMarkdownSync } from "../src/markdown/render";
import { wrapRangeWithHighlight } from "../src/comments/highlight";

function mount(md: string): HTMLElement {
  const root = document.createElement("article");
  root.className = "markdown-body emr-rendered";
  root.innerHTML = renderMarkdownSync(md);
  document.body.appendChild(root);
  return root;
}

/** Build a range from the first occurrence of `from` to the end of `to`. */
function rangeOverText(root: Element, from: string, to: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  let n: Node | null = walker.nextNode();
  while (n) {
    const t = n as Text;
    if (!startNode && t.data.includes(from)) {
      startNode = t;
      startOff = t.data.indexOf(from);
    }
    if (startNode && t.data.includes(to)) {
      endNode = t;
      endOff = t.data.indexOf(to) + to.length;
    }
    n = walker.nextNode();
  }
  const r = document.createRange();
  r.setStart(startNode!, startOff);
  r.setEnd(endNode!, endOff);
  return r;
}

const whitespaceOnly = (spans: HTMLSpanElement[]): HTMLSpanElement[] =>
  spans.filter((s) => !(s.textContent ?? "").trim());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("large selection highlight wrapping", () => {
  it("table selection: no whitespace slivers, structure intact, cells highlighted", () => {
    const md = [
      "| Parameter | Type | Description |",
      "|-----------|------|-------------|",
      "| status | enum | active, abandoned, completed |",
      "| sourceRefName | string | refs/heads/main |",
    ].join("\n");
    const root = mount(md);
    const cellsBefore = root.querySelectorAll("th,td").length;

    const range = rangeOverText(root, "status", "string");
    const spans = wrapRangeWithHighlight(range, {
      className: "emr-highlight",
      threadId: "t1",
    });

    // No whitespace-only slivers (these were the yellow bars).
    expect(whitespaceOnly(spans)).toHaveLength(0);
    // Table structure is preserved — no cells lost, no stray spans hoisted
    // into <tr>/<table> (every highlight span lives inside a cell).
    expect(root.querySelectorAll("th,td").length).toBe(cellsBefore);
    for (const s of spans) {
      expect(
        s.closest("td, th"),
        "highlight span must sit inside a cell",
      ).not.toBeNull();
    }
    // The real cell contents are highlighted.
    const texts = spans.map((s) => s.textContent);
    expect(texts).toContain("status");
    expect(texts).toContain("enum");
    expect(texts).toContain("string");
  });

  it("code-block selection: highlights the code without slivers", () => {
    const md = ["```ts", "const a = 1;", "const b = 2;", "```"].join("\n");
    const root = mount(md);
    const range = rangeOverText(root, "const a", "b = 2;");
    const spans = wrapRangeWithHighlight(range, {
      className: "emr-highlight",
      threadId: "t2",
    });
    expect(spans.length).toBeGreaterThan(0);
    expect(whitespaceOnly(spans)).toHaveLength(0);
    // The <pre><code> block is preserved.
    expect(root.querySelector("pre code")).not.toBeNull();
  });

  it("multi-paragraph + blockquote selection: no slivers, each block highlighted", () => {
    const md = [
      "First paragraph of prose here.",
      "",
      "> A quoted line inside a blockquote.",
      "",
      "Second paragraph after the quote.",
    ].join("\n");
    const root = mount(md);
    const range = rangeOverText(root, "First", "Second");
    const spans = wrapRangeWithHighlight(range, {
      className: "emr-highlight",
      threadId: "t3",
    });
    expect(whitespaceOnly(spans)).toHaveLength(0);
    const joined = spans.map((s) => s.textContent).join(" ");
    expect(joined).toContain("First paragraph");
    expect(joined).toContain("quoted line");
    expect(joined).toContain("Second");
    // The blockquote element survived the wrap.
    expect(root.querySelector("blockquote")).not.toBeNull();
  });

  it("selecting only whitespace between blocks wraps nothing", () => {
    const md = ["Alpha paragraph.", "", "Beta paragraph."].join("\n");
    const root = mount(md);
    // Range from end of "Alpha paragraph." to start of "Beta" spans only the
    // inter-block whitespace text node(s).
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let alpha: Text | null = null;
    let beta: Text | null = null;
    let n: Node | null = walker.nextNode();
    while (n) {
      const t = n as Text;
      if (t.data.includes("Alpha")) alpha = t;
      if (t.data.includes("Beta")) beta = t;
      n = walker.nextNode();
    }
    const r = document.createRange();
    r.setStart(alpha!, alpha!.data.length); // just after "…paragraph."
    r.setEnd(beta!, 0); // just before "Beta"
    const spans = wrapRangeWithHighlight(r, {
      className: "emr-highlight",
      threadId: "t4",
    });
    expect(spans).toHaveLength(0);
  });
});
