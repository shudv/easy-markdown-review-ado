import { beforeEach, describe, expect, it } from "vitest";

import { decorateDiffRanges, DIFF_BLOCK_CLASS } from "../src/markdown/diffDecorations";
import { renderMarkdownSync } from "../src/markdown/render";
import { WORD_ADDED_CLASS } from "../src/markdown/wordDiffDom";
import { decorate, diffView, lines, render, view, words } from "./markdownDiffHarness";

// Rendered diff of nested lists: a change to a nested item marks only that
// item (never its parent), blocks nested in an item diff as their own kind,
// and an item indented or outdented explains its nesting change.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("nested and mixed lists", () => {
    it("word-diffs a deeply nested item and nothing else", () => {
        expect(
            view(
                lines("- a", "  - b", "    - c old text", "- d"),
                lines("- a", "  - b", "    - c new text", "- d"),
            ),
        ).toEqual(["li modified inline: c [-old-]{+new+} text"]);
    });
    it("marks only an added bullet nested under a numbered item", () => {
        const root = render(["1. first", "   - sub a", "   - sub b added", "2. second"].join("\n"));

        const res = decorate(root, [{ startLine: 3, endLine: 3, kind: "added" }]);

        expect(res.decorated).toBe(1);
        expect(
            root
                .querySelector<HTMLElement>('li[data-source-line="1"]')!
                .classList.contains(DIFF_BLOCK_CLASS),
        ).toBe(false);
        expect(
            root
                .querySelector<HTMLElement>('li[data-source-line="3"]')!
                .classList.contains("emr-diff-block--added"),
        ).toBe(true);
    });

    it("marks only an edited numbered item nested under a bullet", () => {
        const root = render(["- alpha", "  1. one", "  2. two changed", "- beta"].join("\n"));

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "  2. two pending",
            },
        ]);

        expect(res.decorated).toBe(1);
        expect(
            root
                .querySelector<HTMLElement>('li[data-source-line="1"]')!
                .classList.contains(DIFF_BLOCK_CLASS),
        ).toBe(false);

        const nested = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;

        expect(nested.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    });

    // Regression (field report): when a parent item AND its nested items are
    // all new, the parent washes only its own prose, so the nested items must
    // decorate themselves — they used to be skipped as "already covered" and
    // showed no highlight at all.
    it("marks each added nested item under an added loose parent", () => {
        const root = render(
            [
                "1. Keep this item.",
                "",
                "2. Benchmark each HVA-",
                "",
                "   1. Locally against the dev app perf plan.",
                "   2. Capture latency numbers from an e2e plan.",
            ].join("\n"),
        );

        const res = decorate(root, [{ startLine: 3, endLine: 6, kind: "added" }]);

        expect(res.decorated).toBe(3);

        expect(
            Array.from(root.querySelectorAll<HTMLElement>("li"), (li) => [
                li.dataset.sourceLine,
                li.dataset.diffKind,
            ]),
        ).toEqual([
            ["1", undefined],
            ["3", "added"],
            ["5", "added"],
            ["6", "added"],
        ]);

        // The parent's own prose <p> is still covered by the parent alone.
        expect(
            root
                .querySelector('li[data-source-line="3"] > p')!
                .classList.contains(DIFF_BLOCK_CLASS),
        ).toBe(false);
    });

    it("leaves nested items to a tight parent whose word diff already covers them", () => {
        const original = ["- parent item old", "  - child item old"].join("\n");
        const current = ["- parent item new", "  - child item new"].join("\n");
        const root = render(current);
        decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 2,
                    kind: "modified",
                    originalText: original,
                    originalStartLine: 1,
                    originalEndLine: 2,
                },
            ],
            original,
        );

        const parent = root.querySelector<HTMLElement>('li[data-source-line="1"]')!;

        const child = root.querySelector<HTMLElement>('li[data-source-line="2"]')!;

        expect(parent.dataset.diffInline).toBe("true");
        expect(child.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
        // One word diff, not two stacked on the child's text.
        expect(child.querySelectorAll(`.${WORD_ADDED_CLASS}`)).toHaveLength(1);
    });
    it("word-diffs an edited nested item next to its edited loose parent", () => {
        const original = ["1. Parent item says old words.", "", "   - Child item one."].join("\n");

        const current = ["1. Parent item says new words.", "", "   - Child item uno."].join("\n");

        const root = render(current);
        decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalText: "1. Parent item says old words.",
                    originalStartLine: 1,
                    originalEndLine: 1,
                },
                {
                    startLine: 3,
                    endLine: 3,
                    kind: "modified",
                    originalText: "   - Child item one.",
                    originalStartLine: 3,
                    originalEndLine: 3,
                },
            ],
            original,
        );

        const parent = root.querySelector<HTMLElement>('li[data-source-line="1"]')!;

        const child = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;

        expect(parent.dataset.diffInline).toBe("true");
        expect(child.dataset.diffKind).toBe("modified");
        expect(words(child)).toEqual({ added: "uno", removed: "one" });
    });
    it("word-diffs an edited MDN-style definition as the nested item, not its term", () => {
        const original = [
            "- `browserBoundKeyHardware`",
            "  - : Returns support from the user agent.",
        ].join("\n");

        const current = [
            "- `browserBoundKeyHardware`",
            "  - : Returns support from the current browser.",
        ].join("\n");

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
                    originalText: "  - : Returns support from the user agent.",
                },
            ],
            original,
            current,
        );
        const nested = root.querySelector<HTMLElement>("li li")!;
        expect(words(nested).removed).toContain("user agent");
        expect(words(nested).added).toContain("current browser");
        expect(root.querySelector("li")!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });
    it("washes an added loose item's text without its nested list", () => {
        const root = document.createElement("div");
        root.className = "markdown-body emr-rendered";
        root.innerHTML =
            '<li data-source-line="5" data-source-end-line="8"><p>Parent item</p><ul data-source-line="7" data-source-end-line="8"><li data-source-line="8" data-source-end-line="8">Child</li></ul></li>';

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        const parent = root.querySelector<HTMLElement>(":scope > li")!;
        expect(parent.querySelector("p > .emr-diff-line-wash")?.textContent).toBe("Parent item");
        expect(parent.querySelector(".emr-diff-line-wash ul")).toBeNull();
        expect(parent.querySelector(":scope > ul")).not.toBeNull();
    });

    it("keeps a tight nested ordered list outside its parent's wash", () => {
        const root = document.createElement("div");
        root.className = "markdown-body emr-rendered";
        root.innerHTML =
            '<li data-source-line="5" data-source-end-line="8">Parent item<ol data-source-line="7" data-source-end-line="8"><li data-source-line="8" data-source-end-line="8">Child</li></ol></li>';

        decorateDiffRanges(root, [{ startLine: 5, endLine: 5, kind: "added" }]);

        const parent = root.querySelector<HTMLElement>(":scope > li")!;
        expect(parent.querySelector(":scope > .emr-diff-line-wash")?.textContent).toBe(
            "Parent item",
        );
        expect(parent.querySelector(".emr-diff-line-wash ol")).toBeNull();
        expect(parent.querySelector(":scope > ol")).not.toBeNull();
    });
});

