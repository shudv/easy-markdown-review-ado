import { beforeEach, describe, expect, it } from "vitest";

import {
    decorateDiffRanges,
    DIFF_FORMAT_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_METADATA_CLASS,
} from "../src/markdown/diffDecorations";
import { WORD_REMOVED_CLASS } from "../src/markdown/wordDiffDom";
import { renderMarkdownSync } from "../src/markdown/render";
import {
    decorate,
    diffView,
    expectPreciseAmber,
    lines,
    makeRoot,
    render,
    view,
    words,
} from "./markdownDiffHarness";

// Rendered diff of headings: word edits, level changes, block-type changes,
// and keeping the heading's own controls (section toggle, copy-link button)
// outside the change highlight.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("edited headings", () => {
    it("offers the previous version of a heading rewritten with closing hashes", () => {
        expect(view(lines("## Title", "", "Body."), lines("## Title ##", "", "Body."))).toEqual([
            "h2 modified wash: Before Title",
        ]);
    });

    it("reveals a heading's previous version just above it when Before is pressed", () => {
        const { root } = diffView(
            lines("## Title", "", "Body."),
            lines("## Title ##", "", "Body."),
        );

        const heading = root.querySelector("h2[data-diff-kind]")!;
        const trigger = heading.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;
        const panel = heading.previousElementSibling as HTMLElement;
        expect(panel.classList.contains("emr-diff-before-panel")).toBe(true);
        expect(panel.id).not.toBe("");
        expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
        expect(panel.hidden).toBe(true);

        trigger.click();

        expect(panel.hidden).toBe(false);
        expect(trigger.textContent).toBe("Hide");
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(panel.querySelector("h2")?.textContent).toBe("Title");
    });

    it.each([
        ["h1", "# Getting Started Guide", "# Getting Started", "Guide"],
        ["h2", "## Configuration Settings", "## Configuration Options", "Settings"],
        ["h3", "### Retry Behaviour Details", "### Retry Behaviour", "Details"],
        ["h4", "#### Edge Case Notes", "#### Edge Notes", "Case"],
        ["h5", "##### Minor Caveat Here", "##### Minor Caveat", "Here"],
        ["h6", "###### Footnote Updated", "###### Footnote", "Updated"],
    ])(
        "shows the added word of an edited %s without its # fence",
        (tag, modified, original, addedWord) => {
            const root = render(modified);

            const res = decorate(root, [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalText: original,
                },
            ]);

            expect(res.inlined).toBe(1);
            const h = root.querySelector<HTMLElement>(tag)!;
            expect(h.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
            expect(words(h).added).toContain(addedWord);
            expect(words(h).added).not.toContain("#");
        },
    );

    it("marks only the heading text, with an explanation, when only its level changed", () => {
        const root = render("### Approval workflow");

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "## Approval workflow",
            },
        ]);

        expect(res.inlined).toBe(1);
        const heading = root.querySelector<HTMLElement>("h3")!;
        expect(heading.classList.contains(DIFF_INLINE_CLASS)).toBe(true);

        const mark = heading.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!;

        expect(mark.textContent).toBe("Approval workflow");
        expectPreciseAmber(mark, "Block changed from heading level 2 to heading level 3");
    });

    it.each([
        {
            name: "a heading whose level and text both changed shows only the word edit",
            original: lines("## Setup", "", "Body."),
            current: lines("### Setup guide", "", "Body."),
            expected: ["h3 modified inline: Setup{+ guide+}"],
        },
        {
            name: "an added heading is washed green",
            original: lines("Body one.", "", "Body two."),
            current: lines("Body one.", "", "## New", "", "Body two."),
            expected: ["h2 added wash: New"],
        },
        {
            name: "a removed heading leaves a removal marker",
            original: lines("Body one.", "", "## Old", "", "Body two."),
            current: lines("Body one.", "", "Body two."),
            expected: ["deleted: 2 lines removed"],
        },
        {
            name: "a heading and its body edited together are each word-diffed",
            original: lines("## Old title", "", "Old body text here."),
            current: lines("## New title", "", "New body text here."),
            expected: [
                "h2 modified inline: [-Old-]{+New+} title",
                "p modified inline: [-Old-]{+New+} body text here.",
            ],
        },
    ])("$name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it("word-diffs a heading that was turned into a paragraph", () => {
        // The line was a heading (`## …`) and is now a paragraph. The block is a
        // <p> but the original renders to an <h2>, so the tag-match lookup misses
        // and we fall back to the whole rendered original's text.
        const root = render(["Now this is plain body text here."].join("\n"));

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "## Now this is heading text here",
            },
        ]);

        expect(res.decorated).toBe(1);
        const p = root.querySelector<HTMLElement>("p")!;
        expect(p.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(words(p).added).toContain("plain");
        expect(p.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    });

    it("offers the previous heading in a Before disclosure when it was rewritten into an unrelated paragraph", () => {
        const root = render("Entirely new operational body text.");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "## Legacy approval workflow",
            },
        ]);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        trigger.click();
        expect(root.querySelector(".emr-diff-before-content h2")?.textContent).toBe(
            "Legacy approval workflow",
        );
    });
});

describe("heading controls stay outside the change highlight", () => {
    it("keeps a section toggle outside a changed heading wash", () => {
        const root = makeRoot([
            {
                tag: "h2",
                start: 5,
                end: 5,
                html: '<button class="emr-section-toggle" type="button"></button>Changed heading',
            },
        ]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        const heading = root.querySelector<HTMLElement>("h2")!;
        expect(heading.querySelector(":scope > .emr-section-toggle")).not.toBeNull();
        expect(heading.querySelector(":scope > .emr-diff-line-wash")?.textContent).toBe(
            "Changed heading",
        );
        expect(heading.querySelector(".emr-diff-line-wash .emr-section-toggle")).toBeNull();
    });

    it("keeps the heading link button outside a changed heading wash", () => {
        // The wash must not swallow the "Copy link to section" button: its CSS
        // (hover reveal, `> .emr-heading-link`) targets it as a direct child.
        const root = makeRoot([
            {
                tag: "h2",
                start: 5,
                end: 5,
                html: 'Changed heading<button class="emr-heading-link" type="button"></button>',
            },
        ]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        const heading = root.querySelector<HTMLElement>("h2")!;
        expect(heading.lastElementChild?.className).toBe("emr-heading-link");
        expect(heading.querySelector(":scope > .emr-diff-line-wash")?.textContent).toBe(
            "Changed heading",
        );
        expect(heading.querySelector(".emr-diff-line-wash .emr-heading-link")).toBeNull();
    });

    it("keeps the heading link after words removed from the end of a renamed heading", () => {
        // "Goals and non-goals" → "Goals": the struck-out tail must stay with the
        // heading text, not land after the link button.
        const root = makeRoot([
            {
                tag: "h2",
                start: 5,
                end: 5,
                html: 'Goals<button class="emr-heading-link" type="button"></button>',
            },
        ]);

        decorateDiffRanges(
            root,
            [
                {
                    startLine: 5,
                    endLine: 5,
                    kind: "modified",
                    originalText: "## Goals and non-goals",
                },
            ],
            { renderInline: renderMarkdownSync },
        );

        const heading = root.querySelector<HTMLElement>("h2")!;
        const removed = heading.querySelector(`.${WORD_REMOVED_CLASS}`);
        expect(removed?.textContent).toContain("non-goals");
        expect(heading.lastElementChild?.className).toBe("emr-heading-link");
        expect(
            removed!.compareDocumentPosition(heading.lastElementChild!) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
