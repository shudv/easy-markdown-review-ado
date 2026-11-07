import { beforeEach, describe, expect, it } from "vitest";

import {
    decorateDiffRanges,
    diffLegendStats,
    DIFF_BLOCK_CLASS,
    DIFF_DELETED_MARKER_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_TOOLTIP_CLASS,
    reconstructOriginalBlock,
    summarizeDiff,
} from "../src/markdown/diffDecorations";
import { DIFF_TOOLTIP_RIGHT_CLASS } from "../src/markdown/diffDecorations/shared";
import { WORD_ADDED_CLASS, WORD_REMOVED_CLASS } from "../src/markdown/wordDiffDom";
import type { DiffRange } from "../src/types";
import { makeRoot, render, stubRender } from "./markdownDiffHarness";

// The decorateDiffRanges surface shared by every rendered feature: which
// element a change paints, removal markers, clearing and re-decorating,
// grouping and line washes, the diff summary/legend, and whether a text
// selection touches removed content.

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

describe("decorating a rendered document", () => {
    it("marks an added paragraph green and an edited one amber, leaving the rest untouched", () => {
        const root = render(source);

        const res = decorateDiffRanges(root, [
            { startLine: 5, endLine: 5, kind: "added" },
            { startLine: 7, endLine: 7, kind: "modified" },
        ]);

        expect(res.decorated).toBe(2);
        const paragraphs = Array.from(root.querySelectorAll<HTMLElement>("p"));
        expect(paragraphs.map((p) => [p.dataset.diffKind, p.dataset.diffLabel])).toEqual([
            [undefined, undefined],
            ["added", "Added"],
            ["modified", "Edited"],
            [undefined, undefined],
        ]);
    });

    it("does not pollute block text with the corner label", () => {
        // The label is rendered via a CSS ::after using attr(), so decorating must
        // NOT inject any label text into the element — the anchor resolver reads
        // textContent and would break if 'Added'/'Edited' leaked in.
        const root = render(source);
        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        const added = root.querySelector<HTMLElement>(".emr-diff-block--added")!;

        expect(added.textContent).toBe("This paragraph was added.");
    });
    it("shows a block holding both added and edited lines as edited", () => {
        const root = makeRoot([{ tag: "p", start: 3, end: 8 }]);

        const ranges: DiffRange[] = [
            { startLine: 3, endLine: 4, kind: "added" },
            { startLine: 7, endLine: 8, kind: "modified" },
        ];

        decorateDiffRanges(root, ranges);
        const p = root.querySelector("p")!;
        expect(p.dataset.diffKind).toBe("modified");
    });

    it("marks only the outer block when a nested block falls inside the same change", () => {
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

        const res = decorateDiffRanges(root, [{ startLine: 4, endLine: 6, kind: "added" }]);

        expect(res.decorated).toBe(1);
        expect(quote.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(inner.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });

    it("never decorates content without a source position, such as app-inserted UI", () => {
        const root = render("Body text.");
        const injected = document.createElement("p");
        injected.textContent = "Inserted by the app";
        root.prepend(injected);

        const res = decorateDiffRanges(root, [{ startLine: 1, endLine: 1, kind: "added" }]);

        expect(res.decorated).toBe(1);
        expect(injected.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });

    it("keeps the block wash for an edited paragraph when no inline renderer is available", () => {
        const root = render("Reworded sentence here now.");

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
});

describe("re-decorating", () => {
    it("removes every decoration when changes are hidden", () => {
        const root = render(source);
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
    it("replaces the previous diff when re-decorated with a different one", () => {
        const root = makeRoot([
            { tag: "p", start: 5, end: 7 },
            { tag: "p", start: 20, end: 20 },
        ]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 7, kind: "added" }]);

        const res = decorateDiffRanges(root, [{ startLine: 20, endLine: 20, kind: "modified" }]);

        expect(res.decorated).toBe(1);
        const [first, second] = Array.from(root.querySelectorAll("p"));
        expect(first!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
        expect(first!.dataset.diffLabel).toBeUndefined();
        expect(second!.dataset.diffLabel).toBe("Edited");
    });

    it("restores the paragraph text when its word diff is cleared", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5, html: "hello world" }]);

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
});

describe("explained changes", () => {
    it("opens the explanation toward the left when the change sits right of the article's centre", () => {
        const root = render("Retry policy changed.");
        document.body.appendChild(root);
        decorateDiffRanges(root, [{ startLine: 1, endLine: 1, kind: "modified" }]);
        const paragraph = root.querySelector<HTMLElement>(`.${DIFF_TOOLTIP_CLASS}`)!;
        root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 100);
        paragraph.getBoundingClientRect = () => new DOMRect(600, 0, 100, 20);

        paragraph.dispatchEvent(new Event("focus"));

        expect(paragraph.classList.contains(DIFF_TOOLTIP_RIGHT_CLASS)).toBe(true);
    });

    it("leaves the explanation's placement alone outside a rendered article", () => {
        const root = render("Retry policy changed.");
        root.classList.remove("emr-rendered");
        decorateDiffRanges(root, [{ startLine: 1, endLine: 1, kind: "modified" }]);
        const paragraph = root.querySelector<HTMLElement>(`.${DIFF_TOOLTIP_CLASS}`)!;
        const className = paragraph.className;

        paragraph.dispatchEvent(new Event("focus"));

        expect(paragraph.className).toBe(className);
    });
});
describe("contiguous grouping", () => {
    // Blocks washed as a whole (empty or structural ones) join into one
    // continuous change bar when they are adjacent and of the same kind.
    it.each([
        { name: "a lone changed block forms its own bar", count: 1, groups: ["single"] },
        { name: "two adjacent added blocks join into one bar", count: 2, groups: ["start", "end"] },
        {
            name: "three adjacent added blocks join into one bar",
            count: 3,
            groups: ["start", "mid", "end"],
        },
    ])("$name", ({ count, groups }) => {
        const root = makeRoot(
            Array.from({ length: count }, (_, i) => ({ tag: "p", start: 5 + i, end: 5 + i })),
        );

        decorateDiffRanges(root, [{ startLine: 5, endLine: 4 + count, kind: "added" }]);

        expect(Array.from(root.querySelectorAll("p"), (p) => p.dataset.diffGroup)).toEqual(groups);
    });
    it("keeps an added block and an adjacent edited block in separate bars", () => {
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

    it("does not join changed blocks separated by an unchanged one", () => {
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

    it("leaves word-diffed blocks out of the bars", () => {
        const root = makeRoot([
            { tag: "p", start: 5, end: 5, html: "hello world" },
            { tag: "p", start: 6, end: 6, html: "second one" },
        ]);

        decorateDiffRanges(
            root,
            [
                {
                    startLine: 5,
                    endLine: 5,
                    kind: "modified",
                    originalText: "hello",
                },
                {
                    startLine: 6,
                    endLine: 6,
                    kind: "modified",
                    originalText: "second",
                },
            ],
            { renderInline: stubRender },
        );
        // Both became inline → neither carries a group marker.
        const [a, b] = Array.from(root.children) as HTMLElement[];
        expect(a!.dataset.diffGroup).toBeUndefined();
        expect(b!.dataset.diffGroup).toBeUndefined();
    });

    it("removes the bars when changes are hidden", () => {
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

describe("line washes", () => {
    it("fits an added paragraph's wash to its text, keeping its markup", () => {
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
    it("gives each of several adjacent changed paragraphs its own line wash", () => {
        const root = makeRoot([
            { tag: "h2", start: 5, end: 5, html: "Quality gates" },
            { tag: "p", start: 6, end: 6, html: "First changed line." },
            { tag: "p", start: 7, end: 7, html: "Second changed line." },
        ]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 7, kind: "added" }]);

        const blocks = Array.from(root.children) as HTMLElement[];
        expect(
            blocks.map((block) => block.querySelector(".emr-diff-line-wash")?.textContent.trim()),
        ).toEqual(["Quality gates", "First changed line.", "Second changed line."]);
        expect(blocks.map((block) => block.dataset.diffGroup)).toEqual([
            undefined,
            undefined,
            undefined,
        ]);
    });
    it("washes a definition list as a whole block", () => {
        const root = makeRoot([
            {
                tag: "dl",
                start: 5,
                end: 5,
                html: "<dt>Term</dt><dd>Meaning</dd>",
            },
        ]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        expect(root.querySelector(".emr-diff-line-wash")).toBeNull();
        expect(root.querySelector("dl")?.dataset.diffGroup).toBe("single");
    });
    it("fits the wash to a paragraph that starts with whitespace", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5, html: "  <strong>Changed</strong>" }]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        expect(root.querySelector(".emr-diff-line-wash")?.textContent).toBe("  Changed");
    });
    // Defensive: DOM text nodes always report text, but a node whose
    // textContent is null must not be treated as washable text.
    it("washes a block as a whole when its content reports no text", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5, html: "Changed content" }]);
        Object.defineProperty(root.querySelector("p")!.firstChild!, "textContent", {
            configurable: true,
            get: () => null,
        });

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        expect(root.querySelector(".emr-diff-line-wash")).toBeNull();
        expect(root.querySelector("p")?.classList).toContain("emr-diff-block--added");
    });

    it("restores the paragraph markup when its line wash is cleared", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5, html: "Keep <em>this markup</em>." }]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);
        decorateDiffRanges(root, []);

        const paragraph = root.querySelector<HTMLElement>("p")!;
        expect(paragraph.querySelector(".emr-diff-line-wash")).toBeNull();
        expect(paragraph.innerHTML).toBe("Keep <em>this markup</em>.");
        expect(paragraph.dataset.diffLineWash).toBeUndefined();
    });
});

describe("summarizeDiff", () => {
    it("counts nothing for an unchanged file", () => {
        expect(summarizeDiff([])).toEqual({
            added: 0,
            modified: 0,
            deleted: 0,
        });
    });

    it("counts added and edited blocks and the total of removed lines", () => {
        const ranges: DiffRange[] = [
            { startLine: 1, endLine: 2, kind: "added" },
            { startLine: 5, endLine: 5, kind: "added" },
            { startLine: 9, endLine: 12, kind: "modified" },
            {
                startLine: 20,
                endLine: 20,
                kind: "deleted-marker",
                linesDeleted: 3,
            },
            {
                startLine: 40,
                endLine: 40,
                kind: "deleted-marker",
                linesDeleted: 1,
            },
        ];

        expect(summarizeDiff(ranges)).toEqual({
            added: 2,
            modified: 1,
            deleted: 4,
        });
    });

    it("counts a removal whose size was not reported as zero removed lines", () => {
        expect(summarizeDiff([{ startLine: 3, endLine: 3, kind: "deleted-marker" }])).toEqual({
            added: 0,
            modified: 0,
            deleted: 0,
        });
    });
});

describe("reconstructOriginalBlock", () => {
    it("finds no previous block when no edit overlaps it", () => {
        expect(reconstructOriginalBlock({ start: 3, end: 3 }, [], "one\ntwo\nthree")).toBeNull();
    });

    it("finds no previous block when the edit's previous lines would start before the document", () => {
        const edit = {
            start: 2,
            end: 2,
            kind: "modified" as const,
            originalStart: 1,
            originalEnd: 1,
            originalText: "old",
        };

        expect(reconstructOriginalBlock({ start: 1, end: 2 }, [edit], "old")).toBeNull();
    });

    it("finds no previous block when a wider hunk changed its line count", () => {
        const edit = {
            start: 1,
            end: 3,
            kind: "modified" as const,
            originalStart: 1,
            originalEnd: 2,
            originalText: "old one\nold two",
        };

        expect(
            reconstructOriginalBlock({ start: 2, end: 2 }, [edit], "old one\nold two"),
        ).toBeNull();
    });
});
describe("diffLegendStats", () => {
    it.each([
        { name: "nothing changed", stats: { added: 0, modified: 0, deleted: 0 }, legend: [] },
        {
            name: "every kind changed",
            stats: { added: 2, modified: 3, deleted: 4 },
            legend: [
                { kind: "added", label: "2 added" },
                { kind: "modified", label: "3 edited" },
                { kind: "deleted", label: "4 removed" },
            ],
        },
        {
            name: "only edits",
            stats: { added: 0, modified: 1, deleted: 0 },
            legend: [{ kind: "modified", label: "1 edited" }],
        },
        {
            name: "only additions",
            stats: { added: 5, modified: 0, deleted: 0 },
            legend: [{ kind: "added", label: "5 added" }],
        },
    ])("lists only the kinds present when $name", ({ stats, legend }) => {
        expect(diffLegendStats(stats)).toEqual(legend);
    });
});
