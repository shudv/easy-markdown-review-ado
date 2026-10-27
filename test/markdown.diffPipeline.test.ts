import { describe, it, expect } from "vitest";
import { renderMarkdownSync } from "../src/markdown/render";
import { decorateDiffRanges } from "../src/markdown/diffDecorations";
import { refineDiffRanges } from "../src/markdown/diffRefine";
import { sourceDiffRanges } from "../src/shell/prShellHelpers";

// End-to-end diff quality: each case feeds an original and a current Markdown
// source through the production pipeline — the line diff, block refinement,
// rendering and decoration — and reads back what a reviewer would see, one
// line per decorated block or marker:
//
//   `p modified inline: The quick {+brown +}fox.`
//
// `{+…+}` is an added run, `[-…-]` a removed run, `⟨…⟩` a precise amber
// explanation, `wash` a whole-block tint and `Before` a previous-version
// disclosure. Undecorated blocks are omitted, so an empty list means the edit
// is (correctly) invisible.

const lines = (...source: string[]) => source.join("\n");

/** Text of `node` with diff marks annotated and nested blocks left out. */
function annotate(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const cls = node.classList;
  if (
    cls.contains("emr-diff-before-panel") ||
    cls.contains("emr-diff-metadata-panel")
  ) {
    return "";
  }
  if (cls.contains("emr-diff-before-control")) return "Before ";
  if (cls.contains("emr-diff-metadata")) {
    const trigger = node.querySelector(".emr-diff-metadata-trigger")!;
    return ` ⟨${trigger.getAttribute("aria-label") ?? trigger.textContent}⟩`;
  }
  if (cls.contains("emr-word-added")) return `{+${node.textContent}+}`;
  if (cls.contains("emr-word-removed")) return `[-${node.textContent}-]`;
  if (node.dataset.diffKind && node.dataset.summarized !== "self") return "";
  if (
    ["UL", "OL", "TABLE", "PRE"].includes(node.tagName) &&
    node.hasAttribute("data-source-line") &&
    node.dataset.summarized !== "self"
  ) {
    return "";
  }
  const inner = Array.from(node.childNodes).map(annotate).join("");
  const tip = node.dataset.diffTooltip;
  return tip && node.dataset.summarized !== "self" ? `⟨${tip}⟩${inner}` : inner;
}

function summarize(root: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (el: Element): void => {
    if (!(el instanceof HTMLElement)) return;
    if (el.classList.contains("emr-diff-deleted-marker")) {
      out.push(`deleted: ${el.getAttribute("aria-label")}`);
      return;
    }
    if (el.classList.contains("emr-diff-source-only")) {
      out.push("source-only");
      return;
    }
    if (el.dataset.diffKind) {
      el.dataset.summarized = "self";
      const flags = [
        el.dataset.diffInline === "true" ? "inline" : "",
        el.dataset.diffCells === "true" ? "cells" : "",
        el.dataset.diffLineWash === "true" ? "wash" : "",
      ].filter(Boolean);
      const tip = el.dataset.diffTooltip ? ` ⟨${el.dataset.diffTooltip}⟩` : "";
      const text = annotate(el).replace(/\s+/g, " ").trim();
      delete el.dataset.summarized;
      out.push(
        `${el.tagName.toLowerCase()} ${[el.dataset.diffKind, ...flags].join(" ")}${tip}: ${text}`,
      );
    }
    Array.from(el.children).forEach(walk);
  };
  Array.from(root.children).forEach(walk);
  return out;
}

function diffView(original: string, current: string) {
  const ranges = refineDiffRanges(
    sourceDiffRanges(original, current),
    original,
    current,
  );
  const root = document.createElement("div");
  root.className = "markdown-body emr-rendered";
  root.innerHTML = renderMarkdownSync(current);
  const result = decorateDiffRanges(root, ranges, {
    renderInline: renderMarkdownSync,
    originalSource: original,
    currentSource: current,
  });
  return { view: summarize(root), result, root };
}

const view = (original: string, current: string) =>
  diffView(original, current).view;

