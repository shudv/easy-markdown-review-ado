// Unit tests for selected-text deep links (src/shell/textFragment.ts): building
// the shortest unambiguous fragment for a selection, the URL-value round trip,
// and resolving a fragment back onto live (non-reference) document text.

import { afterEach, describe, expect, it } from "vitest";

import {
    buildTextFragment,
    findTextFragment,
    parseTextFragment,
    serializeTextFragment,
    type TextFragment,
} from "../src/shell/textFragment";
import { renderMarkdownSync } from "../src/markdown/render";
import {
    decorateDiffRanges,
    DIFF_CELL_REMOVED_CLASS,
    DIFF_METADATA_CLASS,
    DIFF_SOURCE_ONLY_CLASS,
} from "../src/markdown/diffDecorations";

function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = html;
    document.body.appendChild(root);

    return root;
}

/** A Range over the `nth` occurrence of `text` inside `root`'s flat text. */
function rangeOf(root: HTMLElement, text: string, nth = 0): Range {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const runs: { node: Text; start: number }[] = [];
    let flat = "";

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        runs.push({ node: n as Text, start: flat.length });
        flat += (n as Text).data;
    }

    let at = -1;
    for (let i = 0; i <= nth; i++) at = flat.indexOf(text, at + 1);
    if (at < 0) throw new Error(`"${text}" not found`);

    const locate = (offset: number, isEnd: boolean) => {
        const run = runs.findLast((r) => (isEnd ? r.start < offset : r.start <= offset))!;

        return { node: run.node, offset: offset - run.start };
    };

    const start = locate(at, false);
    const end = locate(at + text.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    return range;
}

