import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    MAX_ALIGNMENT_CELLS,
    chunkMarkdownLines,
    chunkSimilarity,
} from "../src/markdown/diffChunks";
import { refineDiffRanges } from "../src/markdown/diffRefine";
import { lineDiffBlocksToRanges } from "../src/shell/adoCommentApi.helpers";
import type { DiffRange } from "../src/types";

const md = (...lines: string[]) => lines.join("\n");

/** Shorthand for a modified range in both sources' line numbers. */
function modified(
    startLine: number,
    endLine: number,
    originalStartLine: number,
    originalEndLine: number,
): DiffRange {
    return {
        startLine,
        endLine,
        kind: "modified",
        originalStartLine,
        originalEndLine,
        linesAdded: endLine - startLine + 1,
        linesDeleted: originalEndLine - originalStartLine + 1,
    };
}

/** Compact view of refined ranges for readable assertions. */
function shape(ranges: readonly DiffRange[]): string[] {
    return ranges.map((range) => {
        if (range.kind === "deleted-marker") {
            return `deleted@${range.startLine} ${JSON.stringify(range.deletedContent)}`;
        }

        if (range.kind === "added") {
            return `added ${range.startLine}-${range.endLine}`;
        }

        return `modified ${range.startLine}-${range.endLine} <- ${range.originalStartLine}-${range.originalEndLine} ${JSON.stringify(range.originalText)}`;
    });
}

describe("chunkMarkdownLines", () => {
    const chunks = (...lines: string[]) =>
        chunkMarkdownLines(lines, 1).map((chunk) => `${chunk.start}-${chunk.end}:${chunk.kind}`);

    it("joins hard-wrapped paragraph lines and keeps blank lines apart", () => {
        expect(chunks("one", "two", "", "three")).toEqual(["1-2:text", "3-3:text", "4-4:text"]);
        const [, blank] = chunkMarkdownLines(["a", "", "b"], 1);
        expect(blank!.blank).toBe(true);
    });

    it("splits list items, headings, comments and math blocks", () => {
        expect(
            chunks(
                "# Title",
                "Text right under a heading",
                "- item one",
                "  wrapped continuation",
                "1. numbered",
                "<!-- note -->",
                "$$",
            ),
        ).toEqual(["1-1:h1", "2-2:text", "3-4:item", "5-5:item", "6-6:text", "7-7:text"]);
    });

    it("keeps tables and quotes whole, ending a table at a non-row line", () => {
        expect(
            chunks("| a | b |", "| - | - |", "| 1 | 2 |", "after", "> q1", "> q2", "lazy"),
        ).toEqual(["1-3:table", "4-4:text", "5-7:quote"]);
        expect(chunkMarkdownLines(["| a |"], 1)[0]!.table).toBe(true);
        expect(chunks("> quote", "| row |")).toEqual(["1-1:quote", "2-2:table"]);
    });

    it("keeps a fenced block whole, including blank and marker-like lines", () => {
        expect(
            chunks("```py", "# comment", "", "- not a list", "```", "after", "~~~", "x", "~~~"),
        ).toEqual(["1-5:fence", "6-6:text", "7-9:fence"]);
    });

    it("offsets line numbers by the first line", () => {
        expect(chunkMarkdownLines(["a", "", "b"], 10).map((c) => c.start)).toEqual([10, 11, 12]);
    });

    it("treats a line holding only spaces as a blank line", () => {
        expect(chunks("First paragraph.", "   ", "Second paragraph.")).toEqual([
            "1-1:text",
            "2-2:text",
            "3-3:text",
        ]);
        expect(chunkMarkdownLines(["a", "   ", "b"], 1)[1]!.blank).toBe(true);
    });

    it.each([
        {
            name: "a code block inside a list item at its indented closing fence",
            lines: ["- Install:", "  ```sh", "  npm ci", "  ```", "Then run it."],
            chunks: ["1-1:item", "2-4:fence", "5-5:text"],
        },
        {
            name: "a code sample that mentions backticks at its own closing fence",
            lines: ["```md", "Wrap code in ```", "```", "after"],
            chunks: ["1-3:fence", "4-4:text"],
        },
    ])("ends $name", ({ lines, chunks: expected }) => {
        expect(chunks(...lines)).toEqual(expected);
    });
});