describe("lines added to or removed from inside an existing block", () => {
  it("shows a line appended to a paragraph as an edit, not a new paragraph", () => {
    expect(
      view(
        lines("Sentence one.", "Sentence two.", "", "Next."),
        lines("Sentence one.", "Sentence two.", "Sentence three.", "", "Next."),
      ),
    ).toEqual([
      "p modified inline: Sentence one. Sentence two.{+ Sentence three.+}",
    ]);
  });

  it("shows a line prepended to a paragraph inline", () => {
    expect(
      view(
        lines("Sentence one.", "Sentence two."),
        lines("Sentence zero.", "Sentence one.", "Sentence two."),
      ),
    ).toEqual([
      "p modified inline: {+Sentence zero. +}Sentence one. Sentence two.",
    ]);
  });

  it("shows a line inserted mid-paragraph inline", () => {
    expect(
      view(
        lines("Sentence one.", "Sentence two."),
        lines("Sentence one.", "Inserted line.", "Sentence two."),
      ),
    ).toEqual([
      "p modified inline: Sentence one. {+Inserted line. +}Sentence two.",
    ]);
  });

  it("shows a line removed mid-paragraph inside it, with no marker", () => {
    const { view: result, result: counts } = diffView(
      lines("Sentence one.", "Sentence two.", "Sentence three.", "", "Next."),
      lines("Sentence one.", "Sentence three.", "", "Next."),
    );
    expect(result).toEqual([
      "p modified inline: Sentence one. [-Sentence two. -]Sentence three.",
    ]);
    expect(counts.markers).toBe(0);
  });

  it("shows a line added to a code block inline", () => {
    expect(
      view(
        lines("```js", "a();", "c();", "```"),
        lines("```js", "a();", "b();", "c();", "```"),
      ),
    ).toEqual(["pre modified inline: a(); {+b(); +}c();"]);
  });

  it("shows a line appended to a code block inline", () => {
    expect(
      view(
        lines("```js", "const a = 1;", "```"),
        lines("```js", "const a = 1;", "const b = 2;", "```"),
      ),
    ).toEqual(["pre modified inline: const a = 1; {+const b = 2; +}"]);
  });

  it("shows a line removed from a code block inside it", () => {
    const { view: result, result: counts } = diffView(
      lines("```js", "a();", "b();", "c();", "```"),
      lines("```js", "a();", "c();", "```"),
    );
    expect(result).toEqual(["pre modified inline: a(); [-b(); -]c();"]);
    expect(counts.markers).toBe(0);
  });

  it("shows a blank line added to a code block as an edit", () => {
    expect(
      view(lines("```", "a", "b", "```"), lines("```", "a", "", "b", "```")),
    ).toEqual(["pre modified inline: a {+ +}b"]);
  });

  it("shows a lazy continuation added to a list item inline", () => {
    expect(
      view(
        lines("- item one", "- item two"),
        lines("- item one", "  continued", "- item two"),
      ),
    ).toEqual(["li modified inline: item one{+ continued+}"]);
  });

  it("shows a line added to a quote inline", () => {
    expect(
      view(
        lines("> Line one.", "", "After."),
        lines("> Line one.", "> Line two.", "", "After."),
      ),
    ).toEqual(["blockquote modified inline: Line one.{+ Line two.+}"]);
  });

  it("shows a line added to a display equation as an edit", () => {
    const { view: result, root } = diffView(
      lines("$$", "a + b", "$$"),
      lines("$$", "a + b", "+ c", "$$"),
    );
    expect(result).toEqual(["div modified: a + b + c"]);
    expect(
      root.querySelector<HTMLElement>(".emr-math")!.dataset.diffOriginal,
    ).toBe("a + b");
  });

  it("shows a line added to a Mermaid diagram as an edit with its source", () => {
    const { root } = diffView(
      lines("```mermaid", "graph TD", "A-->B", "```"),
      lines("```mermaid", "graph TD", "A-->B", "B-->C", "```"),
    );
    const diagram = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(diagram.dataset.diffKind).toBe("modified");
    expect(diagram.dataset.diffOriginal).toBe("graph TD\nA-->B");
  });

  it("still shows a wholly new paragraph as added", () => {
    expect(
      view(
        lines("A para.", "", "C para."),
        lines("A para.", "", "B para.", "", "C para."),
      ),
    ).toEqual(["p added wash: B para."]);
  });

  it("still shows a wholly new code block as added", () => {
    expect(
      view(
        lines("Text.", "", "More."),
        lines("Text.", "", "```sh", "npm i", "```", "", "More."),
      ),
    ).toEqual(["pre added wash: npm i"]);
  });

  it("keeps a marker when the removed line had split the paragraph in two", () => {
    expect(
      view(lines("Alpha.", "# Heading", "Beta."), lines("Alpha.", "Beta.")),
    ).toEqual(["deleted: 1 line removed"]);
  });

  it("keeps a marker when the removed lines had no recoverable content", () => {
    const current = lines("Sentence one.", "Sentence three.");
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(current);
    const result = decorateDiffRanges(
      root,
      [{ startLine: 2, endLine: 2, kind: "deleted-marker", linesDeleted: 1 }],
      { renderInline: renderMarkdownSync, currentSource: current },
    );
    expect(result).toEqual({ decorated: 0, markers: 1, inlined: 0 });
  });

  it("leaves an edit spanning past the block to the existing paths", () => {
    const current = lines("Sentence one.", "Sentence two.", "Sentence three.");
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(current);
    decorateDiffRanges(
      root,
      [
        { startLine: 2, endLine: 2, kind: "added" },
        {
          startLine: 3,
          endLine: 4,
          kind: "modified",
          originalText: "Old three.\nOld four.",
        },
      ],
      { renderInline: renderMarkdownSync, currentSource: current },
    );
    expect(root.querySelector("p")!.dataset.diffInline).toBeUndefined();
  });

  it("leaves a modified line without original text to the existing paths", () => {
    const current = lines("Sentence one.", "Sentence two.", "Sentence three.");
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(current);
    decorateDiffRanges(
      root,
      [
        { startLine: 1, endLine: 1, kind: "added" },
        { startLine: 2, endLine: 2, kind: "modified" },
      ],
      { renderInline: renderMarkdownSync, currentSource: current },
    );
    expect(root.querySelector("p")!.dataset.diffInline).toBeUndefined();
  });

  it("shows an edited and an added line in one paragraph together", () => {
    expect(
      view(
        lines("Sentence one.", "Sentence two.", "", "Next."),
        lines("Sentence uno.", "Sentence two.", "Sentence three.", "", "Next."),
      ),
    ).toEqual([
      "p modified inline: Sentence [-one-]{+uno+}. Sentence two.{+ Sentence three.+}",
    ]);
  });

  it("rebuilds a block holding both a separate edit and an addition", () => {
    const current = lines(
      "Alpha uno is here.",
      "Beta stays exactly the same.",
      "Gamma three is new",
    );
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(current);
    decorateDiffRanges(
      root,
      [
        {
          startLine: 1,
          endLine: 2,
          kind: "modified",
          originalText: "Alpha one is here.\nBeta stays exactly the same.",
          originalStartLine: 1,
          originalEndLine: 2,
        },
        { startLine: 3, endLine: 3, kind: "added" },
      ],
      { renderInline: renderMarkdownSync, currentSource: current },
    );
    expect(summarize(root)).toEqual([
      "p modified inline: Alpha [-one-]{+uno+} is here. Beta stays exactly the same.{+ Gamma three is new+}",
    ]);
  });

  it("shows a line removed from a Mermaid diagram as an edit with its source", () => {
    const { root, result } = diffView(
      lines("```mermaid", "graph TD", "A-->B", "B-->C", "```"),
      lines("```mermaid", "graph TD", "B-->C", "```"),
    );
    const diagram = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(diagram.dataset.diffKind).toBe("modified");
    expect(diagram.dataset.diffOriginal).toBe("graph TD\nA-->B\nB-->C");
    expect(result.markers).toBe(0);
  });

  it("keeps a marker when the removed line was a separate list item", () => {
    expect(
      view(
        lines("- item one", "- item gone", "  continued"),
        lines("- item one", "  continued"),
      ),
    ).toEqual(["deleted: 1 line removed"]);
  });

  it("ignores a current source too short for the rendered block", () => {
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(lines("One.", "Two."));
    decorateDiffRanges(root, [{ startLine: 1, endLine: 1, kind: "added" }], {
      renderInline: renderMarkdownSync,
      currentSource: "One.",
    });
    expect(root.querySelector("p")!.dataset.diffKind).toBe("added");
  });
});