/** Build a fragment for `text` and resolve it again — the full round trip. */
function roundTrip(root: HTMLElement, text: string, nth = 0): string | null {
    const fragment = buildTextFragment(root, rangeOf(root, text, nth));
    expect(fragment).not.toBeNull();
    const parsed = parseTextFragment(serializeTextFragment(fragment!));
    expect(parsed).toEqual(fragment);
    const found = findTextFragment(root, parsed!);

    return found ? found.toString() : null;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("buildTextFragment", () => {
    it("quotes a short, unique selection whole with no context", () => {
        const root = mount(`<p>The rollout gate blocks deploys today.</p>`);
        expect(buildTextFragment(root, rangeOf(root, "blocks deploys"))).toEqual({
            start: "blocks deploys",
        });
    });

    it("trims surrounding whitespace and collapses inner runs", () => {
        const root = mount(`<p>Alpha   beta\n  gamma delta</p>`);
        expect(buildTextFragment(root, rangeOf(root, " beta\n  gamma "))).toEqual({
            start: "beta gamma",
        });
    });

    // About thirty characters of whole words from each edge of the selection.
    it.each([
        {
            sentence:
                "Error budgets are evaluated per region every five minutes, and a breach blocks every pending deployment until the owner signs off.",
            start: "Error budgets are evaluated per",
            end: "deployment until the owner signs off.",
        },
        {
            sentence:
                "Release notes must be reviewed by two maintainers before tagging, and the on-call engineer owns them end to end.",
            start: "Release notes must be reviewed",
            end: "engineer owns them end to end.",
        },
    ])(
        "quotes a long selection by its first and last words: $start … $end",
        ({ sentence, start, end }) => {
            const root = mount(`<p>Intro. ${sentence} Outro.</p>`);

            expect(buildTextFragment(root, rangeOf(root, sentence))).toEqual({ start, end });
            expect(roundTrip(root, sentence)).toBe(sentence);
        },
    );

    it.each([
        {
            name: "a medium-length selection",
            sentence: "Rollbacks are rare, but the on-call engineer owns them end to end.",
        },
        {
            name: "a selection right at the 80-character limit",
            sentence:
                "Rollbacks are rare, but the on-call engineer still owns each of them end to end.",
        },
    ])("quotes $name whole", ({ sentence }) => {
        const root = mount(`<p>Intro. ${sentence} Outro.</p>`);

        expect(buildTextFragment(root, rangeOf(root, sentence))).toEqual({ start: sentence });
    });

    it("links a long selection whose closing words also appear inside it", () => {
        const advice =
            "Before you open the pull request for review, run the full test suite locally; after every rebase, run the full test suite locally";

        const root = mount(`<p>Checklist: ${advice}. Then push.</p>`);

        expect(roundTrip(root, advice)).toBe(advice);
    });

    it("links a long selection whose opening words also appear earlier in the document", () => {
        const advice =
            "Before you open the pull request for review, run the full test suite and the linter locally";

        const root = mount(
            `<p>Before you open the pull request, read the guide.</p><p>${advice}.</p>`,
        );

        expect(roundTrip(root, advice)).toBe(advice);
    });

    it("quotes a long single word (e.g. a URL) whole", () => {
        const url = `https://example.com/${"a".repeat(120)}`;
        const root = mount(`<p>See ${url} now.</p>`);
        expect(buildTextFragment(root, rangeOf(root, url))).toEqual({
            start: url,
        });
    });

    it("adds context only when the quote alone is ambiguous", () => {
        const root = mount(
            `<p>First we deploy the service.</p>\n<p>Later we deploy the service again after the review.</p>`,
        );

        const fragment = buildTextFragment(root, rangeOf(root, "deploy the service", 1))!;

        // Three words either side are enough to single out the second occurrence.
        expect(fragment).toEqual({
            prefix: "service. Later we",
            start: "deploy the service",
            suffix: "again after the",
        });

        const found = findTextFragment(root, fragment)!;
        expect(found.startContainer.parentElement!.textContent).toContain("Later");
    });

    it.each([
        ["inline formatting", "bold words and italics"],
        ["a block boundary", "italics.next"],
        ["the middle of formatted words", "words and it"],
    ])("links a selection across %s", (_label, text) => {
        const root = mount(
            `<p>Keep <strong>bold words</strong> and <em>italics</em>.</p><ul><li>next item</li></ul>`,
        );

        expect(roundTrip(root, text)).toBe(text);
    });

    it("links a selection that starts at the very beginning of the document", () => {
        const root = mount(`<p><strong>Rollout</strong> gates block deploys.</p>`);

        expect(buildTextFragment(root, rangeOf(root, "Rollout gates"))).toEqual({
            start: "Rollout gates",
        });
    });

    it("ignores removed-diff content and injected controls", () => {
        const root = mount(
            `<h2 id="goals"><button class="emr-section-toggle">x</button>Goals</h2>` +
                `<div class="emr-diff-deleted-marker"><p>shared phrase</p></div>` +
                `<p>Live shared phrase here.</p>`,
        );

        const fragment = buildTextFragment(root, rangeOf(root, "shared phrase", 1));

        // The removed copy doesn't count, so no context is needed.
        expect(fragment).toEqual({ start: "shared phrase" });
        const found = findTextFragment(root, fragment!)!;
        expect(found.startContainer.parentElement!.tagName).toBe("P");
        expect(found.startContainer.parentElement!.closest(".emr-diff-deleted-marker")).toBeNull();
    });

    // Reference copies of earlier text shown by the PR diff never count as the
    // live document, so they can't make a live quote ambiguous.
    it.each([
        {
            name: "a removed table cell",
            html: `<table><tr><td class="${DIFF_CELL_REMOVED_CLASS}">shared phrase</td></tr></table>`,
        },
        {
            name: "a source-only change marker",
            html: `<div class="${DIFF_SOURCE_ONLY_CLASS}">shared phrase</div>`,
        },
        {
            name: "a link-target change note",
            html: `<span class="${DIFF_METADATA_CLASS}">shared phrase</span>`,
        },
        {
            name: "a “Before” panel",
            html: `<div class="emr-diff-before-panel">shared phrase</div>`,
        },
        {
            name: "a “Before” toggle",
            html: `<span class="emr-diff-before-control">shared phrase</span>`,
        },
        {
            name: "a metadata change panel",
            html: `<div class="emr-diff-metadata-panel">shared phrase</div>`,
        },
    ])("quotes live text without context when $name repeats it", ({ html }) => {
        const root = mount(`${html}<p>Live shared phrase here.</p>`);

        expect(buildTextFragment(root, rangeOf(root, "shared phrase", 1))).toEqual({
            start: "shared phrase",
        });
    });

    it("returns null for a selection with no live text", () => {
        const root = mount(`<p>Text</p><div class="emr-diff-deleted-marker"><p>gone</p></div>`);

        expect(buildTextFragment(root, rangeOf(root, "gone"))).toBeNull();
    });
});

describe("findTextFragment", () => {
    it("matches across case and whitespace differences", () => {
        const root = mount(`<p>Blocks   Deploys\nwhen budgets fall.</p>`);
        const found = findTextFragment(root, { start: "blocks deploys when" });
        expect(found?.toString()).toBe("Blocks   Deploys\nwhen");
    });

    // Without a prefix the first start wins (as in browser text fragments); the
    // builder adds one whenever that would land on the wrong span.
    it.each<{ name: string; html: string; fragment: TextFragment; expected: string }>([
        {
            name: "the first span when its suffix matches",
            html: "<p>a one b end x. a two b end y.</p>",
            fragment: { start: "a", end: "end", suffix: "x" },
            expected: "a one b end",
        },
        {
            name: "a later span when the prefix points there",
            html: "<p>a one b end x. a two b end y.</p>",
            fragment: { prefix: "x.", start: "a", end: "end", suffix: "y" },
            expected: "a two b end",
        },
        {
            name: "a later end when the first end fails its suffix",
            html: "<p>a one b end x c end y.</p>",
            fragment: { start: "a", end: "end", suffix: "y" },
            expected: "a one b end x c end",
        },
    ])("resolves a start…end quote to $name", ({ html, fragment, expected }) => {
        const root = mount(html);
        expect(findTextFragment(root, fragment)?.toString()).toBe(expected);
    });

    it.each<{ name: string; html: string; fragment: TextFragment; expectedId: string }>([
        {
            name: "the words before it",
            html: `<p><span id="first">Today we fix it now.</span> <span id="second">They fix it soon.</span></p>`,
            fragment: { prefix: "They", start: "fix it" },
            expectedId: "second",
        },
        {
            name: "the document's opening words",
            html: `<h2 id="first">Notes</h2><p id="second">Notes</p>`,
            fragment: { prefix: "Notes", start: "Notes" },
            expectedId: "second",
        },
    ])(
        "resolves a quote to the occurrence that follows $name",
        ({ html, fragment, expectedId }) => {
            const root = mount(html);

            expect(findTextFragment(root, fragment)?.startContainer.parentElement?.id).toBe(
                expectedId,
            );
        },
    );

    it("lands a link to the start of a paragraph inside that paragraph", () => {
        const root = mount(
            `<p id="first">First paragraph.</p><p id="second">Second paragraph.</p>`,
        );

        const found = findTextFragment(root, { start: "Second paragraph" })!;

        expect(found.startContainer.parentElement?.id).toBe("second");
        expect(found.toString()).toBe("Second paragraph");
    });

    it("builds a self-disambiguating start…end link", () => {
        const tail = "and then the deployment finally ends here";
        const long = `Start of a long sentence that keeps going ${tail}`;
        const root = mount(`<p>${long}. Filler. ${long} again.</p>`);
        expect(roundTrip(root, long, 1)).toBe(long);
        const fragment = buildTextFragment(root, rangeOf(root, long, 1))!;
        const found = findTextFragment(root, fragment)!;
        expect(found.startOffset).toBeGreaterThan(long.length);
    });

    it.each<[string, TextFragment]>([
        ["the quoted text is gone", { start: "gamma" }],
        ["the prefix no longer precedes it", { prefix: "zzz", start: "alpha" }],
        ["the end text is gone", { start: "alpha", end: "omega" }],
        ["the suffix no longer follows it", { start: "alpha", suffix: "x" }],
        ["the text after a start…end quote changed", { start: "alpha", end: "beta", suffix: "x" }],
        ["the quote is only whitespace", { start: "   " }],
    ])("finds nothing when %s", (_label, fragment) => {
        const root = mount(`<p>alpha beta</p>`);
        expect(findTextFragment(root, fragment)).toBeNull();
    });
});

describe("edge cases", () => {
    // A link made before a heading was re-cased still finds it: matching folds
    // case the way a reader would, including German's capital sharp s (ẞ → ß).
    it("finds a German link after the text was changed to capitals", () => {
        const root = mount(`<h2>HAUPTSTRAẞE 5</h2>`);
        expect(findTextFragment(root, { start: "Hauptstraße 5" })?.toString()).toBe(
            "HAUPTSTRAẞE 5",
        );
    });

    it.each([
        ["German", "Wir treffen uns in der Hauptstraße am Montag.", "Hauptstraße"],
        ["Greek", "Η συνάντηση είναι στην οδός Αθηνάς αύριο.", "οδός Αθηνάς"],
    ])("round-trips a link to a word in a %s document", (_language, sentence, word) => {
        const root = mount(`<p>${sentence}</p>`);
        expect(roundTrip(root, word)).toBe(word);
    });
    it("keeps characters whose lower case changes length", () => {
        const root = mount(`<p>Say İstanbul twice.</p>`);
        expect(findTextFragment(root, { start: "İstanbul" })?.toString()).toBe("İstanbul");
    });

    it("ignores text nodes the range only touches at an edge", () => {
        const root = mount(`<p>first</p><p>second</p>`);
        const [first, second] = Array.from(root.querySelectorAll("p"));
        const range = document.createRange();
        range.setStart(first!.firstChild!, 5);
        range.setEnd(second!.firstChild!, 6);
        expect(buildTextFragment(root, range)).toEqual({ start: "second" });
    });

    it("returns null for a whitespace-only selection", () => {
        const root = mount(`<p>a   b</p>`);
        const range = document.createRange();
        range.setStart(root.querySelector("p")!.firstChild!, 1);
        range.setEnd(root.querySelector("p")!.firstChild!, 4);
        expect(buildTextFragment(root, range)).toBeNull();
    });
});

describe("serialize / parse", () => {
    const cases: TextFragment[] = [
        { start: "plain" },
        { start: "a, b", end: "c%d" },
        { prefix: "before", start: "-dash-", suffix: "after" },
        { prefix: "p", start: "s", end: "e", suffix: "x" },
    ];

    it.each(cases)("round-trips %o", (fragment) => {
        expect(parseTextFragment(serializeTextFragment(fragment))).toEqual(fragment);
    });

    it("uses the URL text-fragment syntax", () => {
        expect(
            serializeTextFragment({
                prefix: "pre",
                start: "a,b",
                end: "end",
                suffix: "post",
            }),
        ).toBe("pre-,a%2Cb,end,-post");
    });

    it("keeps hyphens inside a quote readable in the link", () => {
        expect(serializeTextFragment({ start: "opt-in roll-out" })).toBe("opt-in roll-out");
    });

    it.each([
        ["an empty value", ""],
        ["too many parts", "a,b,c"],
        ["broken percent-encoding", "%E0%A4%A"],
        ["an empty end", "a,"],
        ["context with no quote", "pre-,-post"],
        ["an unescaped dash at the end of the quote", "start,end-"],
        ["a quote of only spaces", "%20%20"],
    ])("rejects a link value with %s", (_label, value) => {
        expect(parseTextFragment(value)).toBeNull();
    });
});

describe("with diff decorations (added + removed words)", () => {
    const ORIGINAL = [
        "# Doc",
        "",
        "The rollout gate blocks deploys when budgets fall below 20%.",
        "",
        "| Region | Owner | Budget |",
        "| --- | --- | --- |",
        "| EU | Ana | 20% |",
        "",
    ].join("\n");

    const CURRENT = [
        "# Doc",
        "",
        "The rollout gate pauses releases when budgets fall below 20%.",
        "",
        "| Region | Budget |",
        "| --- | --- |",
        "| EU | 20% |",
        "",
    ].join("\n");

    /** The live article: current Markdown, with or without the PR diff shown. */
    function article(showDiff: boolean): HTMLElement {
        const root = mount(renderMarkdownSync(CURRENT));

        if (showDiff) {
            decorateDiffRanges(
                root,
                [
                    {
                        startLine: 3,
                        endLine: 3,
                        kind: "modified",
                        originalStartLine: 3,
                        originalEndLine: 3,
                        originalText: ORIGINAL.split("\n")[2]!,
                    },
                    {
                        startLine: 5,
                        endLine: 7,
                        kind: "modified",
                        originalStartLine: 5,
                        originalEndLine: 7,
                        originalText: ORIGINAL.split("\n").slice(4, 7).join("\n"),
                    },
                ],
                {
                    renderInline: renderMarkdownSync,
                    originalSource: ORIGINAL,
                    currentSource: CURRENT,
                },
            );
        }

        return root;
    }

    /** Range from the start of `fromText` to the end of `toText` (text nodes). */
    function spanRange(root: HTMLElement, fromText: string, toText: string): Range {
        const nodes: Text[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            nodes.push(n as Text);
        }

        const from = nodes.find((n) => n.data.includes(fromText))!;
        const to = nodes.filter((n) => n.data.includes(toText)).pop()!;
        const range = document.createRange();
        range.setStart(from, from.data.indexOf(fromText));
        range.setEnd(to, to.data.indexOf(toText) + toText.length);

        return range;
    }

    it("quotes only live text for a selection across removed + added words", () => {
        const root = article(true);
        // The fixture really renders both sides inline; without this the
        // live-text assertions below could pass vacuously.
        expect(root.querySelector("del.emr-word-removed")?.textContent).toContain("blocks deploys");
        expect(root.querySelector("ins.emr-word-added")?.textContent).toContain("pauses releases");
        const range = spanRange(root, "rollout", "budgets");
        expect(range.toString()).toContain("blocks deploys");
        const fragment = buildTextFragment(root, range)!;
        expect(serializeTextFragment(fragment)).not.toMatch(/blocks|deploys/);
        expect(fragment.start).toBe("rollout gate pauses releases when budgets");
    });

    it("resolves the same link whether the diff is shown or hidden", () => {
        const shown = article(true);

        const madeShown = buildTextFragment(shown, spanRange(shown, "rollout", "budgets"))!;

        const hidden = article(false);

        const madeHidden = buildTextFragment(hidden, spanRange(hidden, "rollout", "budgets"))!;

        // Same selection, same link, either way…
        expect(madeShown).toEqual(madeHidden);
        // …and each resolves on the other view onto exactly the live words.
        expect(findTextFragment(hidden, madeShown)?.toString()).toBe(
            "rollout gate pauses releases when budgets",
        );
        const onShown = findTextFragment(shown, madeHidden)!;
        expect(onShown.toString()).toContain("pauses releases");
        expect(onShown.toString().replace(/blocks deploys\s*/, "")).toBe(
            "rollout gate pauses releases when budgets",
        );
    });
    it("ignores a removed table cell spliced into a live row", () => {
        const root = article(true);

        const removed = Array.from(root.querySelectorAll(".emr-diff-cell--removed")).map(
            (cell) => cell.textContent,
        );

        expect(removed.join(" ")).toContain("Ana");
        const fragment = buildTextFragment(root, spanRange(root, "EU", "20%"))!;
        expect(serializeTextFragment(fragment)).not.toContain("Ana");
        expect(findTextFragment(article(false), fragment)).not.toBeNull();
    });

    it("returns null when only removed words are selected", () => {
        const root = article(true);
        const del = root.querySelector("del.emr-word-removed")!;
        const range = document.createRange();
        range.selectNodeContents(del);
        expect(buildTextFragment(root, range)).toBeNull();
    });
});
