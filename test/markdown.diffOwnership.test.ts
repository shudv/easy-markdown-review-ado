import { describe, it, expect } from "vitest";
import { renderMarkdownSync } from "../src/markdown/render";
import {
  decorateDiffRanges,
  DIFF_BLOCK_CLASS,
  DIFF_DELETED_MARKER_CLASS,
} from "../src/markdown/diffDecorations";
import { refineDiffRanges } from "../src/markdown/diffRefine";
import { WORD_ADDED_CLASS } from "../src/markdown/wordDiffDom";
import { lineDiffBlocksToRanges } from "../src/shell/adoCommentApi.helpers";
import type { DiffRange } from "../src/types";

// The ownership invariant behind every rendered diff: each changed source line
// is painted exactly where it renders, and nothing else is. Container blocks
// (list items, quotes) own only their lead content; every child block — a
// second paragraph, nested list, code block, quote, table — paints itself.
//
// Rather than pin a handful of shapes, this generates the container × child
// matrix (at two nesting depths) and checks every changed line. Each line
// carries a unique token (`t12`) so the audit can find exactly which rendered
// text a line produced and whether it is painted.

type Child = "para" | "list" | "code" | "quote" | "table";
type Container = "bullet" | "ordered" | "quote";

const CHILDREN: readonly Child[] = ["para", "list", "code", "quote", "table"];
const CONTAINERS: readonly Container[] = ["bullet", "ordered", "quote"];

interface Doc {
  name: string;
  lines: string[];
  /** First and last 1-based line of the container under test. */
  span: [number, number];
}

function buildDoc(container: Container, children: Child[], depth: 1 | 2): Doc {
  let next = 0;
  const tok = () => `t${++next}`;
  const childLines = (kind: Child, ind: string): string[] => {
    switch (kind) {
      case "para":
        return [`${ind}Continuation ${tok()} words here.`];
      case "list":
        return [`${ind}- Nested ${tok()} one`, `${ind}- Nested ${tok()} two`];
      case "code":
        return [`${ind}\`\`\``, `${ind}code ${tok()} line`, `${ind}\`\`\``];
      case "quote":
        return [`${ind}> Quoted ${tok()} remark`];
      case "table":
        return [
          `${ind}| Name ${tok()} | Value |`,
          `${ind}| --- | --- |`,
          `${ind}| Row ${tok()} | one |`,
        ];
    }
  };
  const outer = depth === 2 ? "   " : "";
  const body: string[] = [];
  if (container === "quote") {
    body.push(`${outer}> Lead ${tok()} text`);
    for (const child of children) {
      body.push(`${outer}>`, ...childLines(child, `${outer}> `));
    }
  } else {
    const marker = container === "bullet" ? "- " : "2. ";
    const ind = outer + " ".repeat(marker.length);
    body.push(`${outer}${marker}Lead ${tok()} text`);
    for (const child of children) body.push("", ...childLines(child, ind));
  }
  const lines = [`Intro ${tok()} paragraph.`, ""];
  if (depth === 2) lines.push(`1. Outer ${tok()} item`, "");
  if (container !== "quote") {
    const keep = container === "bullet" ? "- " : "1. ";
    lines.push(`${outer}${keep}Keep ${tok()} item`, "");
  }
  const first = lines.length + 1;
  lines.push(...body, "", `Outro ${tok()} paragraph.`);
  return {
    name: `${container}[${children.join(",") || "lead"}]@${depth}`,
    lines,
    span: [first, first + body.length - 1],
  };
}

function* corpus(): Generator<Doc> {
  for (const depth of [1, 2] as const) {
    for (const container of CONTAINERS) {
      yield buildDoc(container, [], depth);
      for (const a of CHILDREN) {
        yield buildDoc(container, [a], depth);
        for (const b of CHILDREN) yield buildDoc(container, [a, b], depth);
      }
    }
  }
}

function render(md: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-body emr-rendered";
  root.innerHTML = renderMarkdownSync(md);
  return root;
}

/** Text node holding a line's unique token. */
function tokenNode(root: HTMLElement, token: string): Text | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const pattern = new RegExp(`\\b${token}\\b`);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(`.${DIFF_DELETED_MARKER_CLASS}`)) continue;
    if (pattern.test(node.textContent ?? "")) return node as Text;
  }
  return null;
}

