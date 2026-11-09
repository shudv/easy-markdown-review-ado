import { beforeEach, describe, expect, it } from "vitest";

import { DIFF_TOOLTIP_CLASS } from "../src/markdown/diffDecorations";
import {
    decorate,
    diffView,
    expectComparisonAmber,
    expectPreciseAmber,
    lines,
    render,
    view,
    words,
} from "./markdownDiffHarness";

// Rendered diff of blockquotes and callouts, including blocks nested inside
// a quote.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("blockquotes", () => {
    it.each([
        {
            name: "an edited quote whose second line continues without a marker",
            original: lines("> Old first line", "lazy second line"),
            current: lines("> New first line", "lazy second line"),
            expected: ["blockquote modified inline: [-Old-]{+New+} first line lazy second line"],
        },
        {
            name: "an edited quote inside a list item",
            original: lines("- Item:", "", "  > Old quoted words here"),
            current: lines("- Item:", "", "  > New quoted words here"),
            expected: ["blockquote modified inline: [-Old-]{+New+} quoted words here"],
        },
        {
            name: "an edited quote written without a space after its marker",
            original: ">Old quoted words here",
            current: ">New quoted words here",
            expected: ["blockquote modified inline: [-Old-]{+New+} quoted words here"],
        },
    ])("word-diffs $name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it.each([
        {
            name: "an edited quote is word-diffed",
            original: lines("> The quick fox.", "", "After."),
            current: lines("> The slow fox.", "", "After."),
            expected: ["blockquote modified inline: The [-quick-]{+slow+} fox."],
        },
        {
            name: "a line added to a quote is shown inside it",
            original: lines("> Line one.", "", "After."),
            current: lines("> Line one.", "> Line two.", "", "After."),
            expected: ["blockquote modified inline: Line one.{+ Line two.+}"],
        },
        {
            name: "an edited callout body keeps its label",
            original: lines("> [!NOTE]", "> Be careful here."),
            current: lines("> [!NOTE]", "> Be very careful here."),
            expected: ["blockquote modified inline: Note Be {+very +}careful here."],
        },
        {
            name: "an edited nested quote has no stray line-break marks",
            original: lines("> outer", ">", "> > inner old", "", "x"),
            current: lines("> outer", ">", "> > inner new", "", "x"),
            expected: ["blockquote modified inline: inner [-old-]{+new+}"],
        },
        {
            name: "an edited heading inside a quote has no stray line-break marks",
            original: lines("> ## Old heading", ">", "> body"),
            current: lines("> ## New heading", ">", "> body"),
            expected: ["h2 modified inline: [-Old-]{+New+} heading"],
        },
        {
            name: "a re-wrapped paragraph inside a quote is hidden",
            original: lines("> lead", ">", "> one two three", "> four"),
            current: lines("> lead", ">", "> one two", "> three four"),
            expected: [],
        },
        {
            name: "a quoted paragraph ending in a lazy continuation line is word-diffed",
            original: lines("> lead", ">", "> para old", "lazy tail"),
            current: lines("> lead", ">", "> para new", "lazy tail"),
            expected: ["p modified inline: para [-old-]{+new+} lazy tail"],
        },
    ])("$name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it.each([
        { name: "a level 1 heading", fence: "#", tag: "h1" },
        { name: "a level 3 heading", fence: "###", tag: "h3" },
        { name: "a level 4 heading", fence: "####", tag: "h4" },
        { name: "a level 5 heading", fence: "#####", tag: "h5" },
        { name: "a level 6 heading", fence: "######", tag: "h6" },
    ])("marks only the edited $name inside a quote, not the quote's lead", ({ fence, tag }) => {
        expect(
            view(lines("> Lead", ">", `> ${fence} Old`), lines("> Lead", ">", `> ${fence} New`)),
        ).toEqual([`${tag} modified wash: Before New`]);
    });

    it.each([
        {
            name: "a rule added",
            original: lines("> Lead", ">", "> after"),
            current: lines("> Lead", ">", "> ***", ">", "> after"),
            expected: ["hr added: "],
        },
        {
            name: "a definition list edited",
            original: lines("> Lead", ">", "> <dl><dt>a</dt><dd>b</dd></dl>"),
            current: lines("> Lead", ">", "> <dl><dt>a</dt><dd>c</dd></dl>"),
            expected: ["dl modified: Before ac"],
        },
    ])(
        "marks only $name inside a quote, not the quote's lead",
        ({ original, current, expected }) => {
            expect(view(original, current)).toEqual(expected);
        },
    );

    it("explains a paragraph turned into a quote over exactly the quoted text", () => {
        const { root } = diffView(
            lines("Keep this text.", "Second line."),
            lines("> Keep this text.", "> Second line."),
        );

        const marks = Array.from(root.querySelectorAll<HTMLElement>(`.${DIFF_TOOLTIP_CLASS}`));
        expect(marks.map((mark) => mark.textContent)).toEqual(["Keep this text.\nSecond line."]);
        expectPreciseAmber(marks[0]!, "Block changed from paragraph to quote");
    });

    it("washes an added blockquote green", () => {
        const root = render(["# Doc", "", "> New callout."].join("\n"));

        const res = decorate(root, [{ startLine: 3, endLine: 3, kind: "added" }]);

        expect(res.decorated).toBe(1);
        expect(root.querySelector("blockquote")?.classList.contains("emr-diff-block--added")).toBe(
            true,
        );
    });

    it("offers the previous quote in a Before disclosure for a rewritten quote", () => {
        const root = render("> Entirely different operational guidance now.");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalStartLine: 1,
                originalEndLine: 1,
                originalText: "> Nothing in common with the current quote.",
            },
        ]);
        expectComparisonAmber(root);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        trigger.click();
        expect(root.querySelector(".emr-diff-before-panel blockquote")?.textContent).toContain(
            "Nothing in common",
        );
    });

    it("word-diffs a GitHub-style admonition body and keeps its label", () => {
        const original = ["> [!NOTE]", "> The browser may omit capabilities from the map."].join(
            "\n",
        );

        const current = ["> [!NOTE]", "> The browser may omit capabilities from the object."].join(
            "\n",
        );

        const root = render(current);
        decorate(
            root,
            [
                {
                    startLine: 2,
                    endLine: 2,
                    kind: "modified",
                    originalStartLine: 2,
                    originalEndLine: 2,
                    originalText: "> The browser may omit capabilities from the map.",
                },
            ],
            original,
            current,
        );
        const alert = root.querySelector<HTMLElement>(".markdown-alert")!;
        expect(words(alert).removed).toContain("map");
        expect(words(alert).added).toContain("object");
        expect(alert.querySelector(".markdown-alert-title")?.textContent).toBe("Note");
    });

    it("word-diffs a quote that holds only inline HTML", () => {
        const original = "> <details><summary>Previous question</summary></details>";

        const current = "> <details><summary>Current question</summary></details>";

        const root = render(current);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: original,
            },
        ]);
        const quote = root.querySelector<HTMLElement>("blockquote")!;
        expect(words(quote).removed).toContain("Previous");
        expect(words(quote).added).toContain("Current");
    });
});