describe("blocks nested in list items", () => {
    it.each([
        {
            name: "a diagram",
            original: lines("- Flow:", "", "  ```mermaid", "  graph TD", "  A-->B", "  ```"),
            current: lines("- Flow:", "", "  ```mermaid", "  graph TD", "  A-->C", "  ```"),
            shown: ["div modified: graph TD A-->C"],
        },
        {
            name: "an equation",
            original: lines("- Formula:", "", "  $$", "  a+b", "  $$"),
            current: lines("- Formula:", "", "  $$", "  a+c", "  $$"),
            shown: ["div modified: a+c"],
        },
    ])(
        "marks only $name edited inside a list item, not the item",
        ({ original, current, shown }) => {
            expect(view(original, current)).toEqual(shown);
        },
    );
    it("diffs a four-space-indented list paragraph as prose, not code", () => {
        expect(
            view(
                lines("1. Step one", "", "    Details about the old thing.", "", "2. Step two"),
                lines("1. Step one", "", "    Details about the new thing.", "", "2. Step two"),
            ),
        ).toEqual(["p modified inline: Details about the [-old-]{+new+} thing."]);
    });

    it("never leaks Markdown syntax from an indented list paragraph", () => {
        expect(
            view(
                lines("- a", "", "    **Note:** old value", ""),
                lines("- a", "", "    **Note:** new value", ""),
            ),
        ).toEqual(["p modified inline: Note: [-old-]{+new+} value"]);
    });

    it("diffs a fenced block in a list item without a bogus language change", () => {
        expect(
            view(
                lines(
                    "1. Step one",
                    "",
                    "    ```sh",
                    "    npm install old",
                    "    ```",
                    "",
                    "2. Step two",
                ),
                lines(
                    "1. Step one",
                    "",
                    "    ```sh",
                    "    npm install new",
                    "    ```",
                    "",
                    "2. Step two",
                ),
            ),
        ).toEqual(["pre modified inline: npm install [-old-]{+new+}"]);
    });

    it("diffs an indented code block in a list item as code", () => {
        expect(
            view(
                lines("1. Step one", "", "       old code", "", "2. Step two"),
                lines("1. Step one", "", "       new code", "", "2. Step two"),
            ),
        ).toEqual(["pre modified inline: [-old-]{+new+} code"]);
    });

    it("diffs a quote in a list item without leaking its marker", () => {
        expect(
            view(
                lines("1. Step one", "", "    > Quoted old text here.", "", "2. Step two"),
                lines("1. Step one", "", "    > Quoted new text here.", "", "2. Step two"),
            ),
        ).toEqual(["blockquote modified inline: Quoted [-old-]{+new+} text here."]);
    });
});

