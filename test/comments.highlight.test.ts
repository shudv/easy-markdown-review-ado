// jsdom-only DOM unit tests for `wrapRangeWithHighlight` — exercises both
// the single-text-node fast path and the multi-fragment walk.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { wrapRangeWithHighlight } from "../src/comments/highlight";

describe("wrapRangeWithHighlight", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    function makeRange(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
        const r = document.createRange();
        r.setStart(startNode, startOffset);
        r.setEnd(endNode, endOffset);

        return r;
    }

    it("wraps a range entirely inside a single text node", () => {
        const p = document.createElement("p");
        p.textContent = "Hello, world!";
        document.body.appendChild(p);
        const text = p.firstChild as Text;

        const range = makeRange(text, 7, text, 12);

        const spans = wrapRangeWithHighlight(range, {
            className: "hl",
            threadId: "t-1",
        });

        expect(spans).toHaveLength(1);
        expect(spans[0]!.textContent).toBe("world");
        expect(spans[0]!.dataset.threadId).toBe("t-1");
        expect(spans[0]!.className).toBe("hl");
        expect(p.textContent).toBe("Hello, world!");
    });

    it.each([
        {
            name: "paints the thread's own color when it has one",
            background: "rgb(255, 200, 100)",
            expected: "rgb(255, 200, 100)",
        },
        {
            name: "leaves the color to the stylesheet when the thread has none",
            background: undefined,
            expected: "",
        },
    ])("$name", ({ background, expected }) => {
        const p = document.createElement("p");
        p.textContent = "color me";
        document.body.appendChild(p);
        const text = p.firstChild as Text;

        const [span] = wrapRangeWithHighlight(makeRange(text, 0, text, 5), {
            className: "hl",
            threadId: "t-2",
            background,
        });

        expect(span!.style.backgroundColor).toBe(expected);
    });

    it("does not highlight a selection of only whitespace inside a paragraph", () => {
        const p = document.createElement("p");
        p.textContent = "a     b";
        document.body.appendChild(p);
        const text = p.firstChild as Text;

        const spans = wrapRangeWithHighlight(makeRange(text, 1, text, 6), {
            className: "hl",
            threadId: "t-ws",
        });

        expect(spans).toEqual([]);
        expect(p.querySelector("span.hl")).toBeNull();
    });

    it("wraps each text fragment when the range crosses element boundaries", () => {
        const p = document.createElement("p");
        // <strong>bold</strong> tail
        const strong = document.createElement("strong");
        strong.textContent = "bold";
        p.appendChild(strong);
        p.appendChild(document.createTextNode(" tail"));
        document.body.appendChild(p);

        const range = makeRange(strong.firstChild as Text, 0, p.lastChild as Text, 5);

        const spans = wrapRangeWithHighlight(range, {
            className: "hl",
            threadId: "t-3",
        });

        expect(spans.map((s) => s.textContent)).toEqual(["bold", " tail"]);
        expect(spans.map((s) => s.dataset.threadId)).toEqual(["t-3", "t-3"]);
        expect(p.textContent).toBe("bold tail");
    });

    it("does not highlight the trailing space a double-click picks up after a formatted word", () => {
        const p = document.createElement("p");
        p.innerHTML = "Ship <strong>it</strong> now";
        document.body.appendChild(p);
        const word = p.querySelector("strong")!.firstChild as Text;

        // Double-clicking "it" also selects the space that starts " now".
        const spans = wrapRangeWithHighlight(makeRange(word, 0, p.lastChild as Text, 1), {
            className: "hl",
            threadId: "t-dbl",
        });

        expect(spans.map((s) => s.textContent)).toEqual(["it"]);
    });

    it("highlights nothing for a collapsed (empty) selection", () => {
        const p = document.createElement("p");
        p.textContent = "abc";
        document.body.appendChild(p);
        const text = p.firstChild as Text;

        const range = makeRange(text, 1, text, 1);

        const spans = wrapRangeWithHighlight(range, {
            className: "hl",
            threadId: "t-4",
        });

        expect(spans).toEqual([]);
    });

    it("does not duplicate or drop characters at fragment boundaries", () => {
        const p = document.createElement("p");
        // mixed: "alpha " + <em>beta</em> + " gamma"
        p.appendChild(document.createTextNode("alpha "));
        const em = document.createElement("em");
        em.textContent = "beta";
        p.appendChild(em);
        p.appendChild(document.createTextNode(" gamma"));
        document.body.appendChild(p);

        const range = makeRange(
            p.firstChild as Text,
            2, // "pha "
            p.lastChild as Text,
            3, // " ga"
        );

        const spans = wrapRangeWithHighlight(range, { className: "hl", threadId: "t-5" });

        expect(spans.map((s) => s.textContent)).toEqual(["pha ", "beta", " ga"]);
        expect(p.textContent).toBe("alpha beta gamma");
    });

    it("ignores sibling text nodes that fall entirely outside the range", () => {
        const p = document.createElement("p");
        // Three text-bearing spans; only the middle one is inside the range.
        p.innerHTML = "<span>A</span><span>B</span><span>C</span>";
        document.body.appendChild(p);
        const spanB = p.children[1] as HTMLElement;
        const spanC = p.children[2] as HTMLElement;

        const range = document.createRange();
        range.setStart(spanB.firstChild as Text, 0);
        range.setEnd(spanC, 0); // ends just before C's text — A and C are excluded

        const spans = wrapRangeWithHighlight(range, {
            className: "hl",
            threadId: "t-6",
        });

        expect(spans).toHaveLength(1);
        expect(spans[0]!.textContent).toBe("B");
        // The excluded neighbours keep their original (unwrapped) text nodes.
        expect(p.children[0]!.querySelector("span.hl")).toBeNull();
        expect(p.children[2]!.querySelector("span.hl")).toBeNull();
        expect(p.textContent).toBe("ABC");
    });
});
