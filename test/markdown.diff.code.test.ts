import { beforeEach, describe, expect, it } from "vitest";

import { DIFF_INLINE_CLASS, DIFF_METADATA_CLASS } from "../src/markdown/diffDecorations";
import { WORD_ADDED_CLASS } from "../src/markdown/wordDiffDom";
import {
    decorate,
    diffView,
    expectComparisonAmber,
    expectPreciseAmber,
    lines,
    makeRoot,
    render,
    view,
    words,
} from "./markdownDiffHarness";
import { decorateDiffRanges } from "../src/markdown/diffDecorations";

// Rendered diff of fenced and indented code blocks: word-level edits inside
// the code, whitespace and indentation changes, and fence metadata (language,
// options).

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("code blocks end to end", () => {
    it.each([
        {
            name: "a fenced block with a blank line inside a numbered step",
            original: lines(
                "1.  Step:",
                "",
                "    ```sh",
                "    npm ci",
                "",
                "    npm test",
                "    ```",
            ),
            current: lines(
                "1.  Step:",
                "",
                "    ```sh",
                "    npm ci",
                "",
                "    npm run test",
                "    ```",
            ),
            expected: ["pre modified inline: npm ci npm {+run +}test"],
        },
        {
            name: "an indented block starting with a home-directory path inside a numbered step",
            original: lines("1.  Step:", "", "        ~/bin/tool --old"),
            current: lines("1.  Step:", "", "        ~/bin/tool --new"),
            expected: ["pre modified inline: ~/bin/tool --[-old-]{+new+}"],
        },
    ])("word-diffs $name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it.each([
        {
            name: "an edited line is word-diffed inside the block",
            original: lines("```js", "const a = 1;", "const b = 2;", "```"),
            current: lines("```js", "const a = 1;", "const b = 3;", "```"),
            expected: ["pre modified inline: const a = 1; const b = [-2-]{+3+};"],
        },
        {
            name: "an edited identifier is replaced as a whole word",
            original: lines("```js", "const fooBar = 1;", "```"),
            current: lines("```js", "const fooBaz = 1;", "```"),
            expected: ["pre modified inline: const [-fooBar-]{+fooBaz+} = 1;"],
        },
        {
            name: "an edited indented code block is word-diffed",
            original: lines("Text:", "", "    old code", "", "End."),
            current: lines("Text:", "", "    new code", "", "End."),
            expected: ["pre modified inline: [-old-]{+new+} code"],
        },
        {
            name: "a line inserted into a code block is shown inside it",
            original: lines("```js", "a();", "c();", "```"),
            current: lines("```js", "a();", "b();", "c();", "```"),
            expected: ["pre modified inline: a(); {+b(); +}c();"],
        },
        {
            name: "a line appended to a code block is shown inside it",
            original: lines("```js", "const a = 1;", "```"),
            current: lines("```js", "const a = 1;", "const b = 2;", "```"),
            expected: ["pre modified inline: const a = 1; {+const b = 2; +}"],
        },
        {
            name: "a blank line added to a code block is shown as an edit",
            original: lines("```", "a", "b", "```"),
            current: lines("```", "a", "", "b", "```"),
            expected: ["pre modified inline: a {+ +}b"],
        },
        {
            name: "a wholly new code block is washed green",
            original: lines("Text.", "", "More."),
            current: lines("Text.", "", "```sh", "npm i", "```", "", "More."),
            expected: ["pre added wash: npm i"],
        },
    ])("$name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it("shows a line removed from a code block inside it", () => {
        const { view: result, result: counts } = diffView(
            lines("```js", "a();", "b();", "c();", "```"),
            lines("```js", "a();", "c();", "```"),
        );

        expect(result).toEqual(["pre modified inline: a(); [-b(); -]c();"]);
        expect(counts.markers).toBe(0);
    });
});

