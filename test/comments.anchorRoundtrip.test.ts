// Round-trip anchoring probe: render real Markdown → DOM, then exercise BOTH
// directions that matter to users:
//   (A) preview → ADO: select rendered text, capture an anchor, map it to a
//       source line/column via withSourceLocation (what we persist to ADO).
//   (B) ADO → preview: take an anchor and resolve it back to a DOM Range.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { renderMarkdownSync } from "../src/markdown/render";
import {
    captureAnchorFromSelection,
    resolveAnchor,
    withSourceLocation,
} from "../src/comments/anchor";

function mountArticle(md: string): HTMLElement {
    const root = document.createElement("article");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(md);
    document.body.appendChild(root);

    return root;
}

/** Find the flat text offset of `needle` in the article's rendered text. */
function findTextNodeAt(root: Element, needle: string): { node: Text; offset: number } {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n: Node | null = walker.nextNode();

    while (n) {
        const t = n as Text;
        const idx = t.data.indexOf(needle);
        if (idx >= 0) return { node: t, offset: idx };
        n = walker.nextNode();
    }

    throw new Error(`text "${needle}" not found in a single text node`);
}

/** Select `needle` (must live within one text node) and return the anchor. */
function selectAndCapture(
    root: HTMLElement,
    needle: string,
): ReturnType<typeof captureAnchorFromSelection> {
    const { node, offset } = findTextNodeAt(root, needle);
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + needle.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    return captureAnchorFromSelection(root);
}

afterEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
});

/**
 * Select a run of rendered text that may span multiple text nodes / inline
 * elements, by matching `wanted` against the article's flattened text. This
 * reproduces a real user drag across e.g. plain→bold boundaries.
 */
function selectFlatRange(
    root: HTMLElement,
    wanted: string,
): ReturnType<typeof captureAnchorFromSelection> {
    const runs: Array<{ node: Text; start: number; end: number }> = [];
    let acc = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n: Node | null = walker.nextNode();

    while (n) {
        const t = n as Text;

        if (t.data.length > 0) {
            runs.push({
                node: t,
                start: acc.length,
                end: acc.length + t.data.length,
            });
            acc += t.data;
        }

        n = walker.nextNode();
    }

    const startFlat = acc.indexOf(wanted);
    if (startFlat < 0) throw new Error(`flat text "${wanted}" not found`);
    const endFlat = startFlat + wanted.length;

    const locate = (flat: number) => {
        for (const r of runs) {
            if (flat >= r.start && flat <= r.end) {
                return { node: r.node, offset: flat - r.start };
            }
        }

        throw new Error("offset out of range");
    };

    const s = locate(startFlat);
    const e = locate(endFlat);
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    return captureAnchorFromSelection(root);
}

describe("round-trip (A) preview selection → source line/column for ADO", () => {
    let source: string;
    let root: HTMLElement;

    beforeEach(() => {
        source = [
            "# Data Export in the Planner/Todo Service", // line 1
            "", // 2
            "This service supports several ways of exporting data.", // 3
            "", // 4
            "| # | Mechanism | Scope | Audience |", // 5
            "|---|-----------|-------|----------|", // 6
            "| 1 | OData admin export | Whole tenant | Tenant admin |", // 7
            "| 2 | GDPR DSR | One user's data | Task API |", // 8
            "", // 9
            "Here is a paragraph with **bold text** and a `code span` inline.", // 10
            "", // 11
            "See the [official docs](https://example.com/guide) for more detail.", // 12
        ].join("\n");
        root = mountArticle(source);
    });

    // The last two are the fragile cases: the rendered text does NOT appear
    // verbatim in the Markdown source because inline syntax sits inside/around
    // the selection (e.g. the source has backticks around "code span", so the
    // DOM text isn't a verbatim source substring).
    it.each([
        {
            name: "a plain-paragraph selection to its true source line",
            needle: "several ways",
            line: 3,
        },
        {
            name: "a table-header cell selection to the header's source line",
            needle: "Mechanism",
            line: 5,
        },
        {
            name: "a table-body cell selection to that row's source line",
            needle: "GDPR DSR",
            line: 8,
        },
        {
            name: "a heading selection to the heading's source line",
            needle: "Planner/Todo Service",
            line: 1,
        },
        {
            name: "a link-text selection to the link's source line",
            needle: "official docs",
            line: 12,
        },
        {
            name: "a bold-word selection to its source line (spans ** markers)",
            needle: "bold text",
            line: 10,
        },
        {
            name: "a selection crossing a code span to its source line",
            needle: "code span",
            line: 10,
        },
    ])("maps $name", ({ needle, line }) => {
        const anchor = selectAndCapture(root, needle);
        expect(anchor).not.toBeNull();
        const located = withSourceLocation(anchor!, source);
        expect(located.line).toBe(line);
    });

    // The genuinely fragile case: the selection CROSSES an inline element
    // boundary, so Markdown markers (** or `) land INSIDE the rendered text and
    // the DOM string is NOT a contiguous substring of the source.
    it("maps a plain→bold spanning selection to its source line", () => {
        const anchor = selectFlatRange(root, "paragraph with bold text");
        expect(anchor).not.toBeNull();
        expect(anchor!.exact).toBe("paragraph with bold text");
        const located = withSourceLocation(anchor!, source);
        expect(located.line).toBe(10);
    });

    it("maps a selection spanning across a code span to its source line", () => {
        const anchor = selectFlatRange(root, "and a code span inline");
        expect(anchor).not.toBeNull();
        const located = withSourceLocation(anchor!, source);
        expect(located.line).toBe(10);
    });
});

describe("round-trip (B) anchor → preview DOM resolution", () => {
    it("re-resolves a captured anchor back onto the same rendered text", () => {
        const source = [
            "# Title",
            "",
            "Alpha beta gamma delta epsilon.",
            "",
            "Another paragraph mentioning gamma again for ambiguity.",
        ].join("\n");

        const root = mountArticle(source);

        const anchor = selectAndCapture(root, "beta gamma");
        expect(anchor).not.toBeNull();

        const range = resolveAnchor(root, anchor!);
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("beta gamma");
    });

    it("disambiguates a duplicated word using prefix/suffix context", () => {
        const source = "gamma here, and gamma there, and gamma everywhere.";
        const root = mountArticle(source);

        // Capture the SECOND "gamma".
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

        const textNode = walker.nextNode() as Text;
        const firstIdx = textNode.data.indexOf("gamma");
        const secondIdx = textNode.data.indexOf("gamma", firstIdx + 1);
        const range = document.createRange();
        range.setStart(textNode, secondIdx);
        range.setEnd(textNode, secondIdx + "gamma".length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        const anchor = captureAnchorFromSelection(root)!;

        const resolved = resolveAnchor(root, anchor);
        expect(resolved).not.toBeNull();
        // The resolved range must start at the SECOND occurrence, not the first.
        expect(resolved!.startOffset).toBe(secondIdx);
    });
});
