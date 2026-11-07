import { beforeEach, describe, expect, it } from "vitest";

import {
    DIFF_BLOCK_CLASS,
    DIFF_FORMAT_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_METADATA_CLASS,
} from "../src/markdown/diffDecorations";
import { WORD_ADDED_CLASS, WORD_REMOVED_CLASS } from "../src/markdown/wordDiffDom";
import { decorate, expectPreciseAmber, lines, render, view, words } from "./markdownDiffHarness";

// Rendered diff of bulleted, numbered and task lists: each changed item is
// marked on its own (never the whole list), marker / numbering / checkbox
// changes are explained, and renumbering alone is not shown as an edit.

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("list items end to end", () => {
    it.each([
        {
            name: "an added item is washed on its own",
            original: lines("- apple", "- banana", "- cherry"),
            current: lines("- apple", "- banana", "- date", "- cherry"),
            expected: ["li added wash: date"],
        },
        {
            name: "a removed item leaves a removal marker",
            original: lines("- apple", "- banana", "- cherry"),
            current: lines("- apple", "- cherry"),
            expected: ["deleted: 1 line removed"],
        },
        {
            name: "an added nested item is washed on its own",
            original: lines("- parent", "- other"),
            current: lines("- parent", "  - child", "- other"),
            expected: ["li added wash: child"],
        },
        {
            name: "an edited item in a loose list is word-diffed",
            original: lines("- item one", "", "- item two", "", "- item three"),
            current: lines("- item one", "", "- item 2", "", "- item three"),
            expected: ["li modified inline: item [-two-]{+2+}"],
        },
        {
            name: "a number edited inside an item is word-diffed",
            original: lines("- Retries: 3", "- x"),
            current: lines("- Retries: 5", "- x"),
            expected: ["li modified inline: Retries: [-3-]{+5+}"],
        },
        {
            name: "bullets switched to numbers explain the marker change on each item",
            original: lines("- a", "- b"),
            current: lines("1. a", "2. b"),
            expected: [
                "li modified inline ⟨List marker changed from bulleted to numbered⟩: a",
                "li modified inline ⟨List marker changed from bulleted to numbered⟩: b",
            ],
        },
        {
            name: "an item turned into a paragraph explains the block change",
            original: "- just text",
            current: "just text",
            expected: ["p modified inline: ⟨Block changed from list item to paragraph⟩just text"],
        },
        {
            name: "a lazy continuation line added to an item is shown inside that item",
            original: lines("- item one", "- item two"),
            current: lines("- item one", "  continued", "- item two"),
            expected: ["li modified inline: item one{+ continued+}"],
        },
        {
            name: "a removed item whose continuation now joins the previous item leaves a removal marker",
            original: lines("- item one", "- item gone", "  continued"),
            current: lines("- item one", "  continued"),
            expected: ["deleted: 1 line removed"],
        },
        {
            name: "a renumbering cascade after an inserted item is hidden",
            original: lines("1. one", "2. two", "3. three"),
            current: lines("1. one", "2. inserted", "3. two", "4. three"),
            expected: ["li added wash: inserted"],
        },
        {
            name: "a bullet-marker swap is hidden",
            original: lines("- apple", "- banana"),
            current: lines("* apple", "* banana"),
            expected: [],
        },
        {
            name: "a marker change stays visible when the item text also changed",
            original: lines("1. do thing", "2. other"),
            current: lines("- do the thing", "- other"),
            expected: [
                "li modified inline ⟨List marker changed from numbered to bulleted⟩: do {+the +}thing",
                "li modified inline ⟨List marker changed from numbered to bulleted⟩: other",
            ],
        },
        {
            name: "a checkbox toggle stays visible when the item text also changed",
            original: lines("- [ ] write tests", "- [ ] ship"),
            current: lines("- [x] write unit tests", "- [ ] ship"),
            expected: [
                "li modified inline: ⟨Checklist item changed from unchecked to checked⟩ write {+unit +}tests",
            ],
        },
    ])("$name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });
});

describe("unordered lists", () => {
    it("washes an added empty item as a whole block", () => {
        const root = render(lines("- one", "-", "- three"));

        decorate(root, [{ startLine: 2, endLine: 2, kind: "added" }]);

        const item = root.querySelectorAll<HTMLElement>("li")[1]!;
        expect(item.dataset.diffKind).toBe("added");
        expect(item.dataset.diffLineWash).toBeUndefined();
    });
    it("marks only the list marker when an item changes list type", () => {
        const root = render("1. beta");

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "- beta",
            },
        ]);

        expect(res.inlined).toBe(1);
        const item = root.querySelector("li")!;
        expect(item.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(item.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(item.classList.contains("emr-diff-list-marker-change")).toBe(true);
        expectPreciseAmber(item, "List marker changed from bulleted to numbered");
        expect(item.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
        expect(item.querySelector(".emr-diff-before-trigger")).toBeNull();
        decorate(root, []);
        expect(item.classList.contains("emr-diff-list-marker-change")).toBe(false);
        expect(item.title).toBe("");
    });
    it("explains bold added inside a list item without reporting a marker change", () => {
        const root = render("- **beta** remains stable");

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "- beta remains stable",
            },
        ]);

        expect(res.inlined).toBe(1);
        const item = root.querySelector<HTMLElement>("li")!;
        expect(item.classList.contains("emr-diff-list-marker-change")).toBe(false);
        expectPreciseAmber(
            item.querySelector<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)!,
            "Bold formatting added",
        );
    });
});