describe("code blocks", () => {
    it("washes an edited code block when its complete original is unavailable", () => {
        const root = render(["```", "const x = 2;", "```"].join("\n"));

        const res = decorate(root, [
            {
                startLine: 2,
                endLine: 2,
                kind: "modified",
                originalText: "const x = 1;",
            },
        ]);

        expect(res.inlined).toBe(0);
        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(pre.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(root.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
        expectPreciseAmber(pre, "Previous content unavailable; exact comparison cannot be shown");
    });

    it("word-diffs a one-token code edit using the previous document", () => {
        const original = ["```js", "const value = 1;", "```"].join("\n");
        const current = ["```js", "const value = 2;", "```"].join("\n");
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
                    originalText: "const value = 1;",
                },
            ],
            original,
        );
        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(pre.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(words(pre).removed).toContain("1");
        expect(words(pre).added).toContain("2");
        expect(root.querySelector(".emr-diff-before-trigger")).toBeNull();
    });

    it("word-diffs code from a hunk spanning the whole fence and the next paragraph", () => {
        const root = render(["```js", "const value = 2;", "```", "Stable."].join("\n"));

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 4,
                kind: "modified",
                originalText: ["```js", "const value = 1;", "```", "Stable."].join("\n"),
            },
        ]);

        expect(res.inlined).toBe(1);
        expect(words(root.querySelector("pre")!).removed).toContain("1");
        expect(words(root.querySelector("pre")!).added).toContain("2");
    });

    it("explains that the previous code is unavailable when the hunk has no original text", () => {
        const root = render(["```js", "const value = 2;", "```", "Stable."].join("\n"));

        const res = decorate(root, [{ startLine: 1, endLine: 4, kind: "modified" }]);

        expect(res.inlined).toBe(0);
        expect(root.querySelector("pre")?.classList.contains("emr-diff-block--modified")).toBe(
            true,
        );
        expectPreciseAmber(
            root.querySelector<HTMLElement>("pre")!,
            "Previous content unavailable; exact comparison cannot be shown",
        );
    });

    it("offers the previous code in a Before disclosure for a rewritten line", () => {
        const original = ["```powershell", "Remove-Item legacy.cache -Force", "```"].join("\n");

        const current = ["```powershell", "Invoke-RestMethod $healthEndpoint", "```"].join("\n");

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
                    originalText: "Remove-Item legacy.cache -Force",
                },
            ],
            original,
        );
        expectComparisonAmber(root);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        trigger.click();
        expect(root.querySelector(".emr-diff-before-panel pre")?.textContent).toBe(
            "Remove-Item legacy.cache -Force\n",
        );
    });

    it("word-diffs several edited code lines", () => {
        const original = ["```ts", "const retries = 3;", "const timeout = 15;", "```"].join("\n");

        const current = ["```ts", "const retries = 4;", "const timeout = 30;", "```"].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 2,
                    endLine: 3,
                    kind: "modified",
                    originalStartLine: 2,
                    originalEndLine: 3,
                    originalText: ["const retries = 3;", "const timeout = 15;"].join("\n"),
                },
            ],
            original,
        );

        expect(res.inlined).toBe(1);
        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(words(pre).removed).toContain("3");
        expect(words(pre).removed).toContain("15");
        expect(words(pre).added).toContain("4");
        expect(words(pre).added).toContain("30");
    });

    it("shows code words and language metadata together", () => {
        const original = ["```bash", "echo deployment old", "```"].join("\n");

        const current = ["```powershell", "echo deployment new", "```"].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 2,
                    kind: "modified",
                    originalText: ["```bash", "echo deployment old"].join("\n"),
                    originalStartLine: 1,
                    originalEndLine: 2,
                },
            ],
            original,
        );

        expect(res.inlined).toBe(1);
        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(words(pre).removed).toContain("old");
        expect(words(pre).added).toContain("new");
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain("Before bash");
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
            "After powershell",
        );
    });

    it("keeps Before when language metadata accompanies a code rewrite", () => {
        const original = ["```bash", "rm legacy.cache --force", "```"].join("\n");

        const current = ["```powershell", "Invoke-RestMethod $healthEndpoint", "```"].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 2,
                    kind: "modified",
                    originalText: ["```bash", "rm legacy.cache --force"].join("\n"),
                    originalStartLine: 1,
                    originalEndLine: 2,
                },
            ],
            original,
        );

        expect(res.inlined).toBe(0);

        const pre = root.querySelector<HTMLElement>("pre.emr-diff-block--modified")!;

        expect(pre.classList.contains(DIFF_INLINE_CLASS)).toBe(false);
        const metadata = pre.querySelector(`.${DIFF_METADATA_CLASS}`);
        // eslint-disable-next-line vitest/valid-expect -- vitest's expect(value, message) overload: the rendered <pre> HTML is the failure message
        expect(metadata, pre.outerHTML).not.toBeNull();
        expect(metadata?.textContent).toContain("Before bash");
        expect(root.querySelector(".emr-diff-before-trigger")).not.toBeNull();
    });
    it("shows a language indicator when code text is unchanged", () => {
        const root = render(["```powershell", "Get-Service", "```"].join("\n"));

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 3,
                kind: "modified",
                originalText: ["```bash", "Get-Service", "```"].join("\n"),
            },
        ]);

        expect(res.inlined).toBe(1);
        const pre = root.querySelector("pre")!;
        expect(pre.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain("Before bash");
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
            "After powershell",
        );

        const trigger = pre.querySelector<HTMLButtonElement>(".emr-diff-metadata-trigger")!;

        trigger.click();
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        trigger.click();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("shows same-language fence option changes without an identical Before panel", () => {
        const original = [
            '```js [[1, 3, "updateName"], [2, 23, "submitAction"]]',
            '"use client";',
            "```",
        ].join("\n");

        const current = [
            '```js [[1, 3, "updateName"], [2, 25, "submitAction"]]',
            '"use client";',
            "```",
        ].join("\n");

        const root = render(current);

        const result = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 1,
                    originalText: '```js [[1, 3, "updateName"], [2, 23, "submitAction"]]',
                },
            ],
            original,
            current,
        );

        expect(result.inlined).toBe(1);

        const metadata = root.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;

        expect(metadata.textContent).toContain(
            'Before [[1, 3, "updateName"], [2, 23, "submitAction"]]',
        );
        expect(metadata.textContent).toContain(
            'After [[1, 3, "updateName"], [2, 25, "submitAction"]]',
        );
        expect(root.querySelector(".emr-diff-before-trigger")).toBeNull();
    });

    it.each([
        {
            name: "adds language and options",
            original: ["```", '"use client";', "```"].join("\n"),
            current: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join("\n"),
            before: "Before plain text; options: none",
            after: 'After js; options: [[1, 3, "updateName"]]',
        },
        {
            name: "removes options while changing language",
            original: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join("\n"),
            current: ["```ts", '"use client";', "```"].join("\n"),
            before: 'Before js; options: [[1, 3, "updateName"]]',
            after: "After ts; options: none",
        },
        {
            name: "adds options without changing language",
            original: ["```js", '"use client";', "```"].join("\n"),
            current: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join("\n"),
            before: "Before none",
            after: 'After [[1, 3, "updateName"]]',
        },
        {
            name: "removes options without changing language",
            original: ['```js [[1, 3, "updateName"]]', '"use client";', "```"].join("\n"),
            current: ["```js", '"use client";', "```"].join("\n"),
            before: 'Before [[1, 3, "updateName"]]',
            after: "After none",
        },
        {
            name: "describes an unlabeled code fence as plain text",
            original: ["```", "Get-Service", "```"].join("\n"),
            current: ["```powershell", "Get-Service", "```"].join("\n"),
            before: "Before plain text",
            after: "After powershell",
        },
    ])("fence metadata: $name", ({ original, current, before, after }) => {
        const root = render(current);
        decorate(root, [
            {
                startLine: 1,
                endLine: 3,
                kind: "modified",
                originalText: original,
            },
        ]);
        const metadata = root.querySelector(`.${DIFF_METADATA_CLASS}`)!;
        expect(metadata.textContent).toContain(before);
        expect(metadata.textContent).toContain(after);
    });

    it.each([
        {
            name: "only the language",
            original: lines("```bash", "echo hi", "```"),
            current: lines("```powershell", "echo hi", "```"),
            label: "Language changed",
            values: ["bash", "powershell"],
        },
        {
            name: "only the options",
            original: lines("```js title=a.js", "x()", "```"),
            current: lines("```js title=b.js", "x()", "```"),
            label: "Code options changed",
            values: ["title=a.js", "title=b.js"],
        },
        {
            name: "both the language and the options",
            original: lines("```js title=a.js", "x()", "```"),
            current: lines("```ts title=b.js", "x()", "```"),
            label: "Code fence changed",
            values: ["js; options: title=a.js", "ts; options: title=b.js"],
        },
    ])("names a fence change of $name", ({ original, current, label, values }) => {
        const { root } = diffView(original, current);

        const metadata = root.querySelector(`.${DIFF_METADATA_CLASS}`)!;
        expect(metadata.querySelector(".emr-diff-metadata-trigger")?.textContent).toBe(label);
        expect(
            Array.from(
                metadata.querySelectorAll(".emr-diff-metadata-value"),
                (value) => value.textContent,
            ),
        ).toEqual(values);
    });

    it("explains a fence de-indentation as code structure and content changes", () => {
        const original = [
            "    ```bash",
            '    git config --global user.name "Your Name"',
            "    ```",
        ].join("\n");

        const current = ["```bash", 'git config --global user.name "Your Name"', "```"].join("\n");

        const root = render(current);
        decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 3,
                    kind: "modified",
                    originalStartLine: 1,
                    originalEndLine: 3,
                    originalText: original,
                },
            ],
            original,
            current,
        );
        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain(
            "Before plain text",
        );
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)?.textContent).toContain("After bash");
        expect(words(pre).removed).toContain("```bash");
    });
    it("fits an added code block's wash to its lines", () => {
        const root = makeRoot([
            { tag: "pre", start: 5, end: 5, html: "<code>const x = 1;</code>" },
        ]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        expect(root.querySelector("pre > code > .emr-diff-line-wash")?.textContent).toBe(
            "const x = 1;",
        );
        expect(root.querySelector("pre")?.dataset.diffLineWash).toBe("true");
        expect(root.querySelector("pre")?.dataset.diffGroup).toBeUndefined();
    });

    it("word-diffs a paragraph that was turned into a code block, without a language indicator", () => {
        const root = render(lines("```js", "const x = 2;", "```"));

        decorate(root, [
            { startLine: 1, endLine: 3, kind: "modified", originalText: "const x = 1;" },
        ]);

        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(words(pre).removed).toBe("1;");
        expect(words(pre).added).toContain("2;");
        expect(pre.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    });
});

