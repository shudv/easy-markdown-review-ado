import { beforeEach, describe, expect, it } from "vitest";

import {
    decorateDiffRanges,
    DIFF_DELETED_MARKER_CLASS,
    DIFF_SOURCE_ONLY_CLASS,
    selectionTouchesDeletedDiff,
} from "../src/markdown/diffDecorations";
import { renderMarkdownSync } from "../src/markdown/render";
import type { DiffRange } from "../src/types";
import { decorate, lines, makeRoot, render, stubRender } from "./markdownDiffHarness";

// Content that is no longer (or never was) rendered: removal markers, changes
// to source that renders no element, and whether a text selection touches
// removed content (which can't be commented on).

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("removed lines", () => {
    it("shows removed lines as a collapsed marker before the block that follows them", () => {
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

        const marker = root.querySelector<HTMLElement>(`.${DIFF_DELETED_MARKER_CLASS}`)!;

        expect(marker).not.toBeNull();
        // Inserted right before the second paragraph.
        expect(marker.nextElementSibling?.getAttribute("data-source-line")).toBe("10");
        expect(marker.getAttribute("aria-label")).toBe("2 lines removed");
        expect(marker.getAttribute("role")).toBe("note");
        expect(marker.querySelector(".emr-diff-deleted-rail")?.getAttribute("aria-hidden")).toBe(
            "true",
        );

        const body = marker.querySelector<HTMLElement>(".emr-diff-deleted-body")!;

        expect(body.hidden).toBe(true);
        expect(body.textContent).toBe("gone line one\ngone line two");

        const chip = marker.querySelector<HTMLButtonElement>(".emr-diff-deleted-chip")!;

        expect(chip.getAttribute("aria-expanded")).toBe("false");
        chip.click();
        expect(body.hidden).toBe(false);
        expect(chip.getAttribute("aria-expanded")).toBe("true");
        chip.click();
        expect(body.hidden).toBe(true);
        expect(chip.getAttribute("aria-expanded")).toBe("false");
    });

    it("expands a removal whose text wasn't recorded to an empty body", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);

        decorateDiffRanges(root, [
            { startLine: 5, endLine: 5, kind: "deleted-marker", linesDeleted: 1 },
        ]);

        expect(root.querySelector(".emr-diff-deleted-body")?.textContent).toBe("");
    });

    it("shows removed lines without the blank lines that followed them", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);

        decorateDiffRanges(root, [
            {
                startLine: 5,
                endLine: 5,
                kind: "deleted-marker",
                linesDeleted: 3,
                deletedContent: "Gone paragraph.\n\n\n",
            },
        ]);

        expect(root.querySelector(".emr-diff-deleted-body")?.textContent).toBe("Gone paragraph.");
    });

    it("labels a single removed line in the singular", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);
        decorateDiffRanges(root, [
            {
                startLine: 5,
                endLine: 5,
                kind: "deleted-marker",
                linesDeleted: 1,
            },
        ]);
        const chip = root.querySelector(".emr-diff-deleted-chip")!;
        expect(chip.textContent).toBe("1 line removed");
    });
    // `linesDeleted` is optional in the DiffRange contract; a producer that
    // omits it gets a zero count rather than "undefined lines removed".
    it("labels a removal whose size was not reported as zero lines", () => {
        const root = makeRoot([{ tag: "p", start: 5, end: 5 }]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "deleted-marker" }]);

        expect(root.querySelector(".emr-diff-deleted-chip")?.textContent).toBe("0 lines removed");
    });
    it("shows lines removed from the end of the document after the last block", () => {
        const root = makeRoot([{ tag: "p", start: 1, end: 1 }]);

        const res = decorateDiffRanges(root, [
            {
                startLine: 99,
                endLine: 99,
                kind: "deleted-marker",
                linesDeleted: 3,
            },
        ]);

        expect(res.markers).toBe(1);
        expect(root.lastElementChild?.classList.contains(DIFF_DELETED_MARKER_CLASS)).toBe(true);
    });

    it("places a removal marker before a Mermaid diagram that follows it", () => {
        const root = render(lines("Intro.", "", "```mermaid", "flowchart LR", "```"));
        const diagram = root.querySelector(".emr-mermaid")!;

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 2,
                deletedContent: "gone\ngone two\n",
            },
        ]);

        expect(res.markers).toBe(1);

        const marker = root.querySelector<HTMLElement>(`.${DIFF_DELETED_MARKER_CLASS}`)!;

        expect(marker.nextElementSibling).toBe(diagram);
    });
    it("renders removed lines as Markdown inside the marker", () => {
        const root = render(["# Title", "", "Kept paragraph."].join("\n"));
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

    it("shows removed lines as raw source when no inline renderer is available", () => {
        const root = render(["# Title", "", "Kept paragraph."].join("\n"));
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
        expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)?.textContent).toContain("Moved");
        expect(
            root
                .querySelector("h2[data-source-line='7']")
                ?.classList.contains("emr-diff-block--added"),
        ).toBe(true);
    });
});