describe("containers own only their lead content", () => {
  it("does not paint a quote's unchanged lead when a paragraph is added", () => {
    expect(
      view(
        lines("> Line one.", "", "After."),
        lines("> Line one.", ">", "> Line two.", "", "After."),
      ),
    ).toEqual(["p added wash: Line two."]);
  });

  it("does not paint a list item's unchanged lead when a paragraph is added", () => {
    expect(
      view(
        lines("- one", "- two"),
        lines("- one", "", "  more one", "", "- two"),
      ),
    ).toEqual(["p added wash: more one"]);
  });
});

describe("blocks nested in quotes and list items", () => {
  it("diffs a nested quote without stray line-break marks", () => {
    expect(
      view(
        lines("> outer", ">", "> > inner old", "", "x"),
        lines("> outer", ">", "> > inner new", "", "x"),
      ),
    ).toEqual(["blockquote modified inline: inner [-old-]{+new+}"]);
  });

  it("diffs a heading inside a quote without stray line-break marks", () => {
    expect(
      view(
        lines("> ## Old heading", ">", "> body"),
        lines("> ## New heading", ">", "> body"),
      ),
    ).toEqual(["h2 modified inline: [-Old-]{+New+} heading"]);
  });

  it("diffs a four-space-indented list paragraph as prose, not code", () => {
    expect(
      view(
        lines(
          "1. Step one",
          "",
          "    Details about the old thing.",
          "",
          "2. Step two",
        ),
        lines(
          "1. Step one",
          "",
          "    Details about the new thing.",
          "",
          "2. Step two",
        ),
      ),
    ).toEqual(["p modified inline: Details about the [-old-]{+new+} thing."]);
  });

  it("never leaks Markdown syntax from an indented list paragraph", () => {
    expect(
      view(
        lines("- a", "", "    **Note:** old value", ""),
        lines("- a", "", "    **Note:** new value", ""),
      ),
    ).toEqual(["p modified inline: Note: [-old-]{+new+} value"]);
  });

  it("diffs a fenced block in a list item without a bogus language change", () => {
    expect(
      view(
        lines(
          "1. Step one",
          "",
          "    ```sh",
          "    npm install old",
          "    ```",
          "",
          "2. Step two",
        ),
        lines(
          "1. Step one",
          "",
          "    ```sh",
          "    npm install new",
          "    ```",
          "",
          "2. Step two",
        ),
      ),
    ).toEqual(["pre modified inline: npm install [-old-]{+new+}"]);
  });

  it("diffs an indented code block in a list item as code", () => {
    expect(
      view(
        lines("1. Step one", "", "       old code", "", "2. Step two"),
        lines("1. Step one", "", "       new code", "", "2. Step two"),
      ),
    ).toEqual(["pre modified inline: [-old-]{+new+} code"]);
  });

  it("diffs a quote in a list item without leaking its marker", () => {
    expect(
      view(
        lines(
          "1. Step one",
          "",
          "    > Quoted old text here.",
          "",
          "2. Step two",
        ),
        lines(
          "1. Step one",
          "",
          "    > Quoted new text here.",
          "",
          "2. Step two",
        ),
      ),
    ).toEqual(["blockquote modified inline: Quoted [-old-]{+new+} text here."]);
  });

  it("hides a re-wrapped paragraph inside a quote", () => {
    expect(
      view(
        lines("> lead", ">", "> one two three", "> four"),
        lines("> lead", ">", "> one two", "> three four"),
      ),
    ).toEqual([]);
  });

  it("diffs a quoted paragraph that ends in a lazy continuation line", () => {
    expect(
      view(
        lines("> lead", ">", "> para old", "lazy tail"),
        lines("> lead", ">", "> para new", "lazy tail"),
      ),
    ).toEqual(["p modified inline: para [-old-]{+new+} lazy tail"]);
  });

  it("diffs a deeply nested list item", () => {
    expect(
      view(
        lines("- a", "  - b", "    - c old text", "- d"),
        lines("- a", "  - b", "    - c new text", "- d"),
      ),
    ).toEqual(["li modified inline: c [-old-]{+new+} text"]);
  });
});