// Markdown always renders a fence as <pre><code>; these pin the fallback for a
// <pre> that reaches the decorator without a <code> element.
describe("preformatted blocks without a code element", () => {
    it("washes an added <pre> as a whole block", () => {
        const root = makeRoot([{ tag: "pre", start: 5, end: 5, html: "const x = 1;" }]);

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        const pre = root.querySelector<HTMLElement>("pre")!;
        expect(pre.classList.contains("emr-diff-block--added")).toBe(true);
        expect(pre.dataset.diffLineWash).toBeUndefined();
    });

    it("shows no language indicator for an edited <pre>", () => {
        const root = makeRoot([{ tag: "pre", start: 5, end: 5, html: "const x = 2;" }]);

        decorateDiffRanges(
            root,
            [{ startLine: 5, endLine: 5, kind: "modified", originalText: "const x = 1;" }],
            { renderInline: (md) => `<pre><code class="language-ts">${md}</code></pre>` },
        );

        expect(root.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    });
});

describe("whitespace in code blocks", () => {
    it("shows a code block whose only change is a tab replaced by spaces with just the explanation", () => {
        expect(
            view(
                lines("```go", "func f() {", "\treturn", "}", "```"),
                lines("```go", "func f() {", "    return", "}", "```"),
            ),
        ).toEqual([
            "pre modified inline: func f() { ⟨Indentation changed from 1 tab to 4 spaces⟩ return }",
        ]);
    });

    function codeMarks(original: string, current: string) {
        const { root } = diffView(original, current);

        return Array.from(
            root.querySelectorAll<HTMLElement>(
                ".emr-word-added, .emr-word-removed, .emr-diff-format-change",
            ),
        ).map((mark) =>
            mark.classList.contains("emr-diff-format-change")
                ? `~${JSON.stringify(mark.textContent)} ${mark.dataset.diffTooltip}`
                : `${mark.className.includes("added") ? "+" : "-"}${JSON.stringify(mark.textContent)}`,
        );
    }

    it.each([
        {
            name: "re-indents a line by marking only the added spaces",
            original: lines("```py", "def f():", "  return 1", "```"),
            current: lines("```py", "def f():", "    return 1", "```"),
            marks: ['+"  "'],
        },
        {
            name: "de-indents a line by marking only the removed spaces",
            original: lines("```py", "if x:", "    y()", "```"),
            current: lines("```py", "if x:", "  y()", "```"),
            marks: ['-"  "'],
        },
        {
            name: "explains a tab replaced by spaces as one amber indentation change",
            original: lines("```go", "func f() {", "\treturn", "}", "```"),
            current: lines("```go", "func f() {", "    return", "}", "```"),
            marks: ['~"    " Indentation changed from 1 tab to 4 spaces'],
        },
        {
            name: "explains the first line's tab replaced by spaces as an indentation change",
            original: lines("```", "\tvalue", "```"),
            current: lines("```", "    value", "```"),
            marks: ['~"    " Indentation changed from 1 tab to 4 spaces'],
        },
        {
            name: "names both spaces and tabs in a mixed indentation change",
            original: lines("```", "\t\tkey = 1", "```"),
            current: lines("```", "  \tkey = 1", "```"),
            marks: ['~"  \\t" Indentation changed from 2 tabs to 2 spaces and 1 tab'],
        },
        {
            name: "explains a whitespace swap after a word removed earlier on the line",
            original: lines("```", "const old value = compute(input)\t// note", "```"),
            current: lines("```", "const value = compute(input) // note", "```"),
            marks: ['-"old "', '~" " Whitespace changed from 1 tab to 1 space'],
        },
        {
            name: "explains a mid-line whitespace swap next to a word edit",
            original: lines("```", "key\t\tvalue old", "```"),
            current: lines("```", "key value new", "```"),
            marks: ['~" " Whitespace changed from 2 tabs to 1 space', '-"old"', '+"new"'],
        },
        {
            name: "dedents a block without marking its line breaks",
            original: lines("```py", "    x = 1", "    y = 2", "```"),
            current: lines("```py", "x = 1", "y = 2", "```"),
            marks: ['-"    "', '-"    "'],
        },
        {
            name: "adds trailing whitespace without marking the line break",
            original: lines("```", "a", "b", "```"),
            current: lines("```", "a  ", "b", "```"),
            marks: ['+"  "'],
        },
    ])("$name", ({ original, current, marks }) => {
        expect(codeMarks(original, current)).toEqual(marks);
    });
});
