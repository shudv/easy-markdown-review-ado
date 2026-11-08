import { beforeEach, describe, expect, it } from "vitest";

import { DIFF_INLINE_CLASS } from "../src/markdown/diffDecorations";
import type { DiffRange } from "../src/types";
import {
    decorate,
    diffView,
    expectComparisonAmber,
    lines,
    render,
    summarize,
    view,
    words,
} from "./markdownDiffHarness";

// Rendered diff of prose paragraphs: word-level edits, wholesale rewrites,
// lines added to or removed from inside a paragraph, and edits that render
// identically (which are hidden).

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("edited paragraphs", () => {
    it.each([
        {
            name: "an inserted word",
            original: "The quick fox jumps.",
            current: "The quick brown fox jumps.",
            expected: ["p modified inline: The quick {+brown +}fox jumps."],
        },
        {
            name: "a deleted word",
            original: "The quick brown fox jumps.",
            current: "The quick fox jumps.",
            expected: ["p modified inline: The quick [-brown -]fox jumps."],
        },
        {
            name: "a typo fix",
            original: "Teh quick fox.",
            current: "The quick fox.",
            expected: ["p modified inline: [-Teh-]{+The+} quick fox."],
        },
        {
            name: "changed punctuation",
            original: "Hello world.",
            current: "Hello world!",
            expected: ["p modified inline: Hello world[-.-]{+!+}"],
        },
        {
            name: "an added comma",
            original: "However we must go.",
            current: "However, we must go.",
            expected: ["p modified inline: However{+,+} we must go."],
        },
        {
            name: "a capitalisation fix",
            original: "the API is great.",
            current: "The API is great.",
            expected: ["p modified inline: [-the-]{+The+} API is great."],
        },
        {
            name: "a changed decimal number",
            original: "Timeout is 1.5 seconds.",
            current: "Timeout is 2.25 seconds.",
            expected: ["p modified inline: Timeout is [-1.5-]{+2.25+} seconds."],
        },
        {
            name: "half of a hyphenated word",
            original: "A well-known fact.",
            current: "A well-understood fact.",
            expected: ["p modified inline: A well-[-known-]{+understood+} fact."],
        },
        {
            name: "a contraction",
            original: "We do not know.",
            current: "We don't know.",
            expected: ["p modified inline: We [-do not-]{+don't+} know."],
        },
        {
            name: "a swapped emoji",
            original: "Ship it 🚀 today.",
            current: "Ship it 🎉 today.",
            expected: ["p modified inline: Ship it [-🚀-]{+🎉+} today."],
        },
        {
            name: "an accented word",
            original: "Le café est fermé.",
            current: "Le café est ouvert.",
            expected: ["p modified inline: Le café est [-fermé-]{+ouvert+}."],
        },
        {
            name: "an appended sentence",
            original: "Existing sentence.",
            current: "Existing sentence. New sentence added here.",
            expected: ["p modified inline: Existing sentence.{+ New sentence added here.+}"],
        },
        {
            name: "one word in a long paragraph",
            original:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Ut enim ad minim veniam.",
            current:
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Ut enim ad maxim veniam.",
            expected: [
                "p modified inline: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. Ut enim ad [-minim-]{+maxim+} veniam.",
            ],
        },
        {
            name: "one line of a hard-wrapped paragraph",
            original: lines("Alpha line one", "beta line two", "gamma line three."),
            current: lines("Alpha line one", "beta LINE two", "gamma line three."),
            expected: [
                "p modified inline: Alpha line one beta [-line-]{+LINE+} two gamma line three.",
            ],
        },
        {
            name: "two separately edited paragraphs",
            original: lines("Alpha one.", "", "Beta two.", "", "Gamma three."),
            current: lines("Alpha uno.", "", "Beta two.", "", "Gamma tres."),
            expected: [
                "p modified inline: Alpha [-one-]{+uno+}.",
                "p modified inline: Gamma [-three-]{+tres+}.",
            ],
        },
        {
            name: "an edit followed by an inserted paragraph",
            original: lines("Alpha one.", "", "Gamma."),
            current: lines("Alpha uno.", "", "New para.", "", "Gamma."),
            expected: ["p modified inline: Alpha [-one-]{+uno+}.", "p added wash: New para."],
        },
        {
            name: "a wholly new paragraph",
            original: lines("A para.", "", "C para."),
            current: lines("A para.", "", "B para.", "", "C para."),
            expected: ["p added wash: B para."],
        },
        {
            name: "a removed paragraph",
            original: lines("A para.", "", "B para.", "", "C para."),
            current: lines("A para.", "", "C para."),
            expected: ["deleted: 2 lines removed"],
        },
    ])("shows $name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it("shows a wholesale rewrite as a block-level change instead of word marks", () => {
        const root = render(
            ["# Doc", "", "Completely different content about widgets now."].join("\n"),
        );

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "Nothing in common at all here.",
            },
        ]);

        expect(res.decorated).toBe(1);
        expect(res.inlined).toBe(0);
    });

    it("offers the previous paragraph in a Before disclosure for a wholesale rewrite", () => {
        const current = "Completely different content about widgets now.";
        const original = "Nothing in common at all here.";
        const root = render(current);
        decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 1,
                    originalText: original,
                },
            ],
            original,
        );
        expectComparisonAmber(root);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;

        expect(trigger.textContent).toBe("Before");
        expect(trigger.getAttribute("aria-label")).toBe("Show previous version");
        expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
        trigger.click();
        expect(root.querySelector(".emr-diff-before-panel p")?.textContent).toBe(original);
    });

    it("word-diffs one edited line of a hard-wrapped paragraph using the previous document", () => {
        const original = [
            "The incident commander records the current impact and the affected",
            "regions before choosing the next mitigation step.",
        ].join("\n");

        const current = [
            "The incident commander records the current impact and all affected",
            "regions before choosing the next mitigation step.",
        ].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 1,
                    originalText:
                        "The incident commander records the current impact and the affected",
                },
            ],
            original,
        );

        expect(res.inlined).toBe(1);
        const paragraph = root.querySelector("p")!;
        expect(words(paragraph).removed).toContain("the");
        expect(words(paragraph).added).toContain("all");
        expect(root.querySelector(".emr-diff-before-control")).toBeNull();
    });

    it("word-diffs two separate edits in one hard-wrapped paragraph using the previous document", () => {
        const original = [
            "Alpha old wording remains on the first line and continues",
            "through a stable middle line for reviewers",
            "before the old ending closes the paragraph.",
        ].join("\n");

        const current = [
            "Alpha new wording remains on the first line and continues",
            "through a stable middle line for reviewers",
            "before the new ending closes the paragraph.",
        ].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 1,
                    originalText: "Alpha old wording remains on the first line and continues",
                },
                {
                    startLine: 3,
                    endLine: 3,
                    kind: "modified",
                    originalStartLine: 3,
                    originalEndLine: 3,
                    originalText: "before the old ending closes the paragraph.",
                },
            ],
            original,
        );

        expect(res.inlined).toBe(1);
        expect(words(root.querySelector(`p.${DIFF_INLINE_CLASS}`)!).removed).toContain("old old");
    });

    it("word-diffs a heading and the paragraph below it that were edited in one hunk", () => {
        const original = ["## Legacy heading", "Legacy body remains useful."].join("\n");

        const current = ["## Current heading", "Current body remains useful."].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 2,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 2,
                    originalText: original,
                },
            ],
            original,
        );

        expect(res.inlined).toBe(2);
        expect(words(root.querySelector("h2")!).removed).toContain("Legacy");
        expect(words(root.querySelector("p")!).removed).toContain("Legacy");
    });
    it("shows a word added next to newly bold text without leaking Markdown syntax", () => {
        const root = render("Make it **quick** and fast.");

        const res = decorate(root, [
            { startLine: 1, endLine: 1, kind: "modified", originalText: "Make it quick." },
        ]);

        expect(res.inlined).toBe(1);
        const paragraph = root.querySelector("p")!;
        expect(paragraph.querySelector("strong")?.textContent).toBe("quick");
        const marks = words(paragraph);
        expect(marks.added).toContain("fast");
        expect(marks.added).not.toContain("quick");
        expect(`${marks.added}${marks.removed}`).not.toContain("*");
    });

    it("keeps the block wash when the previous line was only whitespace", () => {
        const root = render("Hello brave new world.");

        const res = decorate(root, [
            { startLine: 1, endLine: 1, kind: "modified", originalText: "   " },
        ]);

        const paragraph = root.querySelector<HTMLElement>("p")!;
        expect(res.inlined).toBe(0);
        expect(paragraph.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(paragraph.classList.contains(DIFF_INLINE_CLASS)).toBe(false);
        expect(words(paragraph)).toEqual({ added: "", removed: "" });
    });

    // Without the complete previous paragraph the word diff can't be placed
    // safely, so the paragraph is washed as a whole instead.
    it.each<{ name: string; current: string; ranges: DiffRange[]; withSource?: boolean }>([
        {
            name: "only one line of a wrapped paragraph changed and the full original is unknown",
            current: lines("Alpha one", "Beta two", "Gamma three"),
            ranges: [{ startLine: 1, endLine: 1, kind: "modified", originalText: "Alpha uno" }],
        },
        {
            name: "two separate lines of a wrapped paragraph changed and the full original is unknown",
            current: lines("Alpha one", "Beta two", "Gamma three", "Delta four"),
            ranges: [
                { startLine: 1, endLine: 1, kind: "modified", originalText: "Alpha uno" },
                {
                    startLine: 3,
                    endLine: 4,
                    kind: "modified",
                    originalText: "Gamma tres\nDelta four",
                },
            ],
        },
        {
            name: "the previous text of the paragraph is unknown",
            current: "hello world",
            ranges: [{ startLine: 1, endLine: 1, kind: "modified" }],
        },
        {
            name: "the edit runs on past the end of the paragraph",
            current: lines("Sentence one.", "Sentence two.", "Sentence three."),
            ranges: [
                { startLine: 2, endLine: 2, kind: "added" },
                {
                    startLine: 3,
                    endLine: 4,
                    kind: "modified",
                    originalText: "Old three.\nOld four.",
                },
            ],
            withSource: true,
        },
        {
            name: "a line was added next to an edited line whose previous text is unknown",
            current: lines("Sentence one.", "Sentence two.", "Sentence three."),
            ranges: [
                { startLine: 1, endLine: 1, kind: "added" },
                { startLine: 2, endLine: 2, kind: "modified" },
            ],
            withSource: true,
        },
    ])("washes the whole paragraph when $name", ({ current, ranges, withSource }) => {
        const root = render(current);

        decorate(root, ranges, undefined, withSource === true ? current : undefined);

        const paragraph = root.querySelector<HTMLElement>("p")!;
        expect(paragraph.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(paragraph.dataset.diffInline).toBeUndefined();
    });
});