describe("list item structure", () => {
  it("keeps a checkbox toggle visible when the item text also changed", () => {
    expect(
      view(
        lines("- [ ] write tests", "- [ ] ship"),
        lines("- [x] write unit tests", "- [ ] ship"),
      ),
    ).toEqual([
      "li modified inline: ⟨Checklist item changed from unchecked to checked⟩ write {+unit +}tests",
    ]);
  });

  it("keeps a marker change visible when the item text also changed", () => {
    expect(
      view(
        lines("1. do thing", "2. other"),
        lines("- do the thing", "- other"),
      ),
    ).toEqual([
      "li modified inline ⟨List marker changed from numbered to bulleted⟩: do {+the +}thing",
      "li modified inline ⟨List marker changed from numbered to bulleted⟩: other",
    ]);
  });

  it("explains a list item indented under its sibling", () => {
    expect(
      view(lines("- a", "- b", "- c"), lines("- a", "  - b", "- c")),
    ).toEqual([
      "li modified inline: ⟨List nesting changed from level 1 to level 2⟩b",
    ]);
  });

  it("explains a list item outdented to its parent's level", () => {
    expect(
      view(lines("- a", "  - b", "- c"), lines("- a", "- b", "- c")),
    ).toEqual([
      "li modified inline: ⟨List nesting changed from level 2 to level 1⟩b",
    ]);
  });

  it("reports an indented numbered item as nesting, not renumbering", () => {
    expect(view(lines("1. a", "2. b"), lines("1. a", "    1. b"))).toEqual([
      "li modified inline: ⟨List nesting changed from level 1 to level 2⟩b",
    ]);
  });

  it("leaves items carried along by an indented parent unmarked", () => {
    const { root } = diffView(
      lines("- a", "- b", "  - c"),
      lines("- a", "  - b", "    - c"),
    );
    const tints = Array.from(
      root.querySelectorAll<HTMLElement>(".emr-diff-format-change"),
    ).map((tint) => [tint.textContent, tint.dataset.diffTooltip]);
    expect(tints).toEqual([
      ["b", "List nesting changed from level 1 to level 2"],
    ]);
  });

  it("leaves items carried along by an indented loose parent unmarked", () => {
    expect(
      view(
        lines("- a", "", "- b", "", "  - c"),
        lines("- a", "", "  - b", "", "    - c"),
      ),
    ).toEqual([
      "li modified inline: ⟨List nesting changed from level 1 to level 2⟩b",
    ]);
  });

  it("marks a child that moved under a different parent", () => {
    expect(
      view(lines("- a", "  - b", "  - c"), lines("- a", "  - b", "    - c")),
    ).toEqual([
      "li modified inline: ⟨List nesting changed from level 2 to level 3⟩c",
    ]);
  });

  it("still shows a text edit in a child under an indented parent", () => {
    const { root } = diffView(
      lines("- a", "- b", "  - c old"),
      lines("- a", "  - b", "    - c new"),
    );
    expect(root.querySelector(".emr-word-removed")?.textContent).toBe("old");
    expect(root.querySelector(".emr-word-added")?.textContent).toBe("new");
  });

  it("still shows a text edit in a child under a renumbered item", () => {
    const { root } = diffView(
      lines("1. a", "   - c old"),
      lines("3. a", "   - c new"),
    );
    expect(root.querySelector(".emr-word-removed")?.textContent).toBe("old");
    expect(root.querySelector(".emr-word-added")?.textContent).toBe("new");
  });

  it("explains nesting on the item itself when it has no text of its own", () => {
    expect(
      view(
        lines("- a", "- ![logo](a.png)"),
        lines("- a", "  - ![logo](a.png)"),
      ),
    ).toEqual([
      "li modified inline ⟨List nesting changed from level 1 to level 2⟩: ",
    ]);
  });

  it("explains nesting only when the original item can be located", () => {
    const current = lines("- a", "  - b");
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(current);
    decorateDiffRanges(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalText: "- b",
          originalStartLine: 5,
          originalEndLine: 5,
        },
      ],
      {
        renderInline: renderMarkdownSync,
        originalSource: lines("- a", "- b"),
      },
    );
    expect(
      root.querySelector("li li")!.classList.contains("emr-diff-block"),
    ).toBe(false);
  });

  it("does not look up nesting without the original source", () => {
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(lines("- a", "  - b"));
    decorateDiffRanges(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalText: "- b",
          originalStartLine: 2,
          originalEndLine: 2,
        },
      ],
      { renderInline: renderMarkdownSync },
    );
    expect(
      root.querySelector("li li")!.classList.contains("emr-diff-block"),
    ).toBe(false);
  });

  it("does not look up nesting when the hunk changed its line count", () => {
    const root = document.createElement("div");
    root.innerHTML = renderMarkdownSync(lines("- a", "  - b"));
    decorateDiffRanges(
      root,
      [
        {
          startLine: 2,
          endLine: 2,
          kind: "modified",
          originalText: "- b\n",
          originalStartLine: 2,
          originalEndLine: 3,
        },
      ],
      {
        renderInline: renderMarkdownSync,
        originalSource: lines("- a", "- b", ""),
      },
    );
    expect(
      root.querySelector("li li")!.classList.contains("emr-diff-block"),
    ).toBe(false);
  });

  it("hides a renumbering cascade after an inserted item", () => {
    expect(
      view(
        lines("1. one", "2. two", "3. three"),
        lines("1. one", "2. inserted", "3. two", "4. three"),
      ),
    ).toEqual(["li added wash: inserted"]);
  });

  it("hides a bullet-marker swap", () => {
    expect(
      view(lines("- apple", "- banana"), lines("* apple", "* banana")),
    ).toEqual([]);
  });

  it("explains a changed list start number", () => {
    expect(view(lines("1. one", "2. two"), lines("3. one", "4. two"))).toEqual([
      "li modified inline ⟨List numbering changed from 1 to 3⟩: one",
    ]);
  });

  it("marks only the checkbox when only the checklist state changed", () => {
    expect(
      view(
        lines("- [ ] write tests", "- [ ] ship"),
        lines("- [x] write tests", "- [ ] ship"),
      ),
    ).toEqual([
      "li modified inline: ⟨Checklist item changed from unchecked to checked⟩ write tests",
    ]);
  });
});