describe("changes with no rendered element", () => {
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
                    originalText: "[ch16]: http://localhost:3000/ch16-00-concurrency.html",
                },
            ],
            original,
            current,
        );

        expect(result.decorated).toBe(1);

        const marker = root.querySelector<HTMLElement>(`.${DIFF_SOURCE_ONLY_CLASS}`)!;

        expect(marker.querySelector(".emr-diff-source-only-label")?.textContent).toBe(
            "Source changed",
        );
        expect(marker.querySelector(".emr-diff-source-only-current code")?.textContent).toBe(
            "[ch16]: ch16-00-concurrency.html",
        );
        expect(marker.nextElementSibling?.tagName).toBe("P");
        expect(selectionTouchesDeletedDiff(marker, marker)).toBe(true);

        const trigger = marker.querySelector<HTMLButtonElement>(
            ".emr-diff-before-control--source .emr-diff-before-trigger",
        )!;

        const panel = marker.querySelector<HTMLElement>(".emr-diff-before-panel")!;

        expect(trigger.textContent).toBe("Before");
        expect(trigger.getAttribute("aria-label")).toBe("Show previous source");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(panel.id).not.toBe("");
        expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
        expect(panel.hidden).toBe(true);
        trigger.click();
        expect(panel.hidden).toBe(false);
        expect(trigger.textContent).toBe("Hide");
        expect(trigger.getAttribute("aria-label")).toBe("Hide previous source");
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(panel.querySelector("code")?.textContent).toBe(
            "[ch16]: http://localhost:3000/ch16-00-concurrency.html",
        );
        trigger.click();
        expect(panel.hidden).toBe(true);
        expect(trigger.textContent).toBe("Before");
        expect(trigger.getAttribute("aria-label")).toBe("Show previous source");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        decorate(root, []);
        expect(root.querySelector(`.${DIFF_SOURCE_ONLY_CLASS}`)).toBeNull();
    });

    it("shows every line of a multi-line change that renders no element", () => {
        const current = lines("[a]: one.html", "[b]: two.html", "", "See [A][a] and [B][b].");

        const original = lines(
            "[a]: old-one.html",
            "[b]: old-two.html",
            "",
            "See [A][a] and [B][b].",
        );

        const root = render(current);

        decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 2,
                    kind: "modified",
                    originalText: "[a]: old-one.html\n[b]: old-two.html",
                },
            ],
            original,
            current,
        );

        expect(root.querySelector(".emr-diff-source-only-current code")?.textContent).toBe(
            "[a]: one.html\n[b]: two.html",
        );
    });

    it("offers no previous source for a changed definition whose old text is unknown", () => {
        const current = lines("[a]: one.html", "", "See [A][a].");
        const root = render(current);

        decorate(root, [{ startLine: 1, endLine: 1, kind: "modified" }], undefined, current);

        const marker = root.querySelector<HTMLElement>(`.${DIFF_SOURCE_ONLY_CLASS}`)!;

        expect(marker.querySelector(".emr-diff-source-only-label")?.textContent).toBe(
            "Source changed",
        );
        expect(marker.querySelector(".emr-diff-before-trigger")).toBeNull();
    });

    it("shows an added dialect directive that renders no DOM node", () => {
        const current = ["<Feature enabled />", "", "Visible prose."].join("\n");

        const root = render(current);
        decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }], undefined, current);

        const marker = root.querySelector<HTMLElement>(`.${DIFF_SOURCE_ONLY_CLASS}`)!;

        expect(marker.dataset.diffKind).toBe("added");
        expect(marker.querySelector(".emr-diff-source-only-label")?.textContent).toBe(
            "Source added",
        );
        expect(marker.textContent).toContain("<Feature enabled />");
        expect(marker.querySelector(".emr-diff-before-trigger")).toBeNull();
    });

    it("shows a source-only change in a document that renders nothing", () => {
        const root = render("<!-- current directive -->");

        const result = decorate(
            root,
            [{ startLine: 1, endLine: 1, kind: "added" }],
            undefined,
            "<!-- current directive -->",
        );

        expect(result.decorated).toBe(1);
        expect(root.lastElementChild?.classList.contains(DIFF_SOURCE_ONLY_CLASS)).toBe(true);
    });

    it.each([
        { name: "an empty line", source: "Visible prose.\n\n" },
        { name: "a line of spaces", source: "Visible prose.\n   \n" },
    ])("does not invent a source strip for a changed $name", ({ source }) => {
        const root = render(source);

        const result = decorate(
            root,
            [{ startLine: 2, endLine: 2, kind: "added" }],
            undefined,
            source,
        );

        expect(result.decorated).toBe(0);
        expect(root.querySelector(`.${DIFF_SOURCE_ONLY_CLASS}`)).toBeNull();
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

        const outEl = [...root.children].find((c) => c.tagName === "P") as HTMLElement;

        const body = root.querySelector<HTMLElement>(".emr-diff-deleted-body")!;

        return {
            outEl,
            outText: outEl.firstChild,
            inText: body.querySelector("p")!.firstChild,
        };
    }

    type Single = ReturnType<typeof setup>;

    it.each([
        {
            name: "the anchor is inside removed text",
            pick: (s: Single) => [s.inText, s.outText] as const,
            touches: true,
        },
        {
            name: "only the focus is inside removed text",
            pick: (s: Single) => [s.outEl, s.inText] as const,
            touches: true,
        },
        {
            name: "both ends are in live text",
            pick: (s: Single) => [s.outEl, s.outText] as const,
            touches: false,
        },
        { name: "there is no selection", pick: () => [null, null] as const, touches: false },
    ])("when $name, the selection touches removed text: $touches", ({ pick, touches }) => {
        const [anchor, focus] = pick(setup());
        expect(selectionTouchesDeletedDiff(anchor, focus)).toBe(touches);
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

    type Spanning = ReturnType<typeof setupSpanning>;

    it.each([
        { name: "forwards", pick: (s: Spanning) => [s.beforeText, s.afterText] as const },
        { name: "backwards", pick: (s: Spanning) => [s.afterText, s.beforeText] as const },
    ])("reports true for a selection made $name across a removal marker", ({ pick }) => {
        const [anchor, focus] = pick(setupSpanning());
        expect(selectionTouchesDeletedDiff(anchor, focus)).toBe(true);
    });

    /** `[pBefore, "Before" panel, pAfter]`, with the panel open or collapsed. */
    function setupBeforePanel(open: boolean) {
        const root = document.createElement("div");
        root.innerHTML =
            "<p>before text</p>" +
            '<div class="emr-diff-before-panel"><p>old wording</p></div>' +
            "<p>after text</p>";
        root.querySelector<HTMLElement>(".emr-diff-before-panel")!.hidden = !open;
        const [first, , last] = [...root.querySelectorAll("p")];

        return { beforeText: first!.firstChild, afterText: last!.firstChild };
    }

    it("reports true for a selection spanning an open Before panel", () => {
        const { beforeText, afterText } = setupBeforePanel(true);
        // The open panel's reference text would be swept into the selection.
        expect(selectionTouchesDeletedDiff(beforeText, afterText)).toBe(true);
        expect(selectionTouchesDeletedDiff(afterText, beforeText)).toBe(true);
    });

    it("reports false for a selection spanning a collapsed Before panel", () => {
        const { beforeText, afterText } = setupBeforePanel(false);
        // Collapsed panels sit beside every changed block but select no text, so
        // they must not withhold commenting on the live text around them.
        expect(selectionTouchesDeletedDiff(beforeText, afterText)).toBe(false);
    });
});