/** True when the reader sees `node` as part of a change. */
function painted(node: Text): boolean {
  const el = node.parentElement!;
  if (el.closest(`.emr-diff-line-wash, .${WORD_ADDED_CLASS}`)) return true;
  const block = el.closest<HTMLElement>(`.${DIFF_BLOCK_CLASS}`);
  return (
    block != null &&
    block.dataset.diffLineWash !== "true" &&
    block.dataset.diffInline !== "true"
  );
}

interface Audit {
  lost: string[];
  misplaced: string[];
}

function audit(
  doc: Doc,
  root: HTMLElement,
  changed: [number, number],
  kind: "added" | "modified",
): Audit {
  const current = doc.lines.join("\n");
  const original =
    kind === "modified"
      ? doc.lines
          .map((line, i) =>
            i + 1 >= changed[0] && i + 1 <= changed[1]
              ? line.replace(/\bt(\d+)\b/, "old$1")
              : line,
          )
          .join("\n")
      : undefined;
  const range: DiffRange =
    kind === "added"
      ? { startLine: changed[0], endLine: changed[1], kind }
      : {
          startLine: changed[0],
          endLine: changed[1],
          kind,
          originalStartLine: changed[0],
          originalEndLine: changed[1],
          originalText: original!
            .split("\n")
            .slice(changed[0] - 1, changed[1])
            .join("\n"),
        };
  // Re-decorating the same root also proves the decoration pass is idempotent.
  decorateDiffRanges(root, [range], {
    renderInline: renderMarkdownSync,
    currentSource: current,
    originalSource: original,
  });
  const result: Audit = { lost: [], misplaced: [] };
  doc.lines.forEach((line, i) => {
    const token = /\bt\d+\b/.exec(line)?.[0];
    if (!token) return;
    const node = tokenNode(root, token);
    expect(node, `${doc.name}: ${token} rendered`).not.toBeNull();
    const isChanged = i + 1 >= changed[0] && i + 1 <= changed[1];
    const label = `${doc.name} ${kind} ${changed.join("-")}: L${i + 1} ${line.trim()}`;
    if (isChanged && !painted(node!)) result.lost.push(label);
    if (kind === "added" && !isChanged && painted(node!)) {
      result.misplaced.push(label);
    }
  });
  return result;
}

describe("diff ownership invariant", () => {
  const docs = Array.from(corpus());

  it("covers every container × child shape at two depths", () => {
    expect(docs).toHaveLength(2 * 3 * (1 + 5 + 25));
  });

  it.each(docs.map((doc) => [doc.name, doc] as const))(
    "%s: paints every changed line where it renders, and nothing else",
    (_name, doc) => {
      const root = render(doc.lines.join("\n"));
      const lost: string[] = [];
      const misplaced: string[] = [];
      const changes: [number, number][] = [doc.span];
      doc.lines.forEach((line, i) => {
        if (/\bt\d+\b/.test(line)) changes.push([i + 1, i + 1]);
      });
      for (const change of changes) {
        const added = audit(doc, root, change, "added");
        lost.push(...added.lost);
        misplaced.push(...added.misplaced);
        if (change[0] === change[1]) {
          lost.push(...audit(doc, root, change, "modified").lost);
        }
      }
      expect(lost).toEqual([]);
      expect(misplaced).toEqual([]);
    },
  );
});