describe("scripts without word spaces", () => {
  it("diffs one changed Japanese word inline", () => {
    expect(view("今日は東京に行きます。", "今日は大阪に行きます。")).toEqual([
      "p modified inline: 今日は[-東京-]{+大阪+}に行きます。",
    ]);
  });

  it("diffs one added Chinese character inline", () => {
    expect(view("我们去公园。", "我们去公园玩。")).toEqual([
      "p modified inline: 我们去公园{+玩+}。",
    ]);
  });

  it("diffs a Latin word inside Chinese text", () => {
    expect(view("使用 API 调用服务。", "使用 SDK 调用服务。")).toEqual([
      "p modified inline: 使用 [-API-]{+SDK+} 调用服务。",
    ]);
  });

  it("diffs a Korean word inline", () => {
    expect(view("오늘은 날씨가 좋다.", "오늘은 날씨가 나쁘다.")).toEqual([
      "p modified inline: 오늘은 날씨가 [-좋다-]{+나쁘다+}.",
    ]);
  });
});

describe("whitespace in code blocks", () => {
  function codeMarks(original: string, current: string) {
    const { root } = diffView(original, current);
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        ".emr-word-added, .emr-word-removed, .emr-diff-format-change",
      ),
    ).map((mark) =>
      mark.classList.contains("emr-diff-format-change")
        ? `~${JSON.stringify(mark.textContent)} ${mark.dataset.diffTooltip}`
        : `${mark.className.includes("added") ? "+" : "-"}${JSON.stringify(mark.textContent)}`,
    );
  }

  it("re-indents a line by marking only the added spaces", () => {
    expect(
      codeMarks(
        lines("```py", "def f():", "  return 1", "```"),
        lines("```py", "def f():", "    return 1", "```"),
      ),
    ).toEqual(['+"  "']);
  });

  it("de-indents a line by marking only the removed spaces", () => {
    expect(
      codeMarks(
        lines("```py", "if x:", "    y()", "```"),
        lines("```py", "if x:", "  y()", "```"),
      ),
    ).toEqual(['-"  "']);
  });

  it("explains a tab replaced by spaces as one amber indentation change", () => {
    expect(
      codeMarks(
        lines("```go", "func f() {", "\treturn", "}", "```"),
        lines("```go", "func f() {", "    return", "}", "```"),
      ),
    ).toEqual(['~"    " Indentation changed from 1 tab to 4 spaces']);
  });

  it("explains a mid-line whitespace swap next to a word edit", () => {
    expect(
      codeMarks(
        lines("```", "key\t\tvalue old", "```"),
        lines("```", "key value new", "```"),
      ),
    ).toEqual([
      '~" " Whitespace changed from 2 tabs to 1 space',
      '-"old"',
      '+"new"',
    ]);
  });

  it("dedents a block without marking its line breaks", () => {
    expect(
      codeMarks(
        lines("```py", "    x = 1", "    y = 2", "```"),
        lines("```py", "x = 1", "y = 2", "```"),
      ),
    ).toEqual(['-"    "', '-"    "']);
  });

  it("adds trailing whitespace without marking the line break", () => {
    expect(
      codeMarks(lines("```", "a", "b", "```"), lines("```", "a  ", "b", "```")),
    ).toEqual(['+"  "']);
  });
});

