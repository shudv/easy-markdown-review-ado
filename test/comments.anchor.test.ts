// Tests for the TextQuoteAnchor resolver. The anchor capture step needs a
// real DOM Selection — jsdom doesn't ship a full Selection API, so the
// capture path is covered by a small manual Selection setup. Resolution
// is fully DOM-only and works against any rendered article element.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    captureAnchorFromSelection,
    isWithinGeneratedContent,
    relocateAnchor,
    resolveAnchor,
    withSourceLocation,
} from "../src/comments/anchor";

function makeArticle(html: string): HTMLElement {
    const root = document.createElement("article");
    root.innerHTML = html;
    document.body.appendChild(root);

    return root;
}

afterEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
});

describe("resolveAnchor", () => {
    it("returns null when the article has no text nodes", () => {
        const root = makeArticle("");

        const range = resolveAnchor(root, {
            exact: "hello",
            prefix: "",
            suffix: "",
        });

        expect(range).toBeNull();
    });

    it("returns null when the anchor's exact text is empty (file-level)", () => {
        const root = makeArticle("<p>Body</p>");
        expect(resolveAnchor(root, { exact: "", prefix: "", suffix: "" })).toBeNull();
    });

    it("locates a quote whose remembered context is unchanged", () => {
        const root = makeArticle("<p>Hello world from the team</p>");

        const range = resolveAnchor(root, {
            exact: "world",
            prefix: "Hello ",
            suffix: " from",
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("world");
    });

    it("picks the occurrence of repeated text whose remembered context surrounds it", () => {
        const root = makeArticle("<p>Once apple twice apple thrice apple</p>");

        const range = resolveAnchor(root, {
            exact: "apple",
            prefix: "twice ",
            suffix: " thrice",
        });

        expect(range).not.toBeNull();
        // The "twice apple thrice" instance is the middle one.
        expect(range!.startOffset).toBe("Once apple twice ".length);
    });

    it("lands on the first occurrence when no context tells repeated text apart", () => {
        const root = makeArticle("<p>apple then apple</p>");

        const range = resolveAnchor(root, {
            exact: "apple",
            prefix: "",
            suffix: "",
        });

        expect(range).not.toBeNull();
        expect(range!.startOffset).toBe(0);
    });

    it("still resolves the quote when its surrounding text was rewritten", () => {
        const root = makeArticle("<p>Just plain text</p>");

        const range = resolveAnchor(root, {
            exact: "plain",
            prefix: "MISSING_CONTEXT_ABC",
            suffix: "ALSO_MISSING_XYZ",
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("plain");
    });

    // Production: the document was edited after the comment was left, so the
    // remembered context no longer appears verbatim. The anchor should follow the
    // occurrence whose surroundings still match best, from either side.
    it.each([
        {
            name: "context on both sides partly survives",
            prefix: "Then they fix ",
            suffix: " soon, maybe.",
        },
        {
            name: "only the text before it partly survives",
            prefix: "Then they fix ",
            suffix: "!",
        },
        {
            name: "only the text after it partly survives",
            prefix: "Earlier:",
            suffix: " soon, maybe.",
        },
    ])(
        "follows repeated quoted text to the occurrence whose context best matches when $name",
        ({ prefix, suffix }) => {
            const root = makeArticle(
                '<p><span id="first">We fix the bug now.</span> ' +
                    '<span id="second">They fix the bug soon.</span> ' +
                    '<span id="third">You fix the bug later.</span></p>',
            );

            const range = resolveAnchor(root, { exact: "the bug", prefix, suffix });

            expect(range?.startContainer.parentElement?.id).toBe("second");
        },
    );

    it("returns null when the exact text simply isn't present", () => {
        const root = makeArticle("<p>One two three</p>");
        expect(resolveAnchor(root, { exact: "four", prefix: "", suffix: "" })).toBeNull();
    });

    it("walks past nested element boundaries when matching", () => {
        const root = makeArticle("<p>Hello <em>brave</em> new <strong>world</strong></p>");

        const range = resolveAnchor(root, {
            exact: "brave new world",
            prefix: "Hello ",
            suffix: "",
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("brave new world");
    });
});

describe("resolveAnchor (line-based, native ADO threads)", () => {
    it("resolves a single source line to the matching block", () => {
        const root = makeArticle(
            '<p data-source-line="1" data-source-end-line="1">First line</p>' +
                '<p data-source-line="2" data-source-end-line="2">Second line</p>' +
                '<p data-source-line="3" data-source-end-line="3">Third line</p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 2,
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("Second line");
    });

    it("spans the full text of a block that holds several text nodes", () => {
        // Inline markup (<strong>) splits the paragraph into several text nodes;
        // the resolved range must still cover "Hello bold world" end to end.
        const root = makeArticle(
            '<p data-source-line="1" data-source-end-line="1">Hello <strong>bold</strong> world</p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 1,
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("Hello bold world");
    });

    it("spans a multi-line range across blocks", () => {
        const root = makeArticle(
            '<p data-source-line="1" data-source-end-line="1">First line</p>' +
                '<p data-source-line="2" data-source-end-line="2">Second line</p>' +
                '<p data-source-line="3" data-source-end-line="3">Third line</p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 2,
            endLine: 3,
        });

        expect(range).not.toBeNull();
        // Range should start at "Second" and end at "Third line".
        expect(range!.toString()).toContain("Second line");
        expect(range!.toString()).toContain("Third line");
    });

    it("prefers the most-specific block overlapping the line", () => {
        const root = makeArticle(
            '<blockquote data-source-line="1" data-source-end-line="3">' +
                '<p data-source-line="2" data-source-end-line="2">Inner quoted</p>' +
                "</blockquote>",
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 2,
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("Inner quoted");
    });

    it("returns null when there are no anchorable blocks at all", () => {
        const root = makeArticle("<span>inline only, no block</span>");
        expect(resolveAnchor(root, { exact: "", prefix: "", suffix: "", line: 5 })).toBeNull();
    });

    it("falls back to the last block when no block spans the line", () => {
        const root = makeArticle('<p data-source-line="1">Only line</p>');

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 99,
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("Only line");
    });

    it("anchors to the first block beginning at or after an unspanned line", () => {
        // Blocks cover lines 2 and 10 only; line 5 falls in the gap, so the
        // anchor should land on the next block that starts at/after it (line 10),
        // not the last block in the document.
        const root = makeArticle(
            '<p data-source-line="2" data-source-end-line="2">Early</p>' +
                '<p data-source-line="10" data-source-end-line="10">Later</p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 5,
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("Later");
    });

    it("selects the block element itself when it has no text (image-only)", () => {
        const root = makeArticle(
            '<p data-source-line="1" data-source-end-line="1"><img src="x"></p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 1,
        });

        expect(range).not.toBeNull();
        expect(range!.toString()).toBe("");
        // The fallback selects the whole block so the caller can still measure it.
        expect(range!.cloneContents().querySelector("img")).not.toBeNull();
    });

    it("spans both blocks when the end block has no text", () => {
        const root = makeArticle(
            '<p data-source-line="1" data-source-end-line="1">Start</p>' +
                '<p data-source-line="2" data-source-end-line="2"><img src="x"></p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 1,
            endLine: 2,
        });

        expect(range).not.toBeNull();
        const frag = range!.cloneContents();
        expect(frag.querySelectorAll("p")).toHaveLength(2);
        expect(frag.querySelector("img")).not.toBeNull();
    });

    it("spans both blocks when the start block has no text", () => {
        const root = makeArticle(
            '<p data-source-line="1" data-source-end-line="1"><img src="x"></p>' +
                '<p data-source-line="2" data-source-end-line="2">End</p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 1,
            endLine: 2,
        });

        expect(range).not.toBeNull();
        const frag = range!.cloneContents();
        expect(frag.querySelectorAll("p")).toHaveLength(2);
        expect(frag.querySelector("img")).not.toBeNull();
    });
});

describe("isWithinGeneratedContent", () => {
    it("is true for the diagram container element itself", () => {
        const root = makeArticle('<div class="emr-mermaid"><svg><text>Alpha</text></svg></div>');

        // A selection boundary can sit on the container element itself rather
        // than on text inside it.
        expect(isWithinGeneratedContent(root.querySelector(".emr-mermaid")!)).toBe(true);
    });

    it("is true for a text node inside a diagram's source fallback", () => {
        const root = makeArticle('<div class="emr-mermaid"><pre>graph TD; A--&gt;B</pre></div>');

        expect(isWithinGeneratedContent(root.querySelector("pre")!.firstChild!)).toBe(true);
    });

    it("is true for generated text inside a rendered equation", () => {
        const root = makeArticle('<span class="katex"><span class="katex-html">x²</span></span>');

        expect(isWithinGeneratedContent(root.querySelector(".katex-html")!.firstChild!)).toBe(true);
    });

    it("is true for a text node inside an equation's source fallback", () => {
        // KaTeX has not hydrated (or failed to load), so the raw TeX is selectable.
        // That text disappears once hydration succeeds, so it must not be anchored.
        const root = makeArticle(
            '<div class="emr-math"><pre class="emr-math-fallback"><code>x^2</code></pre></div>',
        );

        expect(isWithinGeneratedContent(root.querySelector("code")!.firstChild!)).toBe(true);
    });

    it("is false for a text node outside any diagram", () => {
        const root = makeArticle("<p>plain prose</p>");
        expect(isWithinGeneratedContent(root.querySelector("p")!.firstChild!)).toBe(false);
    });

    it("is false for a detached node with no parent element", () => {
        expect(isWithinGeneratedContent(document.createTextNode("orphan"))).toBe(false);
    });

    it("is true for a generated wiki table of contents", () => {
        const root = makeArticle(
            '<nav class="emr-wiki-macro emr-wiki-toc"><ul><li><a href="#goals">Goals</a></li></ul></nav>',
        );

        expect(isWithinGeneratedContent(root.querySelector("a")!.firstChild!)).toBe(true);
    });
});

// captureAnchorFromSelection — jsdom Selection support is limited, but
// `setBaseAndExtent` works for ranges within a single text node, which is
// enough to cover the happy paths.
describe("captureAnchorFromSelection", () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = makeArticle("<p>The quick brown fox jumps over the lazy dog</p>");
    });

    it("returns null when there's no selection", () => {
        window.getSelection()?.removeAllRanges();
        expect(captureAnchorFromSelection(root)).toBeNull();
    });

    it("returns null when the selection is collapsed", () => {
        const text = root.querySelector("p")!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(text, 4);
        range.setEnd(text, 4);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        expect(captureAnchorFromSelection(root)).toBeNull();
    });

    it("returns null when the selection lives outside the article", () => {
        const outside = document.createElement("p");
        outside.textContent = "external";
        document.body.appendChild(outside);
        const text = outside.firstChild! as Text;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 5);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        expect(captureAnchorFromSelection(root)).toBeNull();
    });

    it("returns null when the selection is inside a Mermaid diagram", () => {
        const mermaidRoot = makeArticle(
            '<p>before</p><div class="emr-mermaid"><svg><text>Alpha</text></svg></div>',
        );

        const label = mermaidRoot.querySelector("text")!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(label, 0);
        range.setEnd(label, 5);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        expect(captureAnchorFromSelection(mermaidRoot)).toBeNull();
    });

    it("returns null when the selection is inside a rendered equation", () => {
        const mathRoot = makeArticle(
            '<p>before</p><div class="emr-math"><span class="katex">x²</span></div>',
        );

        const glyphs = mathRoot.querySelector(".katex")!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(glyphs, 0);
        range.setEnd(glyphs, 2);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        expect(captureAnchorFromSelection(mathRoot)).toBeNull();
    });

    it("captures the selected text along with the text around it as context", () => {
        const text = root.querySelector("p")!.firstChild! as Text;
        // Select "quick brown" → offsets 4..15
        const range = document.createRange();
        range.setStart(text, 4);
        range.setEnd(text, 15);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(root);
        expect(anchor).not.toBeNull();
        expect(anchor!.exact).toBe("quick brown");
        expect(anchor!.prefix).toBe("The ");
        expect(anchor!.suffix).toBe(" fox jumps over the lazy dog");
    });

    it("trims a trailing space (double-click) so only the word is anchored", () => {
        // Chromium/Edge extend a double-click word selection to include the
        // trailing space; the anchor should still be just the word, with the space
        // preserved as suffix context so it still resolves verbatim.
        const text = root.querySelector("p")!.firstChild! as Text;
        // "quick " → offsets 4..10 (the trailing space before "brown").
        const range = document.createRange();
        range.setStart(text, 4);
        range.setEnd(text, 10);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(root)!;
        expect(anchor.exact).toBe("quick");
        expect(anchor.prefix).toBe("The ");
        expect(anchor.suffix).toBe(" brown fox jumps over the lazy dog");
    });

    it("caps the remembered context at 80 characters on each side", () => {
        // Enough context to re-find the quote later without storing whole
        // paragraphs alongside every comment.
        document.body.innerHTML = "";
        const before = "a".repeat(100);
        const after = "b".repeat(100);
        const r = makeArticle(`<p>${before}TARGET${after}</p>`);
        const text = r.querySelector("p")!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(text, before.length);
        range.setEnd(text, before.length + "TARGET".length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(r);
        expect(anchor).not.toBeNull();
        expect(anchor!.exact).toBe("TARGET");
        expect(anchor!.prefix).toBe("a".repeat(80));
        expect(anchor!.suffix).toBe("b".repeat(80));
    });

    it("returns null when the selection is whitespace-only", () => {
        document.body.innerHTML = "";
        const r = makeArticle("<p>hello   world</p>");
        const text = r.querySelector("p")!.firstChild! as Text;
        const range = document.createRange();
        // "   " between the two words → offsets 5..8
        range.setStart(text, 5);
        range.setEnd(text, 8);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        expect(captureAnchorFromSelection(r)).toBeNull();
    });

    it("captures a selection that starts on an element boundary", () => {
        const p = root.querySelector("p")!;
        const text = p.firstChild! as Text;
        const range = document.createRange();
        range.setStart(p, 0);
        range.setEnd(text, 9);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(root)!;
        expect(anchor.exact).toBe("The quick");
        expect(anchor.prefix).toBe("");
        expect(anchor.suffix).toBe(" brown fox jumps over the lazy dog");
    });

    it("captures a triple-click line selection ending at the next block boundary", () => {
        document.body.innerHTML = "";

        const r = makeArticle(
            '<p data-source-line="3">Reviewers comment on rendered prose.</p>' +
                '<p data-source-line="5">Next paragraph</p>',
        );

        const firstText = r.querySelectorAll("p")[0]!.firstChild! as Text;
        const nextParagraph = r.querySelectorAll("p")[1]!;
        const range = document.createRange();
        range.setStart(firstText, 0);
        // Chromium triple-click includes the block separator and represents the
        // end as child offset 0 on the next block element.
        range.setEnd(nextParagraph, 0);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(r)!;
        expect(anchor.exact).toBe("Reviewers comment on rendered prose.");
        expect(anchor.line).toBe(3);
        expect(anchor.endLine).toBe(3);
    });

    it("captures a selection ending at the end of an element", () => {
        const paragraph = root.querySelector("p")!;
        const text = paragraph.firstChild! as Text;
        const range = document.createRange();
        range.setStart(text, 4);
        range.setEnd(paragraph, paragraph.childNodes.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        expect(captureAnchorFromSelection(root)?.exact).toBe(
            "quick brown fox jumps over the lazy dog",
        );
    });

    it("maps a boundary inside an empty inline wrapper to following text", () => {
        document.body.innerHTML = "";
        const r = makeArticle("<p><span></span>Hello world</p>");
        const wrapper = r.querySelector("span")!;
        const text = r.querySelector("p")!.lastChild! as Text;
        const range = document.createRange();
        range.setStart(wrapper, 0);
        range.setEnd(text, 5);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        expect(captureAnchorFromSelection(r)?.exact).toBe("Hello");
    });

    it("maps a boundary after a non-text wrapper to following text", () => {
        document.body.innerHTML = "";
        const r = makeArticle("<p><span><img></span>Hello world</p>");
        const wrapper = r.querySelector("span")!;
        const text = r.querySelector("p")!.lastChild! as Text;
        const range = document.createRange();
        range.setStart(wrapper, wrapper.childNodes.length);
        range.setEnd(text, 5);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        expect(captureAnchorFromSelection(r)?.exact).toBe("Hello");
    });

    it("captures source line/endLine from the nearest data-source-line ancestor", () => {
        document.body.innerHTML = "";

        const r = makeArticle(
            '<p data-source-line="3" data-source-end-line="3">The quick brown fox</p>',
        );

        const text = r.querySelector("p")!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(text, 4); // "quick"
        range.setEnd(text, 9);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(r)!;
        expect(anchor.exact).toBe("quick");
        expect(anchor.line).toBe(3);
        expect(anchor.endLine).toBe(3);
    });

    it("spans line..endLine when the selection crosses blocks on different lines", () => {
        document.body.innerHTML = "";

        const r = makeArticle(
            '<p data-source-line="2" data-source-end-line="2">First para</p>' +
                '<p data-source-line="4" data-source-end-line="4">Second para</p>',
        );

        const first = r.querySelectorAll("p")[0]!.firstChild! as Text;
        const second = r.querySelectorAll("p")[1]!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(first, 6); // "para"
        range.setEnd(second, 6); // "Second"
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(r)!;
        expect(anchor.line).toBe(2);
        expect(anchor.endLine).toBe(4);
    });

    it("leaves line unset when no ancestor carries a data-source-line", () => {
        document.body.innerHTML = "";
        const r = makeArticle("<p>no source line here</p>");
        const text = r.querySelector("p")!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 2);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(r)!;
        expect(anchor.line).toBeUndefined();
        expect(anchor.endLine).toBeUndefined();
    });

    it("falls back endLine to startLine when the end boundary has no source line", () => {
        // Start boundary sits in a lined paragraph; the selection ends in a
        // sibling paragraph that carries NO data-source-line, so endLine defaults
        // to the start line rather than going undefined.
        document.body.innerHTML = "";

        const r = makeArticle(
            '<p data-source-line="5" data-source-end-line="5">Lined para</p>' +
                "<p>Unlined para</p>",
        );

        const first = r.querySelectorAll("p")[0]!.firstChild! as Text;
        const second = r.querySelectorAll("p")[1]!.firstChild! as Text;
        const range = document.createRange();
        range.setStart(first, 6); // "para"
        range.setEnd(second, 7); // "para"
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        const anchor = captureAnchorFromSelection(r)!;
        expect(anchor.line).toBe(5);
        expect(anchor.endLine).toBe(5);
    });
});

describe("withSourceLocation", () => {
    it("maps a table-header text quote to precise source line/columns", () => {
        const source =
            "| # | Mechanism | Scope |\n" +
            "|---|---|---|\n" +
            "| 1 | OData admin export* all tenants | Whole tenant |";

        const out = withSourceLocation(
            {
                exact: "Mechanism",
                prefix: "| # | ",
                suffix: " | Scope",
            },
            source,
        );

        expect(out.line).toBe(1);
        expect(out.endLine).toBe(1);
        expect(out.column).toBe(7);
        expect(out.endColumn).toBe(15);
    });

    it("maps a multi-line text quote to start/end line+column", () => {
        const source = "alpha\nbeta gamma\ndelta";

        const out = withSourceLocation(
            {
                exact: "beta gamma\ndel",
                prefix: "alpha\n",
                suffix: "ta",
            },
            source,
        );

        expect(out.line).toBe(2);
        expect(out.column).toBe(1);
        expect(out.endLine).toBe(3);
        expect(out.endColumn).toBe(3);
    });

    it("leaves the anchor unchanged when the text quote is not found", () => {
        const base = { exact: "missing", prefix: "", suffix: "" };
        expect(withSourceLocation(base, "hello world")).toEqual(base);
    });

    it("leaves a file-level (empty exact) anchor unchanged", () => {
        const base = { exact: "", prefix: "", suffix: "" };
        expect(withSourceLocation(base, "hello world")).toBe(base);
    });

    // "apple" is ambiguous on its own; only the line followed by " tart" matches
    // the context remembered when the comment was left.
    it.each([
        { name: "the later line", source: "apple pie\napple tart", line: 2 },
        { name: "the earlier line", source: "apple tart\napple pie", line: 1 },
    ])(
        "maps repeated text to $name when that is where its remembered context continues",
        ({ source, line }) => {
            const out = withSourceLocation(
                { exact: "apple", prefix: "X\n", suffix: " tart Y" },
                source,
            );

            expect(out).toMatchObject({ line, column: 1, endColumn: 5 });
        },
    );

    it("resolves a multi-line quote against a CRLF source (composite match)", () => {
        // DOM-captured quote text uses LF; the raw source uses CRLF. Matching must
        // normalize line endings yet map offsets back to the original source so the
        // computed line/column stay correct instead of falling back to line 1.
        const source = "alpha\r\nbeta gamma\r\ndelta\r\nomega";

        const out = withSourceLocation(
            {
                exact: "beta gamma\ndelta",
                prefix: "alpha\n",
                suffix: "\nomega",
            },
            source,
        );

        expect(out.line).toBe(2);
        expect(out.column).toBe(1);
        expect(out.endLine).toBe(3);
        expect(out.endColumn).toBe(5);
    });

    it("resolves a CRLF source by scored overlap when the context diverges", () => {
        // The remembered prefix doesn't appear verbatim, so the match relies on
        // scoring; it must still work when the source uses CRLF line endings.
        const source = "one\r\ntwo\r\nbeta gamma\r\ntwo";

        const out = withSourceLocation(
            { exact: "beta gamma", prefix: "X\n", suffix: "\ntwo" },
            source,
        );

        expect(out.line).toBe(3);
        expect(out.column).toBe(1);
        expect(out.endColumn).toBe(10);
    });

    it("resolves a bare-CR (old-Mac) source, mapping offsets back", () => {
        // DOM quote uses '\n'; source uses a lone '\r'. Normalization must still
        // locate the span and map offsets back to the original source.
        const source = "x a\rb y";

        const out = withSourceLocation({ exact: "a\nb", prefix: "x ", suffix: " y" }, source);

        expect(out.line).toBe(1);
        expect(out.column).toBe(3);
        expect(out.endColumn).toBe(5);
    });
});

describe("resolveAnchor: text quote vs. source line", () => {
    it("prefers the quoted text over the anchor's source line when both resolve", () => {
        const root = makeArticle(
            '<p data-source-line="1">alpha</p><p data-source-line="2">beta gamma</p>',
        );

        const range = resolveAnchor(root, {
            exact: "gamma",
            prefix: "beta ",
            suffix: "",
            line: 1,
        });

        expect(range?.toString()).toBe("gamma");
    });

    it("falls back to the anchor's source line when the quoted text was edited away", () => {
        const root = makeArticle(
            '<p data-source-line="1">alpha</p><p data-source-line="2">beta gamma</p>',
        );

        const range = resolveAnchor(root, {
            exact: "not-in-document",
            prefix: "",
            suffix: "",
            line: 2,
        });

        expect(range?.toString()).toBe("beta gamma");
    });

    it("orphans an anchor whose quote is gone and whose line is 0 (ADO lines are 1-based)", () => {
        const root = makeArticle('<p data-source-line="1">alpha</p>');

        expect(
            resolveAnchor(root, {
                exact: "missing",
                prefix: "",
                suffix: "",
                line: 0,
            }),
        ).toBeNull();
    });
});

describe("resolveAnchor across split text", () => {
    it("matches a quote across an empty text node (e.g. left behind by splitting text for highlights)", () => {
        const root = document.createElement("article");
        root.appendChild(document.createTextNode("alpha"));
        root.appendChild(document.createTextNode(""));
        root.appendChild(document.createTextNode("beta"));
        document.body.appendChild(root);

        const range = resolveAnchor(root, {
            exact: "alphabeta",
            prefix: "",
            suffix: "",
        });

        expect(range?.toString()).toBe("alphabeta");
    });
});

describe("relocateAnchor", () => {
    // The same document at two versions, as the renderer stamps it: an older
    // update had an extra paragraph, so the shared text sits two lines lower.
    const LATEST =
        '<h1 data-source-line="1">Guide</h1><p data-source-line="3">Leave comments on the <strong data-source-line="3">rendered</strong> text.</p>';

    it("re-locates a quote into another version and takes ITS source lines", () => {
        const fromOlder = {
            exact: "comments on the rendered",
            prefix: "Leave ",
            suffix: " text.",
            line: 5,
            endLine: 5,
        };

        expect(relocateAnchor(fromOlder, LATEST)).toEqual({
            exact: "comments on the rendered",
            prefix: "Leave ",
            suffix: " text.",
            line: 3,
            endLine: 3,
        });
    });

    it("returns null when the text no longer exists in that version", () => {
        expect(
            relocateAnchor({ exact: "a sentence removed later", prefix: "", suffix: "" }, LATEST),
        ).toBeNull();
    });

    it("returns null for a file-level anchor (no text to re-locate)", () => {
        expect(relocateAnchor({ exact: "", prefix: "", suffix: "" }, LATEST)).toBeNull();
    });

    it("keeps the quote without lines when the HTML carries no source lines", () => {
        // Strict: no `line` / `endLine` keys at all, not keys set to undefined.
        expect(
            relocateAnchor(
                { exact: "plain", prefix: "", suffix: "", line: 9 },
                "<p>plain text</p>",
            ),
        ).toStrictEqual({ exact: "plain", prefix: "", suffix: "" });
    });

    it("spans lines when the quote crosses blocks", () => {
        const html =
            '<p data-source-line="1">first block</p><p data-source-line="3">second block</p>';

        expect(
            relocateAnchor({ exact: "blocksecond", prefix: "", suffix: "" }, html),
        ).toMatchObject({ line: 1, endLine: 3 });
    });

    it("ends on the start line when the quote runs into unsourced content", () => {
        const html = '<p data-source-line="4">sourced block</p><div>generated tail</div>';

        expect(
            relocateAnchor({ exact: "blockgenerated", prefix: "", suffix: "" }, html),
        ).toMatchObject({ line: 4, endLine: 4 });
    });

    it("takes the start line from the quoted text, not the text before it", () => {
        // The quote starts exactly where an inline element starts, which is also
        // the END of the previous text node — on an earlier source line.
        const html =
            '<p data-source-line="1">Intro\n<strong data-source-line="2">rendered</strong> <a data-source-line="2" href="#">text</a></p>';

        expect(
            relocateAnchor({ exact: "rendered text", prefix: "", suffix: "" }, html),
        ).toMatchObject({ line: 2, endLine: 2 });
    });
});

describe("anchor guards against malformed DOM input", () => {
    function selectRange(range: Range): void {
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
    }

    it("returns null when a selection boundary sits in an empty text node", () => {
        const r = makeArticle("<p>Hello world</p>");
        const p = r.querySelector("p")!;
        const text = p.firstChild as Text;
        const empty = document.createTextNode("");
        p.insertBefore(empty, text);
        const range = document.createRange();
        range.setStart(empty, 0);
        range.setEnd(text, 5);
        selectRange(range);
        expect(captureAnchorFromSelection(r)).toBeNull();
    });

    it("returns null when the selection ends in an empty text node", () => {
        const r = makeArticle("<p>Hello world</p>");
        const p = r.querySelector("p")!;
        const text = p.firstChild as Text;
        const empty = document.createTextNode("");
        p.appendChild(empty);
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(empty, 0);
        selectRange(range);
        expect(captureAnchorFromSelection(r)).toBeNull();
    });

    it("skips a non-numeric data-source-line when capturing source lines", () => {
        const html = '<div data-source-line="7"><p data-source-line="x">hello there</p></div>';

        expect(relocateAnchor({ exact: "hello", prefix: "", suffix: "" }, html)).toMatchObject({
            line: 7,
            endLine: 7,
        });
    });

    it("ignores blocks with a non-numeric data-source-line for line anchors", () => {
        const root = makeArticle(
            '<p data-source-line="x" data-source-end-line="x">bad</p>' +
                '<p data-source-line="5" data-source-end-line="5">good</p>',
        );

        const range = resolveAnchor(root, {
            exact: "",
            prefix: "",
            suffix: "",
            line: 5,
        });

        expect(range?.toString()).toBe("good");
    });
});