describe("lines added to or removed from inside a paragraph", () => {
    it("shows a line appended to a paragraph as an edit, not a new paragraph", () => {
        expect(
            view(
                lines("Sentence one.", "Sentence two.", "", "Next."),
                lines("Sentence one.", "Sentence two.", "Sentence three.", "", "Next."),
            ),
        ).toEqual(["p modified inline: Sentence one. Sentence two.{+ Sentence three.+}"]);
    });

    it("shows a line prepended to a paragraph inline", () => {
        expect(
            view(
                lines("Sentence one.", "Sentence two."),
                lines("Sentence zero.", "Sentence one.", "Sentence two."),
            ),
        ).toEqual(["p modified inline: {+Sentence zero. +}Sentence one. Sentence two."]);
    });

    it("shows two lines prepended to a one-line paragraph inline", () => {
        expect(
            view(
                "Existing closing line.",
                lines("New opening line.", "Another new line.", "Existing closing line."),
            ),
        ).toEqual([
            "p modified inline: {+New opening line. Another new line. +}Existing closing line.",
        ]);
    });

    it("shows a line inserted above a reworded last line inline", () => {
        expect(
            view(
                lines("First line stays.", "Old last line."),
                lines("First line stays.", "Inserted middle line.", "New last line."),
            ),
        ).toEqual([
            "p modified inline: First line stays. [-Old-]{+Inserted middle line. New+} last line.",
        ]);
    });

    it("shows two lines removed mid-paragraph inside it, as the server reports them", () => {
        const current = lines("Line one.", "Line four.");
        const root = render(current);

        decorate(
            root,
            [
                {
                    startLine: 2,
                    endLine: 2,
                    kind: "deleted-marker",
                    linesDeleted: 2,
                    deletedContent: "Gone two.\nGone three.\n",
                },
            ],
            lines("Line one.", "Gone two.", "Gone three.", "Line four."),
            current,
        );

        expect(summarize(root)).toEqual([
            "p modified inline: Line one. [-Gone two. Gone three. -]Line four.",
        ]);
    });

    it("shows a line inserted mid-paragraph inline", () => {
        expect(
            view(
                lines("Sentence one.", "Sentence two."),
                lines("Sentence one.", "Inserted line.", "Sentence two."),
            ),
        ).toEqual(["p modified inline: Sentence one. {+Inserted line. +}Sentence two."]);
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
    it("shows a removed heading that split a paragraph in two as a removal marker", () => {
        expect(view(lines("Alpha.", "# Heading", "Beta."), lines("Alpha.", "Beta."))).toEqual([
            "deleted: 1 line removed",
        ]);
    });

    it("shows a removal marker when the removed text is unknown", () => {
        const current = lines("Sentence one.", "Sentence three.");
        const root = render(current);

        const result = decorate(
            root,
            [{ startLine: 2, endLine: 2, kind: "deleted-marker", linesDeleted: 1 }],
            undefined,
            current,
        );

        expect(result).toEqual({ decorated: 0, markers: 1, inlined: 0 });
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

    it("word-diffs a paragraph whose coarse edit hunk is followed by an added line", () => {
        const current = lines(
            "Alpha uno is here.",
            "Beta stays exactly the same.",
            "Gamma three is new",
        );

        const root = render(current);
        decorate(
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
            undefined,
            current,
        );
        expect(summarize(root)).toEqual([
            "p modified inline: Alpha [-one-]{+uno+} is here. Beta stays exactly the same.{+ Gamma three is new+}",
        ]);
    });

    it("still marks an added paragraph when the current source text is out of date", () => {
        const root = render(lines("One.", "Two."));

        decorate(root, [{ startLine: 1, endLine: 1, kind: "added" }], undefined, "One.");

        expect(root.querySelector("p")!.dataset.diffKind).toBe("added");
    });
});

describe("footnotes", () => {
    it("word-diffs an edited footnote definition", () => {
        expect(
            view(
                lines("Claim.[^1]", "", "[^1]: Old source."),
                lines("Claim.[^1]", "", "[^1]: New source."),
            ),
        ).toEqual(["li modified inline: [-Old-]{+New+} source. ↩"]);
    });

    it("word-diffs an edited footnote definition with a named label", () => {
        expect(
            view(
                lines("Claim.[^source]", "", "[^source]: Old source."),
                lines("Claim.[^source]", "", "[^source]: New source."),
            ),
        ).toEqual(["li modified inline: [-Old-]{+New+} source. ↩"]);
    });

    it("shows an added footnote and its reference", () => {
        expect(view("Claim.", lines("Claim.[^1]", "", "[^1]: A source."))).toEqual([
            "p modified inline: Claim.{+1+}",
            "li added wash: A source. ↩",
        ]);
    });
});

describe("scripts without word spaces", () => {
    it.each([
        {
            name: "one changed Japanese word",
            original: "今日は東京に行きます。",
            current: "今日は大阪に行きます。",
            expected: "p modified inline: 今日は[-東京-]{+大阪+}に行きます。",
        },
        {
            name: "one added Chinese character",
            original: "我们去公园。",
            current: "我们去公园玩。",
            expected: "p modified inline: 我们去公园{+玩+}。",
        },
        {
            name: "a Latin word inside Chinese text",
            original: "使用 API 调用服务。",
            current: "使用 SDK 调用服务。",
            expected: "p modified inline: 使用 [-API-]{+SDK+} 调用服务。",
        },
        {
            name: "a Korean word",
            original: "오늘은 날씨가 좋다.",
            current: "오늘은 날씨가 나쁘다.",
            expected: "p modified inline: 오늘은 날씨가 [-좋다-]{+나쁘다+}.",
        },
    ])("diffs $name inline", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual([expected]);
    });
});

// A change that renders identically is not shown; a change to anything a
// reader can see (attributes, block type) still is.
describe("identically rendered edits", () => {
    const edit = (original: string, current: string) => {
        const root = render(current);

        return decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: current.split("\n").length,
                    kind: "modified",
                    originalText: original,
                    originalStartLine: 1,
                    originalEndLine: original.split("\n").length,
                },
            ],
            original,
        );
    };

    it.each([
        {
            name: "re-wrapped paragraph lines",
            original: lines("One two three", "four five."),
            current: lines("One two", "three four five."),
        },
        { name: "added trailing spaces", original: "Line text.", current: "Line text.   " },
        {
            name: "a double space collapsed to one",
            original: "Keep  this text.",
            current: "Keep this text.",
        },
        {
            name: "a numbered list switched from 1. to 1) markers",
            original: lines("1. One", "2. Two"),
            current: lines("1) One", "2) Two"),
        },
        {
            name: "a re-indented wrapped line of a list item",
            original: lines("- first", "  second"),
            current: lines("- first", "   second"),
        },
    ])("hides $name", ({ original, current }) => {
        const { view: shown, root } = diffView(original, current);

        expect(shown).toEqual([]);
        expect(root.querySelector(".emr-diff-line-wash, .emr-diff-before-control")).toBeNull();
    });

    it.each([
        { which: "second", line: 2, originalText: "Line two there." },
        { which: "first", line: 1, originalText: "Line one there." },
    ])(
        "keeps the whole highlight for a paragraph whose $which line alone changed while the previous document is unavailable",
        ({ line, originalText }) => {
            const root = render(lines("Line one here.", "Line two here."));

            decorate(root, [{ startLine: line, endLine: line, kind: "modified", originalText }]);

            expect(summarize(root)).toEqual([
                "p modified wash ⟨Previous content unavailable; exact comparison cannot be shown⟩: Line one here. Line two here.",
            ]);
        },
    );

    it("hides an emphasis-marker swap that renders the same", () => {
        expect(edit("Ship *today* please.", "Ship _today_ please.").decorated).toBe(0);
    });

    it.each([
        {
            name: "a heading that renders the same (headings carry app controls)",
            original: "## Title",
            current: "Title\n-----",
        },
        {
            name: "a link whose only change is its title",
            original: 'See [docs](https://a.example "Old")',
            current: 'See [docs](https://a.example "New")',
        },
        {
            name: "an image whose only change is its width",
            original: 'Logo <img src="https://a.example/l.png" width="120"> here',
            current: 'Logo <img src="https://a.example/l.png" width="240"> here',
        },
        {
            name: "an image whose only change is its height",
            original: 'Logo <img src="https://a.example/l.png" height="120"> here',
            current: 'Logo <img src="https://a.example/l.png" height="240"> here',
        },
        {
            name: "two words joined into one",
            original: "You can not stop.",
            current: "You cannot stop.",
        },
        {
            name: "bold extended over the next word",
            original: "Make **bold** text clear.",
            current: "Make **bold text** clear.",
        },
    ])("still shows $name", ({ original, current }) => {
        expect(edit(original, current).decorated).toBe(1);
    });
});