describe("ordered lists", () => {
    it("word-diffs an edited numbered item", () => {
        const root = render(["1. one", "2. second step complete", "3. three"].join("\n"));

        const res = decorate(root, [
            {
                startLine: 2,
                endLine: 2,
                kind: "modified",
                originalText: "2. second step pending",
            },
        ]);

        expect(res.inlined).toBe(1);
        const li = root.querySelectorAll("li")[1]!;
        expect(words(li).added).toContain("complete");
        expect(words(li).removed).toContain("pending");
    });

    // Regression: a hard-wrapped (multi-line) numbered item whose whole span was
    // edited must still decorate. This is the exact shape from the field bug
    // report — a design-review checklist item reworded across two source lines
    // ("…To private ip APIs, or public grab them?" → "…To the v3 or v4 OData API,
    // the Planner Graph API, or both? How will clients handle them?"). The item
    // renders as ONE <li> spanning both source lines; the diff must land on it
    // rather than silently no-op (which would make the file look unchanged).
    it("word-diffs a hard-wrapped numbered item edited across both its lines", () => {
        const root = render(
            [
                "The following is a checklist of topics to consider when finalizing a design.",
                "",
                "1. Security — what are the implications on AuthN or AuthZ (who has access to",
                "   do what with data?)",
                "2. Does this work make breaking API changes? To the v3 or v4 OData API, the",
                "   Planner Graph API, or both? How will clients handle them?",
                "3. Have you considered risks around code upgrade (schema changes, N-1)?",
            ].join("\n"),
        );

        // Item 2 spans source lines 5–6; both lines were part of the edit.
        const res = decorate(root, [
            {
                startLine: 5,
                endLine: 6,
                kind: "modified",
                originalText:
                    "2. Does this work make breaking API changes? To private ip APIs, or\n   public grab them?",
            },
        ]);

        expect(res.decorated).toBe(1);
        expect(res.inlined).toBe(1);

        const item2 = root.querySelector<HTMLElement>('li[data-source-line="5"]')!;

        expect(item2.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(item2.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(words(item2).added).toContain("v4");
        expect(words(item2).removed).toContain("private");
        // The unchanged neighbours must NOT light up.
        expect(
            root.querySelector('li[data-source-line="3"]')!.classList.contains(DIFF_BLOCK_CLASS),
        ).toBe(false);
    });

    // When only ONE line of a hard-wrapped item changed, `originalText` is a
    // fragment that doesn't cover the block's span, so the inline word-diff is
    // (correctly) skipped — but the item must STILL decorate with a wash so the
    // reviewer sees that something in it changed. Guards against the "no diff at
    // all" symptom for the partial-edit case.
    it("washes a hard-wrapped numbered item when only its second line changed", () => {
        const root = render(
            [
                "1. First item stays exactly the same across the edit here.",
                "2. Does this work make breaking API changes to the v3 or v4 OData",
                "   API, the Planner Graph API, or both?",
                "3. Third item stays exactly the same too.",
            ].join("\n"),
        );

        // Only the continuation line (3) changed; the item spans lines 2–3.
        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "   API only, or neither of them?",
            },
        ]);

        expect(res.decorated).toBe(1);
        expect(res.inlined).toBe(0);

        const item2 = root.querySelector<HTMLElement>('li[data-source-line="2"]')!;

        expect(item2.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(item2.classList.contains(DIFF_INLINE_CLASS)).toBe(false);
    });

    // A LOOSE list item (its list has blank lines, so each item's prose is
    // wrapped in a <p>) must inline-diff INSIDE that <p>. Regression: the diff
    // used to run against the whole <li>, whose flattened text includes the
    // whitespace text nodes sitting between the <li> and its <p>; those got
    // word-diffed and wrapped in empty <ins>/<del> marks that rendered as blank
    // lines above and below the item. The fix targets the inner <p>, so no marks
    // escape to the item level and the item's legitimate spacing is untouched.
    it("word-diffs an item of a loose list without stray blank-line marks", () => {
        const root = render(
            [
                "1. First item stays exactly the same across this edit here.",
                "",
                "2. Does this work make breaking API changes? To the v3 or v4 OData API?",
                "",
                "3. Third item stays exactly the same too across the edit.",
            ].join("\n"),
        );

        const li2 = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;

        // Precondition: the item really is loose (prose wrapped in a <p>).
        expect(li2.firstElementChild?.tagName).toBe("P");

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "2. Does this work make breaking API changes? To private 1p APIs?",
            },
        ]);

        expect(res.inlined).toBe(1);
        expect(li2.classList.contains(DIFF_INLINE_CLASS)).toBe(true);

        // The marks land INSIDE the <p>…
        const p = li2.querySelector<HTMLElement>(":scope > p")!;
        expect(p.querySelector(`.${WORD_ADDED_CLASS}`)).not.toBeNull();
        expect(p.querySelector(`.${WORD_REMOVED_CLASS}`)).not.toBeNull();
        // …and NONE escape to the item level as the blank-line-inducing marks.
        expect(li2.querySelectorAll(":scope > ins, :scope > del")).toHaveLength(0);
        expect(words(li2).added).toContain("v4");
        expect(words(li2).removed).toContain("private");
    });

    // An ordered list numbers itself, so an item whose only change is its
    // number (because an earlier item was removed) reads exactly the same and
    // is not shown as edited.
    const renumbered = {
        original: ["1. Clone the repo.", "2. Install tools.", "3. Build it."].join("\n"),
        current: ["1. Install tools.", "2. Build it."].join("\n"),
        range: {
            startLine: 2,
            endLine: 2,
            kind: "modified" as const,
            originalText: "3. Build it.",
            originalStartLine: 3,
            originalEndLine: 3,
        },
    };

    it("does not mark a renumbered item as edited", () => {
        const root = render(renumbered.current);
        const res = decorate(root, [renumbered.range], renumbered.original);
        expect(res.decorated).toBe(0);
        expect(root.querySelector(`.${DIFF_BLOCK_CLASS}`)).toBeNull();
    });

    it("still reads a renumbered item as unchanged when it carries a comment highlight", () => {
        const root = render(renumbered.current);
        const item = root.querySelector('li[data-source-line="2"]')!;
        const highlight = document.createElement("span");
        highlight.className = "emr-highlight";
        highlight.append(...Array.from(item.childNodes));
        item.append(highlight);
        const res = decorate(root, [renumbered.range], renumbered.original);
        expect(res.decorated).toBe(0);
    });

    // The first item's number sets the numbering the whole list shows, so a
    // changed start is a visible change even when the item text is the same.
    it("still marks a first item whose number changes the list's start", () => {
        const original = ["1. Install", "2. Configure"].join("\n");
        const root = render(["3. Install", "4. Configure"].join("\n"));

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalText: "1. Install",
                    originalStartLine: 1,
                    originalEndLine: 1,
                },
            ],
            original,
        );

        expect(res.decorated).toBe(1);
        const item = root.querySelector<HTMLElement>("li")!;
        expectPreciseAmber(item, "List numbering changed from 1 to 3");
        expect(item.classList.contains("emr-diff-list-marker-change")).toBe(true);
    });

    it("does not mark a renumbered deeply nested item as edited", () => {
        const original = [
            "1. Parent",
            "   1. Child",
            "      1. Drop this step.",
            "      2. Middle step.",
            "      3. Keep this step.",
        ].join("\n");

        const current = [
            "1. Parent",
            "   1. Child",
            "      1. Middle step.",
            "      2. Keep this step.",
        ].join("\n");

        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 4,
                    endLine: 4,
                    kind: "modified",
                    originalText: "      3. Keep this step.",
                    originalStartLine: 5,
                    originalEndLine: 5,
                },
            ],
            original,
        );

        expect(res.decorated).toBe(0);
    });

    it("word-diffs a deeply nested item against its item text, not a code block", () => {
        const original = ["1. Parent", "   1. Child", "      1. Run the old step."].join("\n");

        const current = ["1. Parent", "   1. Child", "      1. Run the new step."].join("\n");

        const root = render(current);
        decorate(
            root,
            [
                {
                    startLine: 3,
                    endLine: 3,
                    kind: "modified",
                    originalText: "      1. Run the old step.",
                    originalStartLine: 3,
                    originalEndLine: 3,
                },
            ],
            original,
        );

        const item = root.querySelector<HTMLElement>('li[data-source-line="3"]')!;

        expect(words(item)).toEqual({ added: "new", removed: "old" });
    });

    it("still marks an item whose number is unchanged but checkbox flipped", () => {
        const original = "1. [ ] Ship it";
        const current = "1. [x] Ship it";
        const root = render(current);

        const res = decorate(
            root,
            [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalText: original,
                    originalStartLine: 1,
                    originalEndLine: 1,
                },
            ],
            original,
        );

        expect(res.decorated).toBe(1);
    });
});