describe("list nesting changes", () => {
    it("explains an item indented further down a list whose first item was rewritten", () => {
        expect(view(lines("- a", "- b", "- c"), lines("- A", "- A2", "- b", "  - c"))).toEqual([
            "li modified wash: Before A",
            "li added wash: A2",
            "li modified inline: ⟨List nesting changed from level 1 to level 2⟩c",
        ]);
    });

    it("explains a list item indented under its sibling", () => {
        expect(view(lines("- a", "- b", "- c"), lines("- a", "  - b", "- c"))).toEqual([
            "li modified inline: ⟨List nesting changed from level 1 to level 2⟩b",
        ]);
    });

    it("explains a list item outdented to its parent's level", () => {
        expect(view(lines("- a", "  - b", "- c"), lines("- a", "- b", "- c"))).toEqual([
            "li modified inline: ⟨List nesting changed from level 2 to level 1⟩b",
        ]);
    });

    it("reports an indented numbered item as nesting, not renumbering", () => {
        expect(view(lines("1. a", "2. b"), lines("1. a", "    1. b"))).toEqual([
            "li modified inline: ⟨List nesting changed from level 1 to level 2⟩b",
        ]);
    });

    it("leaves items carried along by an indented parent unmarked", () => {
        const { root } = diffView(lines("- a", "- b", "  - c"), lines("- a", "  - b", "    - c"));

        const tints = Array.from(root.querySelectorAll<HTMLElement>(".emr-diff-format-change")).map(
            (tint) => [tint.textContent, tint.dataset.diffTooltip],
        );

        expect(tints).toEqual([["b", "List nesting changed from level 1 to level 2"]]);
    });

    it("leaves items carried along by an indented loose parent unmarked", () => {
        expect(
            view(lines("- a", "", "- b", "", "  - c"), lines("- a", "", "  - b", "", "    - c")),
        ).toEqual(["li modified inline: ⟨List nesting changed from level 1 to level 2⟩b"]);
    });

    it("marks a child that moved under a different parent", () => {
        expect(view(lines("- a", "  - b", "  - c"), lines("- a", "  - b", "    - c"))).toEqual([
            "li modified inline: ⟨List nesting changed from level 2 to level 3⟩c",
        ]);
    });

    it("still shows a text edit in a child under an indented parent", () => {
        const { root } = diffView(
            lines("- a", "- b", "  - c old"),
            lines("- a", "  - b", "    - c new"),
        );

        expect(root.querySelector(".emr-word-removed")?.textContent).toBe("old");
        expect(root.querySelector(".emr-word-added")?.textContent).toBe("new");
    });

    it("still shows a text edit in a child under a renumbered item", () => {
        const { root } = diffView(lines("1. a", "   - c old"), lines("3. a", "   - c new"));

        expect(root.querySelector(".emr-word-removed")?.textContent).toBe("old");
        expect(root.querySelector(".emr-word-added")?.textContent).toBe("new");
    });

    it("explains nesting on the item itself when it has no text of its own", () => {
        expect(view(lines("- a", "- ![logo](a.png)"), lines("- a", "  - ![logo](a.png)"))).toEqual([
            "li modified inline ⟨List nesting changed from level 1 to level 2⟩: ",
        ]);
    });

    it("does not explain a nesting change when the previous line numbers do not fit the previous document", () => {
        const current = lines("- a", "  - b");
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync(current);
        decorateDiffRanges(
            root,
            [
                {
                    startLine: 2,
                    endLine: 2,
                    kind: "modified",
                    originalText: "- b",
                    originalStartLine: 5,
                    originalEndLine: 5,
                },
            ],
            {
                renderInline: renderMarkdownSync,
                originalSource: lines("- a", "- b"),
            },
        );
        expect(root.querySelector("li li")!.classList.contains("emr-diff-block")).toBe(false);
    });

    it("does not explain a nesting change when the previous document is unavailable", () => {
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync(lines("- a", "  - b"));
        decorateDiffRanges(
            root,
            [
                {
                    startLine: 2,
                    endLine: 2,
                    kind: "modified",
                    originalText: "- b",
                    originalStartLine: 2,
                    originalEndLine: 2,
                },
            ],
            { renderInline: renderMarkdownSync },
        );
        expect(root.querySelector("li li")!.classList.contains("emr-diff-block")).toBe(false);
    });

    it("does not explain a nesting change when the hunk also changed the number of lines", () => {
        const root = document.createElement("div");
        root.innerHTML = renderMarkdownSync(lines("- a", "  - b"));
        decorateDiffRanges(
            root,
            [
                {
                    startLine: 2,
                    endLine: 2,
                    kind: "modified",
                    originalText: "- b\n",
                    originalStartLine: 2,
                    originalEndLine: 3,
                },
            ],
            {
                renderInline: renderMarkdownSync,
                originalSource: lines("- a", "- b", ""),
            },
        );
        expect(root.querySelector("li li")!.classList.contains("emr-diff-block")).toBe(false);
    });
});
