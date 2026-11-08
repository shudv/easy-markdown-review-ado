import { describe, it, expect, beforeEach } from "vitest";
import {
    applyInlineWordDiff,
    WORD_ADDED_CLASS,
    WORD_REMOVED_CLASS,
    WORD_REMOVED_TIGHT_CLASS,
    WORD_LINE_BREAK_CLASS,
} from "../src/markdown/wordDiffDom";
import { diffWords } from "../src/markdown/wordDiff";

function block(html: string): HTMLElement {
    const p = document.createElement("p");
    p.innerHTML = html;
    document.body.appendChild(p);

    return p;
}

/** Text of the added / removed marks, in document order. */
function marks(el: HTMLElement) {
    return {
        added: Array.from(el.querySelectorAll(`.${WORD_ADDED_CLASS}`), (n) => n.textContent),
        removed: Array.from(el.querySelectorAll(`.${WORD_REMOVED_CLASS}`), (n) => n.textContent),
    };
}

/** Text with removed marks stripped = the current (modified) reading. */
function modifiedText(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`.${WORD_REMOVED_CLASS}`).forEach((n) => n.remove());

    return clone.textContent;
}

/** Renders `currentHtml`, applies the word diff from `original`, returns the block. */
function diffBlock(currentHtml: string, original: string) {
    const el = block(currentHtml);
    const current = el.textContent;
    const result = applyInlineWordDiff(el, diffWords(original, current));

    return { el, current, result };
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("applyInlineWordDiff", () => {
    it.each([
        {
            name: "an added word",
            html: "hello world",
            original: "hello",
            added: [" world"],
            removed: [],
        },
        {
            name: "a removed word",
            html: "hello",
            original: "hello world",
            added: [],
            removed: [" world"],
        },
        {
            name: "a replaced word",
            html: "The quick red fox",
            original: "The quick brown fox",
            added: ["red"],
            removed: ["brown"],
        },
        {
            name: "several separate edits",
            html: "alpha two gamma four",
            original: "alpha 2 gamma 4",
            added: ["two", "four"],
            removed: ["2", "4"],
        },
        {
            name: "an edit in a word that starts a new element",
            html: "one <em>three</em> end",
            original: "one two end",
            added: ["three"],
            removed: ["two"],
        },
    ])("marks $name and keeps the current text readable", ({ html, original, added, removed }) => {
        const { el, current, result } = diffBlock(html, original);

        expect(marks(el)).toEqual({ added, removed });
        expect(modifiedText(el)).toBe(current);
        expect(result).toEqual({ added: added.length, removed: removed.length });
    });

    it("shows a replaced word as removed before added", () => {
        const { el } = diffBlock("The quick red fox", "The quick brown fox");

        const removed = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
        const added = el.querySelector(`.${WORD_ADDED_CLASS}`)!;
        expect(
            removed.compareDocumentPosition(added) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("puts removed trailing words at the very end of the block", () => {
        const { el } = diffBlock("keep", "keep gone");

        expect(el.lastElementChild?.classList.contains(WORD_REMOVED_CLASS)).toBe(true);
        expect(el.lastElementChild?.textContent).toBe(" gone");
        expect(modifiedText(el)).toBe("keep");
    });

    it("keeps inline formatting on unchanged words", () => {
        const { el } = diffBlock("This <strong>important</strong> note", "This important");

        expect(el.querySelector("strong")?.textContent).toBe("important");
        expect(marks(el).added).toEqual([" note"]);
    });

    it("keeps an existing comment highlight on unchanged words", () => {
        const { el } = diffBlock(
            'Keep <span class="emr-highlight" data-thread-id="t1">this</span> words',
            "Keep this word",
        );

        const anchor = el.querySelector(".emr-highlight");
        expect(anchor?.getAttribute("data-thread-id")).toBe("t1");
        expect(anchor?.textContent).toBe("this");
    });

    it("marks nothing when the text is unchanged", () => {
        const { el, result } = diffBlock("unchanged text", "unchanged text");

        expect(result).toEqual({ added: 0, removed: 0 });
        expect(marks(el)).toEqual({ added: [], removed: [] });
    });

    it("leaves the block untouched when the diff describes different text", () => {
        const el = block("actual text here");
        const before = el.innerHTML;

        const result = applyInlineWordDiff(el, diffWords("something", "something else"));

        expect(result).toBeNull();
        expect(el.innerHTML).toBe(before);
    });

    // Another DOM edit (e.g. splitting a text node) can leave an empty text
    // node behind; it must not shift where the marks land.
    it("places marks correctly in a block holding an empty text node", () => {
        const el = block("hello world");
        el.appendChild(document.createTextNode(""));

        applyInlineWordDiff(el, diffWords("hello", "hello world"));

        expect(marks(el).added).toEqual([" world"]);
        expect(modifiedText(el)).toBe("hello world");
    });
});

describe("line-break marks", () => {
    it("flags an added blank line so code can show it, keeping the text intact", () => {
        const { el } = diffBlock("npm ci\n\nnpm test", "npm ci\nnpm test");

        const mark = el.querySelector(`.${WORD_ADDED_CLASS}`)!;
        expect(mark.textContent).toBe("\n");
        expect(mark.classList.contains(WORD_LINE_BREAK_CLASS)).toBe(true);
        expect(modifiedText(el)).toBe("npm ci\n\nnpm test");
    });

    it("flags a removed blank line", () => {
        const { el } = diffBlock("a\nb", "a\n\nb");

        expect(
            el.querySelector(`.${WORD_REMOVED_CLASS}`)!.classList.contains(WORD_LINE_BREAK_CLASS),
        ).toBe(true);
    });

    it("does not flag added lines that carry visible text or indentation", () => {
        const { el } = diffBlock("const a = 1;\nconst b = 2;\n  x", "const a = 1;\nx");

        expect(el.querySelector(`.${WORD_LINE_BREAK_CLASS}`)).toBeNull();
    });

    it.each([
        [" \n\t", true],
        ["\r\n", true],
        ["\t\r", true],
        ["\n x", false],
        ["  ", false],
    ])("flags an added %j run as a line break: %s", (value, flagged) => {
        // textContent, not innerHTML: HTML parsing would normalize `\r` to `\n`.
        const el = block("");
        el.textContent = `a${value}b`;
        applyInlineWordDiff(el, [
            { kind: "equal", value: "a" },
            { kind: "added", value },
            { kind: "equal", value: "b" },
        ]);
        const mark = el.querySelector(`.${WORD_ADDED_CLASS}`)!;
        expect(mark.textContent).toBe(value);
        expect(mark.classList.contains(WORD_LINE_BREAK_CLASS)).toBe(flagged);
    });
});

// A strikethrough sits at x-height centre, so on a glyph with no ink there —
// a lone comma, period, dash, or a merged space — it floats as a detached dash.
// Those removals get the "tight" modifier so the styles can drop the strike;
// words and digits (which the strike crosses cleanly) keep it.
describe("removals without ink at strike height", () => {
    it.each([
        {
            name: "a removed comma",
            html: "Monday Tuesday",
            original: "Monday, Tuesday",
            tight: true,
        },
        {
            name: "a removed dash and its space",
            html: "fast and simple",
            original: "fast — and simple",
            tight: true,
        },
        { name: "a removed trailing period", html: "done", original: "done.", tight: true },
        {
            name: "a removed word",
            html: "the brown fox",
            original: "the quick brown fox",
            tight: false,
        },
        {
            name: "a removed word with its comma",
            html: "the brown fox",
            original: "the quick, brown fox",
            tight: false,
        },
        {
            name: "a removed number",
            html: "scale to nodes",
            original: "scale to 100 nodes",
            tight: false,
        },
    ])("$name drops the strikethrough: $tight", ({ html, original, tight }) => {
        const { el } = diffBlock(html, original);

        const removed = el.querySelector(`.${WORD_REMOVED_CLASS}`)!;
        expect(removed.classList.contains(WORD_REMOVED_TIGHT_CLASS)).toBe(tight);
    });
});