describe("task lists", () => {
    it("marks a checklist item as edited without disturbing the others when its previous text is unknown", () => {
        const root = render(["- [ ] write tests", "- [ ] ship it", "- [ ] celebrate"].join("\n"));

        const res = decorate(root, [{ startLine: 1, endLine: 1, kind: "modified" }]);

        expect(res.decorated).toBe(1);
        const items = Array.from(root.querySelectorAll("li"));
        expect(items.map((li) => li.classList.contains(DIFF_BLOCK_CLASS))).toEqual([
            true,
            false,
            false,
        ]);
        expect(items[0]!.querySelector('input[type="checkbox"]')).not.toBeNull();
    });

    it("marks only the checkbox when checklist state changes", () => {
        const root = render("- [x] Run tests");

        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "- [ ] Run tests",
            },
        ]);

        expect(res.inlined).toBe(1);
        const item = root.querySelector("li")!;
        expect(item.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(item.classList.contains(DIFF_INLINE_CLASS)).toBe(true);
        expect(item.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();

        const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

        expect(checkbox.classList.contains("emr-diff-task-state-change")).toBe(true);
        expect(checkbox.hasAttribute("title")).toBe(false);
        expectPreciseAmber(
            checkbox.closest<HTMLElement>(".emr-diff-task-tooltip-anchor")!,
            "Checklist item changed from unchecked to checked",
        );
        decorate(root, []);
        expect(checkbox.classList.contains("emr-diff-task-state-change")).toBe(false);
        expect(checkbox.hasAttribute("title")).toBe(false);
        expect(item.querySelector(".emr-diff-task-tooltip-anchor")).toBeNull();
    });

    it("describes a checked checklist item becoming unchecked", () => {
        const root = render("- [ ] Confirm release");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "- [x] Confirm release",
            },
        ]);

        const anchor = root.querySelector<HTMLElement>(".emr-diff-task-tooltip-anchor");

        expect(anchor).not.toBeNull();
        expectPreciseAmber(anchor!, "Checklist item changed from checked to unchecked");
    });

    it("combines marker and checklist-state changes into one item callout", () => {
        const root = render("- [x] Confirm release");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "1. [ ] Confirm release",
            },
        ]);
        const item = root.querySelector<HTMLElement>("li")!;
        expectPreciseAmber(
            item,
            "List item changed: marker numbered to bulleted; checklist item unchecked to checked",
        );
        expect(item.querySelector(".emr-diff-task-tooltip-anchor")).toBeNull();
        expect(
            item
                .querySelector('input[type="checkbox"]')
                ?.classList.contains("emr-diff-task-state-change"),
        ).toBe(true);
    });

    it("offers the previous item in a Before disclosure for a rewritten list item", () => {
        const root = render("- Escalate immediately to the regional owner.");
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "- Archive the weekly report after documentation review.",
            },
        ]);
        const item = root.querySelector<HTMLElement>("li")!;

        const trigger = item.querySelector<HTMLButtonElement>(
            ":scope > .emr-diff-before-control .emr-diff-before-trigger",
        )!;

        trigger.click();
        expect(trigger.textContent).toBe("Hide");
        expect(trigger.getAttribute("aria-label")).toBe("Hide previous version");
        expect(item.querySelector(".emr-diff-before-content")?.textContent).toContain(
            "Archive the weekly report",
        );
        trigger.click();
        expect(trigger.textContent).toBe("Before");
        expect(trigger.getAttribute("aria-label")).toBe("Show previous version");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
});
