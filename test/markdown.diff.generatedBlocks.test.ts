import { beforeEach, describe, expect, it } from "vitest";

import {
    decorateDiffRanges,
    DIFF_BLOCK_CLASS,
    DIFF_MATH_CLASS,
    DIFF_MERMAID_CLASS,
    stripMermaidFence,
} from "../src/markdown/diffDecorations";
import { decorate, diffView, lines, render, words } from "./markdownDiffHarness";

// Rendered diff of generated blocks — Mermaid diagrams and display equations.
// Their rendered output can't carry word marks, so they are marked as a whole
// and keep their previous source for a side-by-side Source comparison.

beforeEach(() => {
    document.body.innerHTML = "";
});

/** An article holding one rendered Mermaid diagram spanning source lines `start`–`end`. */
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

describe("Mermaid diagrams", () => {
    it("outlines a changed diagram as edited instead of washing it", () => {
        const root = mermaidRoot(5, 8);

        const res = decorateDiffRanges(root, [{ startLine: 5, endLine: 8, kind: "modified" }]);

        expect(res.decorated).toBe(1);
        const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
        expect(el.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(el.classList.contains(DIFF_MERMAID_CLASS)).toBe(true);
        expect(el.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(el.dataset.diffKind).toBe("modified");
    });

    it("keeps the previous diagram source when the whole diagram was replaced", () => {
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

    it("still marks a diagram whose previous source is only partly known, without offering it for comparison", () => {
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

    it("rebuilds the complete previous source of a diagram from a one-line edit", () => {
        const root = mermaidRoot(5, 8);
        decorateDiffRanges(
            root,
            [
                {
                    startLine: 6,
                    endLine: 6,
                    kind: "modified",
                    originalStartLine: 6,
                    originalEndLine: 6,
                    originalText: "  A --> B",
                },
            ],
            {
                originalSource: [
                    "# Diagram",
                    "",
                    "Intro",
                    "",
                    "```mermaid",
                    "  A --> B",
                    "  B --> C",
                    "```",
                ].join("\n"),
            },
        );

        expect(root.querySelector<HTMLElement>(".emr-mermaid")!.dataset.diffOriginal).toBe(
            "A --> B\n  B --> C",
        );
    });

    it("leaves an unchanged diagram untouched", () => {
        const root = mermaidRoot(5, 8);

        const res = decorateDiffRanges(root, [{ startLine: 20, endLine: 20, kind: "added" }]);

        expect(res.decorated).toBe(0);
        expect(root.querySelector(".emr-mermaid")?.classList.contains(DIFF_BLOCK_CLASS)).toBe(
            false,
        );
    });

    it("outlines a wholly-added diagram as added", () => {
        const root = mermaidRoot(5, 8);

        const res = decorateDiffRanges(root, [{ startLine: 5, endLine: 8, kind: "added" }]);

        expect(res.decorated).toBe(1);
        const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
        expect(el.classList.contains("emr-diff-block--added")).toBe(true);
        expect(el.dataset.diffKind).toBe("added");
        // No original to stash for a pure add.
        expect(el.dataset.diffOriginal).toBeUndefined();
    });
    it("never marks a diagram that has no source position, such as one inserted by the app", () => {
        const root = mermaidRoot(5, 8);
        const injected = root.querySelector<HTMLElement>(".emr-mermaid")!;
        injected.removeAttribute("data-source-line");
        injected.removeAttribute("data-source-end-line");

        const res = decorateDiffRanges(root, [{ startLine: 5, endLine: 8, kind: "modified" }]);

        expect(res.decorated).toBe(0);
        expect(injected.classList.contains(DIFF_MERMAID_CLASS)).toBe(false);
    });

    it("leaves a diagram inside a wholly-changed quote to the quote's highlight", () => {
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

    it("does not offer an empty previous diagram for comparison", () => {
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

    it("removes the outline and previous source when changes are hidden", () => {
        const root = mermaidRoot(5, 8);
        decorateDiffRanges(root, [
            {
                startLine: 5,
                endLine: 8,
                kind: "modified",
                originalText: "```mermaid\nflowchart TB\n```",
            },
        ]);
        expect(root.querySelector(".emr-mermaid")?.classList.contains(DIFF_MERMAID_CLASS)).toBe(
            true,
        );
        decorateDiffRanges(root, []);
        const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
        expect(el.classList.contains(DIFF_MERMAID_CLASS)).toBe(false);
        expect(el.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
        expect(el.dataset.diffOriginal).toBeUndefined();
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
});

describe("stripMermaidFence", () => {
    it.each([
        {
            name: "a triple-backtick mermaid fence",
            block: "```mermaid\nflowchart LR\n  a --> b\n```",
            source: "flowchart LR\n  a --> b",
        },
        {
            name: "an Azure DevOps colon fence",
            block: ":::mermaid\nsequenceDiagram\n:::",
            source: "sequenceDiagram",
        },
        {
            name: "unfenced diagram source",
            block: "flowchart LR\n  a --> b",
            source: "flowchart LR\n  a --> b",
        },
        { name: "an empty fence", block: "```mermaid\n```", source: "" },
        {
            name: "an unterminated fence",
            block: "```mermaid\nflowchart LR",
            source: "flowchart LR",
        },
    ])("reads the diagram source from $name", ({ block, source }) => {
        expect(stripMermaidFence(block)).toBe(source);
    });
});

describe("display equations", () => {
    it("outlines a changed display equation as a whole, without word marks", () => {
        const root = render(lines("$$", "x^2", "$$"));

        const result = decorate(root, [
            { startLine: 2, endLine: 2, kind: "modified", originalText: "x^3" },
        ]);

        const equation = root.querySelector<HTMLElement>(".emr-math")!;
        expect(result.decorated).toBe(1);
        expect(equation.classList.contains(DIFF_MATH_CLASS)).toBe(true);
        expect(equation.dataset.diffKind).toBe("modified");
        expect(equation.dataset.diffLineWash).toBeUndefined();
        expect(words(equation)).toEqual({ added: "", removed: "" });
    });
    it("shows a line added to a display equation as an edit", () => {
        const { view: result, root } = diffView(
            lines("$$", "a + b", "$$"),
            lines("$$", "a + b", "+ c", "$$"),
        );

        expect(result).toEqual(["div modified: a + b + c"]);
        expect(root.querySelector<HTMLElement>(".emr-math")!.dataset.diffOriginal).toBe("a + b");
    });
    it("keeps an edited equation's previous TeX for comparison without a Before disclosure", () => {
        const { view: result, root } = diffView(
            lines("Text.", "", "$$", "a + b", "$$"),
            lines("Text.", "", "$$", "a + c", "$$"),
        );

        expect(result).toEqual(["div modified: a + c"]);
        expect(root.querySelector<HTMLElement>(".emr-math")!.dataset.diffOriginal).toBe("a + b");
    });
    it("offers no previous TeX when prose was turned into an equation", () => {
        const root = render(lines("$$", "x^2", "$$"));

        decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 3,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 1,
                    originalText: "plain prose",
                },
            ],
            "plain prose",
        );

        expect(root.querySelector<HTMLElement>(".emr-math")!.dataset.diffOriginal).toBeUndefined();
    });
});