describe("chunkSimilarity", () => {
    const chunk = (text: string) => chunkMarkdownLines(text.split("\n"), 1)[0]!;

    it.each([
        { name: "identical chunks", a: "same words", b: "same words", score: 1 },
        { name: "a blank chunk against prose", a: " ", b: "words", score: 0 },
        { name: "chunks sharing half their words", a: "a b c d", b: "a b x y", score: 0.5 },
        { name: "chunks differing only in case", a: "A b", b: "a B", score: 1 },
        { name: "two word-less table separators", a: "| - | - |", b: "| - | - | - |", score: 0.5 },
        { name: "a word-less rule against prose", a: "---", b: "words", score: 0 },
        { name: "two identical word-less rules", a: "---", b: "---", score: 1 },
        { name: "an empty line against a line of spaces", a: "", b: "   ", score: 0 },
    ])("scores $name as $score", ({ a, b, score }) => {
        expect(chunkSimilarity(chunk(a), chunk(b))).toBe(score);
    });
});

describe("refineDiffRanges", () => {
    it.each<[string, DiffRange[], string | undefined, string | undefined]>([
        ["the previous source is unavailable", [modified(1, 1, 1, 1)], undefined, "x"],
        ["the current source is unavailable", [modified(1, 1, 1, 1)], "x", undefined],
        [
            "the only change is a removal",
            [{ startLine: 1, endLine: 1, kind: "deleted-marker", linesDeleted: 1 }],
            "gone\nkept",
            "kept",
        ],
    ])("leaves the ranges as they are when %s", (_, ranges, original, current) => {
        expect(refineDiffRanges(ranges, original, current)).toEqual(ranges);
    });

    it("splits a placeholder rewritten into a table and lists (the reported case)", () => {
        const original = md(
            "### Performance",
            "",
            "_Can this impact our topline perf metrics? Does this grow the JS bundle?_",
            "",
            "> TODO: Add links to dashboards for these metrics",
            "",
            "### Security",
        );

        const current = md(
            "### Performance",
            "",
            "We have 3 topline metrics that capture the performance posture of our app.",
            "",
            "| Metric | What it measures? |",
            "| --- | --- |",
            "| EUPL | Time until the view has loaded. |",
            "",
            "1. Does it introduce any new JS payload?",
            "",
            "   1. Benchmark each HVA-",
            "",
            "      1. Locally against the dev app perf plan.",
            "      2. Capture latency numbers from an e2e plan.",
            "",
            "### Security",
        );

        // ADO reports each replacement as one coarse Edit block; the blank line
        // between them is the only unchanged line.
        const ado = lineDiffBlocksToRanges(
            [
                {
                    changeType: 3,
                    originalLineNumberStart: 3,
                    originalLinesCount: 1,
                    modifiedLineNumberStart: 3,
                    modifiedLinesCount: 9,
                },
                {
                    changeType: 3,
                    originalLineNumberStart: 5,
                    originalLinesCount: 1,
                    modifiedLineNumberStart: 13,
                    modifiedLinesCount: 2,
                },
            ],
            original.split("\n"),
        );

        // Both hunks are one rewritten region: the old placeholder and TODO are
        // removed, and every new block — table, list and nested items — is added.
        expect(shape(refineDiffRanges(ado, original, current))).toEqual([
            `deleted@3 "_Can this impact our topline perf metrics? Does this grow the JS bundle?_\\n\\n> TODO: Add links to dashboards for these metrics"`,
            "added 3-14",
        ]);
    });

    it("keeps a one-block-for-one-block hunk exactly as it was", () => {
        const range = { ...modified(1, 2, 1, 1), originalText: "old line" };

        expect(refineDiffRanges([range], "old line", "new wrapped\nparagraph")).toEqual([range]);
    });

    it("pairs an edited paragraph and marks an inserted one as added", () => {
        const original = md("Intro explains the purpose of this doc.", "", "Tail");

        const current = md(
            "Intro explains the goal of this doc.",
            "",
            "A brand new paragraph about scope.",
            "",
            "Tail",
        );

        expect(shape(refineDiffRanges([modified(1, 3, 1, 1)], original, current))).toEqual([
            `modified 1-1 <- 1-1 "Intro explains the purpose of this doc."`,
            "added 3-3",
        ]);
    });

    it("pairs a rewritten heading and paragraph one for one by block shape", () => {
        const original = md("## Scope", "", "Old words entirely.", "", "- x");

        const current = md("## Coverage", "", "Fresh sentence here.", "", "- x");

        expect(shape(refineDiffRanges([modified(1, 3, 1, 3)], original, current))).toEqual([
            `modified 1-1 <- 1-1 "## Scope"`,
            `modified 3-3 <- 3-3 "Old words entirely."`,
        ]);
    });

    it.each([
        {
            name: "a heading and paragraph rewritten as two paragraphs read as removed and added",
            original: md("## Scope", "", "Old words entirely."),
            current: md("Plain intro sentence.", "", "Fresh sentence here."),
            shape: [`deleted@1 "## Scope\\n\\nOld words entirely."`, "added 1-3"],
        },
        {
            name: "a numbered step rewritten as a paragraph reads as removed and added",
            original: md("## Steps", "", "12. Old words entirely."),
            current: md("## Steps", "", "Fresh sentence here."),
            shape: [`deleted@3 "12. Old words entirely."`, "added 3-3"],
        },
        {
            name: "a paragraph about C# rewritten under a renamed heading reads as edits",
            original: md("## Stack", "", "C# powers the server today."),
            current: md("## Platform", "", "Rust replaced it last year."),
            shape: [
                `modified 1-1 <- 1-1 "## Stack"`,
                `modified 3-3 <- 3-3 "C# powers the server today."`,
            ],
        },
        {
            name: "a heading whose text was cleared reads as an edit",
            original: md("## Old title", "", "Old words entirely."),
            current: md("##", "", "Fresh sentence here."),
            shape: [
                `modified 1-1 <- 1-1 "## Old title"`,
                `modified 3-3 <- 3-3 "Old words entirely."`,
            ],
        },
        {
            name: "a list item whose text was cleared reads as an edit",
            original: md("## Steps", "", "- Old words entirely."),
            current: md("## Steps", "", "-"),
            shape: [`modified 3-3 <- 3-3 "- Old words entirely."`],
        },
    ])("$name", ({ original, current, shape: expected }) => {
        expect(shape(refineDiffRanges([modified(1, 3, 1, 3)], original, current))).toEqual(
            expected,
        );
    });

    it("reports how many lines each refined change adds and removes", () => {
        const original = md("First old text here.", "", "Shared block", "", "Old end.");

        const current = md(
            "Totally different start.",
            "",
            "Another one.",
            "",
            "Shared block",
            "",
            "Brand new ending.",
        );

        expect(
            refineDiffRanges([modified(1, 7, 1, 5)], original, current).map(
                ({ kind, linesAdded, linesDeleted }) => ({ kind, linesAdded, linesDeleted }),
            ),
        ).toEqual([
            { kind: "deleted-marker", linesAdded: 0, linesDeleted: 1 },
            { kind: "added", linesAdded: 3, linesDeleted: 0 },
            { kind: "modified", linesAdded: 1, linesDeleted: 1 },
        ]);
    });

    it("counts every line of a removed multi-line region", () => {
        const original = md("## Scope", "", "Old words entirely.");
        const current = md("Plain intro sentence.", "", "Fresh sentence here.");

        expect(refineDiffRanges([modified(1, 3, 1, 3)], original, current)).toEqual([
            expect.objectContaining({ kind: "deleted-marker", linesDeleted: 3 }),
            expect.objectContaining({ kind: "added", linesAdded: 3 }),
        ]);
    });

    it("shows a list item moved below its similar neighbour as removed above and added below", () => {
        const original = md("- Run the unit tests", "- Run the e2e tests");
        const current = md("- Run the e2e tests", "- Run the unit tests");

        expect(shape(refineDiffRanges([modified(1, 2, 1, 2)], original, current))).toEqual([
            `deleted@1 "- Run the unit tests"`,
            "added 2-2",
        ]);
    });

    it.each([
        {
            name: "a reworded line that also took in a blank line",
            range: modified(1, 2, 1, 1),
            original: "old line\nnext",
            current: "new line\n\nnext",
        },
        {
            name: "a hard-wrapped paragraph whose last line was reworded",
            range: modified(1, 3, 1, 3),
            original: md(
                "Reviewers open the document,",
                "read every section,",
                "and leave comments.",
            ),
            current: md(
                "Reviewers open the document,",
                "read every section,",
                "and approve the change.",
            ),
        },
    ])("keeps $name as one edit", ({ range, original, current }) => {
        expect(refineDiffRanges([range], original, current)).toEqual([range]);
    });

    it("drops an unchanged block that a coarse hunk swallowed", () => {
        const original = md("First old text here.", "", "Shared block", "", "Old end.");

        const current = md(
            "Totally different start.",
            "",
            "Another one.",
            "",
            "Shared block",
            "",
            "Brand new ending.",
        );

        expect(shape(refineDiffRanges([modified(1, 7, 1, 5)], original, current))).toEqual([
            `deleted@1 "First old text here."`,
            "added 1-3",
            `modified 7-7 <- 5-5 "Old end."`,
        ]);
    });

    it("places a trailing removal before the next current line", () => {
        const original = md("Keep me please.", "", "Remove me now.", "after");
        const current = md("Keep me please!", "after");
        expect(shape(refineDiffRanges([modified(1, 1, 1, 3)], original, current))).toEqual([
            `modified 1-1 <- 1-1 "Keep me please."`,
            `deleted@2 "Remove me now."`,
        ]);
    });

    describe("tables", () => {
        const table = (...rows: string[]) => md("| Name | Owner |", "| --- | --- |", ...rows);

        it("aligns rows when the header is unchanged", () => {
            const original = table("| Parser | Ana |", "| Renderer | Bo |");

            const current = table(
                "| Parser | Ana |",
                "| Renderer | Bo Smith |",
                "| Exporter | Cy |",
            );

            expect(shape(refineDiffRanges([modified(4, 5, 4, 4)], original, current))).toEqual([
                `modified 4-4 <- 4-4 "| Renderer | Bo |"`,
                "added 5-5",
            ]);
        });

        it("aligns the rows of a whole table whose header is unchanged", () => {
            const original = table("| Parser | Ana |");
            const current = table("| Parser | Ana |", "| Exporter | Cy |");
            expect(shape(refineDiffRanges([modified(1, 4, 1, 3)], original, current))).toEqual([
                "added 4-4",
            ]);
        });

        it("keeps a table whole when its header changed", () => {
            const original = table("| Parser | Ana |");

            const current = md(
                "| Component | Owner |",
                "| --- | --- |",
                "| Parser | Ana |",
                "| Exporter | Cy |",
            );

            const range = modified(1, 4, 1, 3);
            expect(refineDiffRanges([range], original, current)).toEqual([range]);
        });

        it("keeps a table whole when only one side's slice starts at the header", () => {
            // The original hunk covers a body row; the current one the whole table.
            const original = table("| Parser | Ana |");
            const current = table("| Parser | Bo |");
            const range = modified(1, 3, 3, 3);
            expect(refineDiffRanges([range], original, current)).toEqual([range]);
        });

        it("leaves a single edited row to the cell diff", () => {
            const original = table("| Parser | Ana |", "| Renderer | Bo |");
            const current = table("| Parser | Ana |", "| Exporter | Cy |");
            const range = modified(4, 4, 4, 4);
            expect(refineDiffRanges([range], original, current)).toEqual([range]);
        });

        it("splits an edited row from the row removed below it", () => {
            const original = table("| Parser | Ana |", "| Renderer | Bo |");
            const current = table("| Parser | Ana Lee |");
            expect(shape(refineDiffRanges([modified(3, 3, 3, 4)], original, current))).toEqual([
                `modified 3-3 <- 3-3 "| Parser | Ana |"`,
                `deleted@4 "| Renderer | Bo |"`,
            ]);
        });

        it("still aligns a table as long as the alignment limit allows row by row", () => {
            const lines = Math.sqrt(MAX_ALIGNMENT_CELLS);

            const body = (value: string) =>
                Array.from({ length: lines - 2 }, (_, i) => `| r${i} | ${value} |`);

            expect(
                refineDiffRanges(
                    [modified(1, lines, 1, lines)],
                    table(...body("old")),
                    table(...body("new")),
                ),
            ).toHaveLength(lines - 2);
        });
    });

    describe("regions split by blank-line anchors", () => {
        const original = md(
            "## Scope",
            "",
            "The first release covers design notes and runbooks.",
            "",
            "## Open questions",
            "",
            "- Which teams should join the pilot?",
        );

        const current = md(
            "## Launch follow-up",
            "",
            "- The launch owner reviews findings.",
            "",
            "## Scope",
            "",
            "The pilot covers design notes and runbooks.",
        );

        // A line diff pins the blank lines and pairs unrelated blocks 1:1.
        const lineDiff = [
            modified(1, 1, 1, 1),
            modified(3, 3, 3, 3),
            modified(5, 5, 5, 5),
            modified(7, 7, 7, 7),
        ].map((range) => ({
            ...range,
            originalText: original.split("\n")[range.originalStartLine! - 1],
        }));

        it("re-aligns the whole region so moved and edited blocks pair correctly", () => {
            expect(shape(refineDiffRanges(lineDiff, original, current))).toEqual([
                "added 1-3",
                `modified 7-7 <- 3-3 "The first release covers design notes and runbooks."`,
                `deleted@8 "## Open questions\\n\\n- Which teams should join the pilot?"`,
            ]);
        });

        it("refines each hunk alone when a range disagrees with the sources", () => {
            const disagreeing = [...lineDiff];
            disagreeing[1] = { ...disagreeing[1]!, originalStartLine: 2 };
            expect(refineDiffRanges(disagreeing, original, current)).toEqual(disagreeing);
        });

        it("treats separator lines holding only spaces as blank lines", () => {
            const spaced = (source: string) => source.replace(/^$/gm, "  ");

            expect(
                shape(refineDiffRanges(lineDiff, spaced(original), spaced(current))).slice(0, 2),
            ).toEqual([
                "added 1-3",
                `modified 7-7 <- 3-3 "The first release covers design notes and runbooks."`,
            ]);
        });
    });

    it("leaves a region that only gained lines untouched", () => {
        const ranges: DiffRange[] = [
            { startLine: 2, endLine: 2, kind: "added", linesAdded: 1 },
            { startLine: 4, endLine: 4, kind: "added", linesAdded: 1 },
        ];

        expect(refineDiffRanges(ranges, "a\n\nb", "a\nnew\n\nnewer\nb")).toEqual(ranges);
    });

    it("re-pairs a deletion and an addition that are one edit", () => {
        const original = md("Context.", "", "The old guidance about retries.", "", "End.");

        const current = md("Context.", "", "The new guidance about retries.", "", "End.");

        const ranges: DiffRange[] = [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "The old guidance about retries.",
            },
            { startLine: 3, endLine: 3, kind: "added", linesAdded: 1 },
        ];

        expect(shape(refineDiffRanges(ranges, original, current))).toEqual([
            `modified 3-3 <- 3-3 "The old guidance about retries."`,
        ]);
    });

    it("re-pairs a deletion and an addition at the end of the document", () => {
        const original = md("Context.", "", "The old guidance about retries.");
        const current = md("Context.", "", "The new guidance about retries.");

        const ranges: DiffRange[] = [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "The old guidance about retries.",
            },
            { startLine: 3, endLine: 3, kind: "added", linesAdded: 1 },
        ];

        expect(shape(refineDiffRanges(ranges, original, current))).toEqual([
            `modified 3-3 <- 3-3 "The old guidance about retries."`,
        ]);
    });

    it("keeps a deletion apart from an addition when its text isn't in the previous version", () => {
        const original = md("Context.", "", "The old guidance about retries.", "", "End.");
        const current = md("Context.", "", "The new guidance about retries.", "", "End.");

        const ranges: DiffRange[] = [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "Something else entirely.",
            },
            { startLine: 3, endLine: 3, kind: "added", linesAdded: 1 },
        ];

        expect(refineDiffRanges(ranges, original, current)).toEqual(ranges);
    });

    it("refines an edit together with the removal of the closing paragraph", () => {
        const original = md("Intro old words.", "", "Closing words.");
        const current = md("Intro new words.", "");

        const ranges: DiffRange[] = [
            modified(1, 1, 1, 1),
            { startLine: 3, endLine: 3, kind: "deleted-marker", linesDeleted: 1 },
        ];

        expect(shape(refineDiffRanges(ranges, original, current))).toEqual([
            `modified 1-1 <- 1-1 "Intro old words."`,
            `deleted@3 "Closing words."`,
        ]);
    });

    it("does not touch a lone deletion beside unrelated content", () => {
        const ranges: DiffRange[] = [
            { startLine: 1, endLine: 1, kind: "added", linesAdded: 1 },
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 1,
            },
        ];

        // The deletion has no recorded text, so it's placed by offset alone.
        expect(refineDiffRanges(ranges, "x\n\nold", "new\nx\n")).toEqual(ranges);
    });

    it.each<[string, DiffRange[], string, string]>([
        [
            "a deletion whose text doesn't match the original",
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "deleted-marker",
                    linesDeleted: 1,
                    deletedContent: "nope",
                },
                modified(2, 2, 3, 3),
            ],
            "gone\nkeep\nold",
            "keep\nnew",
        ],
        [
            "a deletion with no lines",
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "deleted-marker",
                    linesDeleted: 0,
                },
                modified(2, 2, 2, 2),
            ],
            "keep\nold",
            "keep\nnew",
        ],
        [
            "a deletion with no recorded line count",
            [{ startLine: 1, endLine: 1, kind: "deleted-marker" }, modified(2, 2, 2, 2)],
            "keep\nold",
            "keep\nnew",
        ],
        [
            "a deletion past the end of the original",
            [
                {
                    startLine: 3,
                    endLine: 3,
                    kind: "deleted-marker",
                    linesDeleted: 5,
                },
                modified(1, 1, 1, 1),
            ],
            "old\nkeep",
            "new\nkeep",
        ],
        ["overlapping ranges", [modified(1, 2, 1, 2), modified(2, 2, 2, 2)], "a\nb", "c\nd"],
    ])("falls back to per-hunk refinement for %s", (_, ranges, original, current) => {
        expect(refineDiffRanges(ranges, original, current)).toEqual(ranges);
    });

    it.each<[string, DiffRange[]]>([
        [
            "a modified range without original lines",
            [{ startLine: 1, endLine: 1, kind: "modified" }],
        ],
        ["a range past the end of the current source", [modified(1, 9, 1, 3)]],
        ["a range past the end of the original source", [modified(1, 3, 1, 9)]],
        ["a range starting before the first line", [modified(0, 3, 1, 3)]],
        ["a range ending before it starts", [modified(3, 1, 1, 3)]],
        ["an edit whose previous lines start before the first line", [modified(1, 3, 0, 3)]],
        ["an edit whose previous lines end before they start", [modified(1, 3, 3, 1)]],
        [
            "an edit missing where its previous lines end",
            [{ ...modified(1, 3, 1, 3), originalEndLine: undefined }],
        ],
        [
            "an edit missing where its previous lines start",
            [{ ...modified(1, 3, 1, 3), originalStartLine: undefined }],
        ],
        [
            "an addition past the end of the current source",
            [{ startLine: 1, endLine: 9, kind: "added", linesAdded: 9 }],
        ],
        [
            "one range past the end alongside one that fits",
            [modified(1, 1, 1, 1), modified(3, 9, 3, 3)],
        ],
    ])("leaves the input alone for %s", (_, ranges) => {
        expect(refineDiffRanges(ranges, "a\n\nb", "c\n\nd")).toEqual(ranges);
    });

    it("leaves a region too large to align coarse", () => {
        const size = Math.ceil(Math.sqrt(MAX_ALIGNMENT_CELLS)) + 1;

        const original = Array.from({ length: size }, (_, i) => `old ${i}`).join("\n\n");

        const current = Array.from({ length: size }, (_, i) => `new ${i}`).join("\n\n");

        const lines = size * 2 - 1;
        const range = modified(1, lines, 1, lines);
        expect(refineDiffRanges([range], original, current)).toEqual([range]);
    });

    it("still aligns a list as long as the alignment limit allows item by item", () => {
        const items = Math.sqrt(MAX_ALIGNMENT_CELLS);

        const list = (value: string) =>
            Array.from({ length: items }, (_, i) => `- ${value} step ${i}`).join("\n");

        expect(
            refineDiffRanges([modified(1, items, 1, items)], list("old"), list("new")),
        ).toHaveLength(items);
    });

    it("keeps edits inside one code fence as one code edit", () => {
        // Hunks on either side of a blank line inside a fence are merged; the
        // clipped fragments stay code even though one starts with `# `.
        const original = md("```sh", "# install deps", "", "npm ci", "```");
        const current = md("```sh", "pnpm install", "", "pnpm test", "```");
        const ranges = [modified(2, 2, 2, 2), modified(4, 4, 4, 4)];
        expect(shape(refineDiffRanges(ranges, original, current))).toEqual([
            `modified 2-4 <- 2-4 "# install deps\\n\\nnpm ci"`,
        ]);
    });

    it("still refines each hunk on its own when ranges can't be placed", () => {
        const original = md("Intro explains the purpose of this doc.", "", "Tail");

        const current = md(
            "Intro explains the goal of this doc.",
            "",
            "A brand new paragraph about scope.",
            "",
            "Tail",
        );

        const ranges: DiffRange[] = [
            modified(1, 3, 1, 1),
            // Overlaps the first range, so the ranges can't be placed together.
            { startLine: 2, endLine: 2, kind: "added", linesAdded: 1 },
        ];

        expect(shape(refineDiffRanges(ranges, original, current))).toEqual([
            `modified 1-1 <- 1-1 "Intro explains the purpose of this doc."`,
            "added 3-3",
            "added 2-2",
        ]);
    });

    it("keeps a table too large to align row by row as one pair", () => {
        const rows = Math.ceil(Math.sqrt(MAX_ALIGNMENT_CELLS)) + 1;

        const body = (value: string) =>
            Array.from({ length: rows }, (_, i) => `| r${i} | ${value} |`);

        const original = md(
            "| K | V |",
            "| - | - |",
            ...body("old"),
            "",
            "Old tail words.",
            "",
            "Second old para.",
        );

        const current = md("| K | V |", "| - | - |", ...body("new"), "", "New tail words.");

        const end = rows + 2;
        expect(
            shape(refineDiffRanges([modified(3, end + 2, 3, end + 4)], original, current)),
        ).toEqual([
            `modified 3-${end} <- 3-${end} ${JSON.stringify(body("old").join("\n"))}`,
            `modified ${end + 2}-${end + 2} <- ${end + 2}-${end + 2} "Old tail words."`,
            `deleted@${end + 3} "Second old para."`,
        ]);
    });

    it("places a multi-line CRLF deletion and still merges the region", () => {
        const original =
            "Keep.\r\n\r\nGone one\r\nGone two\r\n\r\nThe old guidance about retries.\r\n";

        const current = "Keep.\r\n\r\nThe new guidance about retries.\r\n";

        const ranges: DiffRange[] = [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 3,
                deletedContent: "Gone one\r\nGone two\r\n",
            },
            modified(3, 3, 6, 6),
        ];

        expect(shape(refineDiffRanges(ranges, original, current))).toEqual([
            `deleted@3 "Gone one\\nGone two"`,
            `modified 3-3 <- 6-6 "The old guidance about retries."`,
        ]);
    });

    it("doesn't merge across a deletion past the end of the current source", () => {
        const ranges: DiffRange[] = [
            modified(1, 1, 1, 1),
            {
                startLine: 4,
                endLine: 4,
                kind: "deleted-marker",
                linesDeleted: 1,
            },
        ];

        expect(refineDiffRanges(ranges, "a\nb\nc\nd", "x\n")).toEqual(ranges);
    });

    it("reads CRLF sources", () => {
        const original = "Keep this text.\r\n\r\nTail";

        const current = "Keep this text!\r\n\r\nBrand new paragraph.\r\n\r\nTail";

        expect(shape(refineDiffRanges([modified(1, 3, 1, 1)], original, current))).toEqual([
            `modified 1-1 <- 1-1 "Keep this text."`,
            "added 3-3",
        ]);
    });

    // Real `getFileDiffs` blocks captured from the sandbox PR for
    // `sandbox/repos/rewrite-diff-showcase` (the e2e suite drives the same PR).
    it("refines the real ADO hunks of the rewrite-diff showcase", () => {
        const repo = resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../sandbox/repos/rewrite-diff-showcase",
        );

        const original = readFileSync(`${repo}/main/design-review.md`, "utf8");

        const current = readFileSync(`${repo}/prs/restructure-design-doc/design-review.md`, "utf8");

        // [changeType, originalStart, originalCount, modifiedStart, modifiedCount]
        const blocks = [
            [3, 15, 1, 15, 1],
            [3, 17, 1, 17, 5],
            [1, 19, 0, 23, 18],
            [3, 25, 1, 47, 1],
            [1, 27, 0, 49, 3],
            [3, 30, 1, 55, 3],
            [3, 38, 1, 65, 2],
            [3, 42, 3, 70, 7],
            [3, 48, 1, 80, 1],
            [3, 50, 1, 82, 1],
            [3, 52, 2, 84, 1],
            [3, 55, 1, 86, 1],
            [2, 61, 4, 92, 0],
            [3, 67, 1, 94, 1],
        ].map(([changeType, os, oc, ms, mc]) => ({
            changeType,
            originalLineNumberStart: os,
            originalLinesCount: oc,
            modifiedLineNumberStart: ms,
            modifiedLinesCount: mc,
        }));

        const ado = lineDiffBlocksToRanges(blocks, original.split(/\r?\n/));
        expect(shape(refineDiffRanges(ado, original, current))).toEqual([
            // Performance: placeholder + TODO → metrics guidance, table, nested list.
            `deleted@15 "_Can this impact our topline perf metrics – EUPL, interaction latency, R.A.P? Does this lead to an increase in JS bundle size because of a new dependency?_\\n\\n> TODO: Add links to dashboards for these metrics"`,
            "added 15-39",
            // Motivation: an edit, then a new paragraph.
            `modified 47-47 <- 25-25 "Reviewers lose comments when their connection drops mid-review."`,
            "added 49-50",
            // Requirements: one edited item, two inserted.
            `modified 55-55 <- 30-30 "- Drafts sync without duplicates"`,
            "added 56-57",
            // Ownership: one edited row, one inserted row.
            `modified 65-65 <- 38-38 "| Sync | Bo | In progress |"`,
            "added 66-66",
            // Rollout: the first step removed; the renumbered steps pair with their
            // originals (the renderer shows them unchanged). A section added, the
            // scope paragraph edited across ADO's blank-line-anchored hunks.
            `deleted@70 "1. Clone the feature branch."`,
            `modified 70-70 <- 43-43 "2. Build the extension."`,
            `modified 71-71 <- 44-44 "3. Run the end-to-end suite."`,
            "added 73-76",
            `modified 80-80 <- 48-48 "The first release covers engineering design notes and operational runbooks."`,
            // Open questions removed; the moved Promote section added.
            `deleted@82 "## Open questions\\n\\n- Which teams should join the pilot?\\n- How should reviewers record approval?"`,
            "added 84-86",
            // Phases swapped (ADO's own deletion, passed through) …
            `deleted@92 "### Promote\\n\\nPromote the package after validation completes.\\n"`,
            // Risks: a same-shape rewrite stays an edit.
            `modified 94-94 <- 67-67 "Storage quota may be exceeded on very long reviews."`,
        ]);
    });
});
