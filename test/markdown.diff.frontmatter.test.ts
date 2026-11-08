import { beforeEach, describe, expect, it } from "vitest";

import { decorateDiffRanges, DIFF_BLOCK_CLASS } from "../src/markdown/diffDecorations";
import { WORD_ADDED_CLASS } from "../src/markdown/wordDiffDom";
import type { DiffRange } from "../src/types";
import {
    decorate,
    frontmatterValue,
    lines,
    makeRoot,
    render,
    view,
    words,
} from "./markdownDiffHarness";

// Rendered diff of the frontmatter card. The render pipeline lifts the `---`
// block into a key/value card and stamps each row with its source lines, so a
// changed line marks just its row and the value is word-diffed against the
// previous value reconstructed from ADO's per-line hunk.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("frontmatter value diffs", () => {
    it("word-diffs each edited value end to end", () => {
        expect(
            view(
                lines("---", "title: Old", "tags: [a, b]", "---", "", "Body."),
                lines("---", "title: New", "tags: [a, b, c]", "---", "", "Body."),
            ),
        ).toEqual([
            "div modified inline: title[-Old-]{+New+}",
            "div modified inline: tagsa, b{+, c+}",
        ]);
    });

    it("word-diffs an edited scalar value and leaves other keys untouched", () => {
        // Frontmatter occupies lines 1-4; `status` is source line 3.
        const md = [
            "---", // 1
            "title: Guide", // 2
            "status: Published", // 3
            "---", // 4
            "", // 5
            "# Body", // 6
        ].join("\n");

        const root = render(md);

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "status: Draft",
            },
        ]);

        expect(res.decorated).toBe(1);
        const status = frontmatterValue(root, "status");
        expect(words(status).added).toContain("Published");
        expect(words(status).removed).toContain("Draft");
        // The unchanged `title` row is not touched.
        expect(frontmatterValue(root, "title").querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    });

    it("word-diffs an item swapped in an inline list value", () => {
        // `tags` is source line 3.
        const md = [
            "---", // 1
            "title: Guide", // 2
            "tags: [widgets, platform, rfc]", // 3
            "---", // 4
            "", // 5
            "# Body", // 6
        ].join("\n");

        const root = render(md);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "tags: [widgets, config, rfc]",
            },
        ]);
        const tags = frontmatterValue(root, "tags");
        expect(tags.textContent).toContain("widgets");
        expect(words(tags).added).toContain("platform");
        expect(words(tags).removed).toContain("config");
    });

    it("shows a replaced block-list item when the hunk holds only that item line (the removed-reviewer regression)", () => {
        // The exact bug shape: a block list where ADO hands us only the changed
        // item line. `maintainers` key = line 3, items on lines 4-5. Line 5 (the
        // second maintainer) changed from `Grace Hopper` to `Alan Turing`.
        const md = [
            "---", // 1
            "title: Guide", // 2
            "maintainers:", // 3
            "  - Ada Lovelace", // 4
            "  - Alan Turing", // 5
            "---", // 6
            "", // 7
            "# Body", // 8
        ].join("\n");

        const root = render(md);
        // Sanity: the block list renders comma-joined.
        expect(frontmatterValue(root, "maintainers").textContent).toBe("Ada Lovelace, Alan Turing");

        const res = decorate(root, [
            {
                startLine: 5,
                endLine: 5,
                kind: "modified",
                // Only the changed item line — NO `maintainers:` key line.
                originalText: "  - Grace Hopper",
            },
        ]);

        expect(res.decorated).toBe(1);
        const maint = frontmatterValue(root, "maintainers");
        // Grace Hopper struck-through (removed), Alan Turing green (added).
        expect(words(maint)).toEqual({ added: "Alan Turing", removed: "Grace Hopper" });
        // Ada Lovelace (unchanged) is neither.
        expect(maint.textContent).toContain("Ada Lovelace");
    });

    it("reconstructs a block list in which one changed item used to be two", () => {
        const root = render(
            lines("---", "title: Guide", "maintainers:", "  - Bob Smith", "  - Alan Turing", "---"),
        );

        decorate(root, [
            { startLine: 4, endLine: 4, kind: "modified", originalText: "  - Ada\n  - Bea" },
            { startLine: 5, endLine: 5, kind: "modified", originalText: "  - Grace Hopper" },
        ]);

        expect(words(frontmatterValue(root, "maintainers"))).toEqual({
            added: "Bob Smith, Alan Turing",
            removed: "Ada, Bea, Grace Hopper",
        });
    });

    it("shows a replaced first item of a block list", () => {
        // Guards the index math: first item is on `keyLine + 1`, so a change there
        // must map to item index 0, not underflow.
        const md = [
            "---", // 1
            "reviewers:", // 2
            "  - Alan Turing", // 3
            "  - Bob Jones", // 4
            "---", // 5
            "", // 6
            "# Body", // 7
        ].join("\n");

        const root = render(md);

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "  - Ada Lovelace",
            },
        ]);

        expect(res.decorated).toBe(1);
        const rev = frontmatterValue(root, "reviewers");
        expect(words(rev).removed).toContain("Ada Lovelace");
        expect(words(rev).added).toContain("Alan Turing");
        expect(rev.textContent).toContain("Bob Jones");
    });

    it("marks the whole value green on a newly-added key row", () => {
        // A brand-new `owner` key (added range) diffs against "" → all green, and
        // its KEY label washes green while the value words read as added.
        const md = [
            "---", // 1
            "title: Guide", // 2
            "owner: Platform Team", // 3
            "---", // 4
            "", // 5
            "# Body", // 6
        ].join("\n");

        const root = render(md);
        decorate(root, [{ startLine: 3, endLine: 3, kind: "added" }]);

        const owner = frontmatterValue(root, "owner");

        expect(
            owner.closest(".emr-frontmatter-row")!.classList.contains("emr-diff-block--added"),
        ).toBe(true);
        expect(words(owner).added).toContain("Platform Team");
        expect(words(owner).removed).toBe("");
    });

    it("leaves the value cell without a stretching background wash", () => {
        // A tags/list value must NEVER get a block wash — only inline word marks.
        const md = [
            "---", // 1
            "tags: [widgets, platform]", // 2
            "---", // 3
            "", // 4
            "# Body", // 5
        ].join("\n");

        const root = render(md);
        decorate(root, [
            {
                startLine: 2,
                endLine: 2,
                kind: "modified",
                originalText: "tags: [widgets, config]",
            },
        ]);
        const tags = frontmatterValue(root, "tags");
        // The value cell itself carries no diff-block wash classes.
        expect(tags.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
        expect(tags.classList.contains("emr-diff-block--modified")).toBe(false);
        // Change is expressed purely as inline word marks.
        expect(tags.querySelector(`.${WORD_ADDED_CLASS}`)).not.toBeNull();
    });

    it("does not touch frontmatter rows when only body lines changed", () => {
        const md = [
            "---", // 1
            "status: Published", // 2
            "---", // 3
            "", // 4
            "Body paragraph.", // 5
        ].join("\n");

        const root = render(md);
        decorate(root, [
            {
                startLine: 5,
                endLine: 5,
                kind: "modified",
                originalText: "Old.",
            },
        ]);
        const status = frontmatterValue(root, "status");
        expect(status.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
        expect(status.closest(".emr-frontmatter-row")!.classList.contains(DIFF_BLOCK_CLASS)).toBe(
            false,
        );
    });

    it("renders the same marks when re-decorated and restores the value when cleared", () => {
        const md = [
            "---", // 1
            "status: Published", // 2
            "---", // 3
            "", // 4
            "# Body", // 5
        ].join("\n");

        const root = render(md);

        const range: DiffRange = {
            startLine: 2,
            endLine: 2,
            kind: "modified",
            originalText: "status: Draft",
        };

        decorate(root, [range]);
        const firstHtml = frontmatterValue(root, "status").innerHTML;
        // Decorate again with the same range — output must be identical.
        decorate(root, [range]);
        expect(frontmatterValue(root, "status").innerHTML).toBe(firstHtml);

        // And clearing restores the plain rendered value.
        decorateDiffRanges(root, []);
        expect(frontmatterValue(root, "status").textContent).toBe("Published");
        expect(frontmatterValue(root, "status").querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
    });

    it("reconstructs a block list in which two items changed at once", () => {
        const root = render(
            lines("---", "title: Guide", "maintainers:", "  - Bob Smith", "  - Alan Turing", "---"),
        );

        decorate(root, [
            { startLine: 4, endLine: 4, kind: "modified", originalText: "  - Ada" },
            { startLine: 5, endLine: 5, kind: "modified", originalText: "  - Grace Hopper" },
        ]);

        const maintainers = words(frontmatterValue(root, "maintainers"));
        expect(maintainers.removed).toContain("Ada");
        expect(maintainers.removed).toContain("Grace Hopper");
        expect(maintainers.added).toContain("Bob Smith");
        expect(maintainers.added).toContain("Alan Turing");
    });

    it.each<{ name: string; range: DiffRange; current: string }>([
        {
            name: "the key line replaced what used to be a bare list item",
            current: lines("---", "maintainers:", "  - Ada Lovelace", "  - Alan Turing", "---"),
            range: { startLine: 2, endLine: 2, kind: "modified", originalText: "  - Ghost" },
        },
        {
            name: "the key line of an emptied list replaced what used to be a bare list item",
            current: lines("---", "maintainers:", "---"),
            range: { startLine: 2, endLine: 2, kind: "modified", originalText: "  - Ghost" },
        },
        {
            name: "the key was renamed",
            current: lines("---", "tags: y", "---"),
            range: { startLine: 2, endLine: 2, kind: "modified", originalText: "title: Doc" },
        },
        {
            name: "the previous line is unknown",
            current: lines("---", "tags: y", "---"),
            range: { startLine: 2, endLine: 2, kind: "modified" },
        },
        {
            name: "only the quoting of the value changed",
            current: lines("---", 'title: "Guide"', "---"),
            range: { startLine: 2, endLine: 2, kind: "modified", originalText: "title: Guide" },
        },
    ])("leaves the value without word marks when $name", ({ current, range }) => {
        const root = render(current);

        decorate(root, [range]);

        const row = root.querySelector<HTMLElement>(`.emr-frontmatter-row[data-source-line="2"]`)!;
        expect(row.dataset.diffInline).toBeUndefined();
        expect(words(row)).toEqual({ added: "", removed: "" });
    });
});

// The renderer always emits a key and a value element per row; a customised
// card that lacks either is left as it is.
describe("frontmatter rows missing a key or value element", () => {
    it.each([
        { name: "a row with no key", html: '<dd class="emr-frontmatter-value">x</dd>' },
        { name: "a row with no value", html: '<dt class="emr-frontmatter-key">tags</dt>' },
    ])("leaves $name without word marks", ({ html }) => {
        const root = makeRoot([{ tag: "div", start: 2, end: 2, html }]);
        const row = root.firstElementChild as HTMLElement;
        row.className = "emr-frontmatter-row";

        decorateDiffRanges(root, [
            { startLine: 2, endLine: 2, kind: "modified", originalText: "tags: [a]" },
        ]);

        expect(row.dataset.diffInline).toBeUndefined();
        expect(words(row)).toEqual({ added: "", removed: "" });
    });

    it.each([
        { name: "no key", key: "" },
        { name: "an empty key", key: '<dt class="emr-frontmatter-key"> </dt>' },
    ])(
        "leaves a list row with $name without word marks when one of its items changed",
        ({ key }) => {
            const html = `${key}<dd class="emr-frontmatter-value">Ada, Bob</dd>`;
            const root = makeRoot([{ tag: "div", start: 2, end: 3, html }]);
            const row = root.firstElementChild as HTMLElement;
            row.className = "emr-frontmatter-row";

            decorateDiffRanges(root, [
                { startLine: 3, endLine: 3, kind: "modified", originalText: "  - Old" },
            ]);

            expect(words(row)).toEqual({ added: "", removed: "" });
        },
    );
});