describe("diff ownership regressions", () => {
  // The shape of a real ADO hunk pair: a placeholder paragraph rewritten into a
  // deeply nested checklist (one coarse `edit` hunk), then a removed TODO quote
  // paired with a continuation paragraph inside the innermost parent item.
  it("paints a continuation paragraph after a nested list in an added item", () => {
    const original = [
      "### Performance",
      "",
      "_Can this impact our topline perf metrics?_",
      "",
      "> TODO: Add links to dashboards for these metrics",
      "",
      "### Security",
    ].join("\n");
    const current = [
      "### Performance",
      "",
      "We have three topline metrics.",
      "",
      "Consider following aspects for your feature-",
      "",
      "1. Does it introduce a new JS payload?",
      "",
      "2. Does it introduce new user facing interactions? If yes-",
      "",
      "    1. List down the HVAs and their targets.",
      "",
      "    2. Benchmark each HVA-",
      "",
      "        1. Locally against the dev app perf plan.",
      "        2. Capture latency numbers in the PPE environment.",
      "",
      "        You can use the **Perf Insights** panel to capture these numbers.",
      "",
      "### Security",
    ].join("\n");
    const ranges = refineDiffRanges(
      lineDiffBlocksToRanges(
        [
          {
            changeType: 3,
            originalLineNumberStart: 3,
            originalLinesCount: 1,
            modifiedLineNumberStart: 3,
            modifiedLinesCount: 14,
          },
          {
            changeType: 3,
            originalLineNumberStart: 5,
            originalLinesCount: 1,
            modifiedLineNumberStart: 18,
            modifiedLinesCount: 1,
          },
        ],
        original.split("\n"),
      ),
      original,
      current,
    );
    const root = render(current);
    decorateDiffRanges(root, ranges, {
      renderInline: renderMarkdownSync,
      originalSource: original,
      currentSource: current,
    });

    const continuation = Array.from(root.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("You can use"),
    )!;
    expect(continuation.dataset.diffKind).toBe("added");
    expect(continuation.querySelector(".emr-diff-line-wash")).not.toBeNull();
    const benchmark = continuation.closest("li")!;
    expect(benchmark.dataset.diffKind).toBe("added");
    expect(benchmark.querySelector(":scope > p")!.textContent).toBe(
      "Benchmark each HVA-",
    );
    expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).not.toBeNull();
  });

  it("paints only the second paragraph when that is all that changed", () => {
    const md = "- Keep this lead\n\n  New second paragraph\n";
    const root = render(md);
    decorateDiffRanges(root, [{ startLine: 3, endLine: 3, kind: "added" }], {
      renderInline: renderMarkdownSync,
      currentSource: md,
    });
    const [lead, second] = Array.from(root.querySelectorAll("li > p"));
    expect(root.querySelector("li")!.classList.contains(DIFF_BLOCK_CLASS)).toBe(
      false,
    );
    expect(lead!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    expect(second!.dataset.diffKind).toBe("added");
  });

  it("lets a quote that opens with a list leave its items to paint themselves", () => {
    const md = "Intro\n\n> - first\n> - second\n>\n> Closing note\n";
    const root = render(md);
    decorateDiffRanges(root, [{ startLine: 3, endLine: 6, kind: "added" }], {
      renderInline: renderMarkdownSync,
      currentSource: md,
    });
    expect(
      root.querySelector("blockquote")!.classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
    expect(
      Array.from(root.querySelectorAll("blockquote li, blockquote > p")).map(
        (el) => (el as HTMLElement).dataset.diffKind,
      ),
    ).toEqual(["added", "added", "added"]);
  });

  it("gives a diagram inside a washed list item its own accent", () => {
    const md =
      "- Keep\n\n- New lead\n\n  ```mermaid\n  graph TD; A-->B\n  ```\n";
    const root = render(md);
    decorateDiffRanges(root, [{ startLine: 3, endLine: 7, kind: "added" }], {
      renderInline: renderMarkdownSync,
      currentSource: md,
    });
    expect(
      root.querySelector<HTMLElement>(".emr-mermaid")!.dataset.diffKind,
    ).toBe("added");
  });
  // A lead holding an image can't follow line boxes, so the container keeps a
  // whole-box wash: content inside a quote is covered by it, while a nested
  // list item still decorates itself.
  it("keeps the box-wash fallback for an image lead", () => {
    const md =
      "- Keep\n\n- ![chart](chart.png)\n\n  - Nested item\n\n> ![chart](chart.png)\n>\n> - Quoted item\n";
    const root = render(md);
    decorateDiffRanges(root, [{ startLine: 3, endLine: 9, kind: "added" }], {
      renderInline: renderMarkdownSync,
      currentSource: md,
    });
    const nested = root.querySelector<HTMLElement>("li li")!;
    expect(nested.dataset.diffKind).toBe("added");
    const quote = root.querySelector<HTMLElement>("blockquote")!;
    expect(quote.dataset.diffKind).toBe("added");
    expect(quote.dataset.diffLineWash).toBeUndefined();
    expect(
      quote.querySelector("li")!.classList.contains(DIFF_BLOCK_CLASS),
    ).toBe(false);
  });
  // A tight item's lead is washed line by line even when a nested item below
  // it holds media; only media in the lead itself needs the box fallback.
  it("line-washes a tight lead above a nested item with an image", () => {
    const md = "- Lead edited\n  - ![chart](chart.png)\n";
    const root = render(md);
    decorateDiffRanges(root, [{ startLine: 1, endLine: 1, kind: "added" }], {
      renderInline: renderMarkdownSync,
      currentSource: md,
    });
    const [lead, nested] = Array.from(root.querySelectorAll("li"));
    expect(lead!.dataset.diffLineWash).toBe("true");
    expect(nested!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
  });
});