describe("footnotes and equations", () => {
  it("diffs an edited footnote definition inline", () => {
    expect(
      view(
        lines("Claim.[^1]", "", "[^1]: Old source."),
        lines("Claim.[^1]", "", "[^1]: New source."),
      ),
    ).toEqual(["li modified inline: [-Old-]{+New+} source. ↩"]);
  });

  it("shows an added footnote and its reference", () => {
    expect(view("Claim.", lines("Claim.[^1]", "", "[^1]: A source."))).toEqual([
      "p modified inline: Claim.{+1+}",
      "li added wash: A source. ↩",
    ]);
  });

  it("stores an edited equation's previous TeX without claiming it is unavailable", () => {
    const { view: result, root } = diffView(
      lines("Text.", "", "$$", "a + b", "$$"),
      lines("Text.", "", "$$", "a + c", "$$"),
    );
    expect(result).toEqual(["div modified: a + c"]);
    expect(
      root.querySelector<HTMLElement>(".emr-math")!.dataset.diffOriginal,
    ).toBe("a + b");
  });
});

// Behaviour the probes found already correct, pinned through the full
// pipeline so a change to the line diff, refinement or decoration can't
// silently regress it.
describe("pipeline pins", () => {
  const cases: Array<[string, string, string, string[]]> = [
    // Prose.
    [
      "inserted word",
      "The quick fox jumps.",
      "The quick brown fox jumps.",
      ["p modified inline: The quick {+brown +}fox jumps."],
    ],
    [
      "deleted word",
      "The quick brown fox jumps.",
      "The quick fox jumps.",
      ["p modified inline: The quick [-brown -]fox jumps."],
    ],
    [
      "typo fix",
      "Teh quick fox.",
      "The quick fox.",
      ["p modified inline: [-Teh-]{+The+} quick fox."],
    ],
    [
      "punctuation",
      "Hello world.",
      "Hello world!",
      ["p modified inline: Hello world[-.-]{+!+}"],
    ],
    [
      "comma",
      "However we must go.",
      "However, we must go.",
      ["p modified inline: However{+,+} we must go."],
    ],
    [
      "capitalisation",
      "the API is great.",
      "The API is great.",
      ["p modified inline: [-the-]{+The+} API is great."],
    ],
    [
      "decimal number",
      "Timeout is 1.5 seconds.",
      "Timeout is 2.25 seconds.",
      ["p modified inline: Timeout is [-1.5-]{+2.25+} seconds."],
    ],
    [
      "hyphenated word",
      "A well-known fact.",
      "A well-understood fact.",
      ["p modified inline: A well-[-known-]{+understood+} fact."],
    ],
    [
      "contraction",
      "We do not know.",
      "We don't know.",
      ["p modified inline: We [-do not-]{+don't+} know."],
    ],
    [
      "emoji",
      "Ship it 🚀 today.",
      "Ship it 🎉 today.",
      ["p modified inline: Ship it [-🚀-]{+🎉+} today."],
    ],
    [
      "accented word",
      "Le café est fermé.",
      "Le café est ouvert.",
      ["p modified inline: Le café est [-fermé-]{+ouvert+}."],
    ],
    [
      "appended sentence",
      "Existing sentence.",
      "Existing sentence. New sentence added here.",
      ["p modified inline: Existing sentence.{+ New sentence added here.+}"],
    ],
    [
      "one word in a long paragraph",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Ut enim ad minim veniam.",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Ut enim ad maxim veniam.",
      [
        "p modified inline: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Ut enim ad [-minim-]{+maxim+} veniam.",
      ],
    ],
    [
      "one line of a wrapped paragraph",
      lines("Alpha line one", "beta line two", "gamma line three."),
      lines("Alpha line one", "beta LINE two", "gamma line three."),
      [
        "p modified inline: Alpha line one beta [-line-]{+LINE+} two gamma line three.",
      ],
    ],
    [
      "inline code",
      "Call `foo()` to start.",
      "Call `bar()` to start.",
      ["p modified inline: Call [-foo-]{+bar+}() to start."],
    ],
    [
      "link text",
      "See [the docs](https://a.com) now.",
      "See [the guide](https://a.com) now.",
      ["p modified inline: See the [-docs-]{+guide+} now."],
    ],
    [
      "link target",
      "See [the docs](https://a.com/x) now.",
      "See [the docs](https://b.com/y) now.",
      ["p modified inline: See the docs ⟨Show link hostname change⟩ now."],
    ],
    [
      "bold added",
      "This is important.",
      "This is **important**.",
      ["p modified inline: This is ⟨Bold formatting added⟩important."],
    ],
    [
      "italic removed",
      "This is *very* nice.",
      "This is very nice.",
      ["p modified inline: This is ⟨Italic formatting removed⟩very nice."],
    ],
    [
      "inline math",
      "Value $x^2$ here.",
      "Value $x^3$ here.",
      ["p modified inline: Value x^[-2-]{+3+} here."],
    ],
    [
      "re-wrapped lines",
      lines("One two three", "four five."),
      lines("One two", "three four five."),
      [],
    ],
    ["trailing spaces", "Line text.", "Line text.   ", []],
    [
      "deleted paragraph",
      lines("A para.", "", "B para.", "", "C para."),
      lines("A para.", "", "C para."),
      ["deleted: 2 lines removed"],
    ],
    [
      "two separate edits",
      lines("Alpha one.", "", "Beta two.", "", "Gamma three."),
      lines("Alpha uno.", "", "Beta two.", "", "Gamma tres."),
      [
        "p modified inline: Alpha [-one-]{+uno+}.",
        "p modified inline: Gamma [-three-]{+tres+}.",
      ],
    ],
    [
      "edit then insert",
      lines("Alpha one.", "", "Gamma."),
      lines("Alpha uno.", "", "New para.", "", "Gamma."),
      ["p modified inline: Alpha [-one-]{+uno+}.", "p added wash: New para."],
    ],
    // Headings.
    [
      "heading level",
      lines("## Setup", "", "Body."),
      lines("### Setup", "", "Body."),
      [
        "h3 modified inline: ⟨Block changed from heading level 2 to heading level 3⟩Setup",
      ],
    ],
    [
      "heading level and text",
      lines("## Setup", "", "Body."),
      lines("### Setup guide", "", "Body."),
      ["h3 modified inline: Setup{+ guide+}"],
    ],
    [
      "added heading",
      lines("Body one.", "", "Body two."),
      lines("Body one.", "", "## New", "", "Body two."),
      ["h2 added wash: New"],
    ],
    [
      "removed heading",
      lines("Body one.", "", "## Old", "", "Body two."),
      lines("Body one.", "", "Body two."),
      ["deleted: 2 lines removed"],
    ],
    [
      "heading and body",
      lines("## Old title", "", "Old body text here."),
      lines("## New title", "", "New body text here."),
      [
        "h2 modified inline: [-Old-]{+New+} title",
        "p modified inline: [-Old-]{+New+} body text here.",
      ],
    ],
    // Lists.
    [
      "added item",
      lines("- apple", "- banana", "- cherry"),
      lines("- apple", "- banana", "- date", "- cherry"),
      ["li added wash: date"],
    ],
    [
      "removed item",
      lines("- apple", "- banana", "- cherry"),
      lines("- apple", "- cherry"),
      ["deleted: 1 line removed"],
    ],
    [
      "added nested item",
      lines("- parent", "- other"),
      lines("- parent", "  - child", "- other"),
      ["li added wash: child"],
    ],
    [
      "edited nested item",
      lines("- parent", "  - child one", "- other"),
      lines("- parent", "  - child two", "- other"),
      ["li modified inline: child [-one-]{+two+}"],
    ],
    [
      "edited loose item",
      lines("- item one", "", "- item two", "", "- item three"),
      lines("- item one", "", "- item 2", "", "- item three"),
      ["li modified inline: item [-two-]{+2+}"],
    ],
    [
      "bullets to numbers",
      lines("- a", "- b"),
      lines("1. a", "2. b"),
      [
        "li modified inline ⟨List marker changed from bulleted to numbered⟩: a",
        "li modified inline ⟨List marker changed from bulleted to numbered⟩: b",
      ],
    ],
    [
      "list item to paragraph",
      "- just text",
      "just text",
      [
        "p modified inline: ⟨Block changed from list item to paragraph⟩just text",
      ],
    ],
    [
      "number in item",
      lines("- Retries: 3", "- x"),
      lines("- Retries: 5", "- x"),
      ["li modified inline: Retries: [-3-]{+5+}"],
    ],
    // Code.
    [
      "edited code line",
      lines("```js", "const a = 1;", "const b = 2;", "```"),
      lines("```js", "const a = 1;", "const b = 3;", "```"),
      ["pre modified inline: const a = 1; const b = [-2-]{+3+};"],
    ],
    [
      "code language",
      lines("```js", "x = 1", "```"),
      lines("```ts", "x = 1", "```"),
      ["pre modified inline: x = 1 ⟨Language changed⟩"],
    ],
    [
      "code identifier",
      lines("```js", "const fooBar = 1;", "```"),
      lines("```js", "const fooBaz = 1;", "```"),
      ["pre modified inline: const [-fooBar-]{+fooBaz+} = 1;"],
    ],
    [
      "indented code",
      lines("Text:", "", "    old code", "", "End."),
      lines("Text:", "", "    new code", "", "End."),
      ["pre modified inline: [-old-]{+new+} code"],
    ],
    // Quotes and callouts.
    [
      "quote edit",
      lines("> The quick fox.", "", "After."),
      lines("> The slow fox.", "", "After."),
      ["blockquote modified inline: The [-quick-]{+slow+} fox."],
    ],
    [
      "callout body",
      lines("> [!NOTE]", "> Be careful here."),
      lines("> [!NOTE]", "> Be very careful here."),
      ["blockquote modified inline: Note Be {+very +}careful here."],
    ],
    // Tables.
    [
      "table cell",
      lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |"),
      lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 3 |"),
      ["tr modified cells: b [-2-]{+3+}"],
    ],
    [
      "table header",
      lines("| Name | Value |", "| --- | --- |", "| a | 1 |"),
      lines("| Name | Amount |", "| --- | --- |", "| a | 1 |"),
      ["tr modified cells: Name [-Value-]{+Amount+}"],
    ],
    [
      "filled table cell",
      lines("| Name | Value |", "| --- | --- |", "| a |  |"),
      lines("| Name | Value |", "| --- | --- |", "| a | 5 |"),
      ["tr modified cells: a {+5+}"],
    ],
    [
      "added table row",
      lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |"),
      lines(
        "| Name | Value |",
        "| --- | --- |",
        "| a | 1 |",
        "| c | 9 |",
        "| b | 2 |",
      ),
      ["tr added: c 9"],
    ],
    [
      "removed table row",
      lines(
        "| Name | Value |",
        "| --- | --- |",
        "| a | 1 |",
        "| b | 2 |",
        "| c | 3 |",
      ),
      lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| c | 3 |"),
      ["deleted: Removed table row"],
    ],
    [
      "added table column",
      lines("| A | B |", "| - | - |", "| 1 | 2 |"),
      lines("| A | B | C |", "| - | - | - |", "| 1 | 2 | 3 |"),
      ["tr modified cells: A B C", "tr modified cells: 1 2 3"],
    ],
    [
      "removed table column",
      lines("| A | B | C |", "| - | - | - |", "| 1 | 2 | 3 |"),
      lines("| A | C |", "| - | - |", "| 1 | 3 |"),
      ["tr modified cells: A [-B-]C", "tr modified cells: 1 [-2-]3"],
    ],
    [
      "table padding",
      lines("| Name | Value |", "| --- | --- |", "| a | 1 |"),
      lines("| Name | Value |", "| --- | --- |", "| a   | 1     |"),
      [],
    ],
    // Media and metadata.
    [
      "image alt",
      "![old alt](a.png)",
      "![new alt](a.png)",
      ["p modified inline: ⟨Image changed⟩"],
    ],
    [
      "image source",
      "See ![icon](a.png) here.",
      "See ![icon](b.png) here.",
      ["p modified inline: See ⟨Image changed⟩ here."],
    ],
    [
      "frontmatter",
      lines("---", "title: Old", "tags: [a, b]", "---", "", "Body."),
      lines("---", "title: New", "tags: [a, b, c]", "---", "", "Body."),
      [
        "div modified inline: title[-Old-]{+New+}",
        "div modified inline: tagsa, b{+, c+}",
      ],
    ],
  ];

  for (const [name, original, current, expected] of cases) {
    it(name, () => {
      expect(view(original, current)).toEqual(expected);
    });
  }
});
