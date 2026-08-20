// Tests for the TextQuoteAnchor resolver. The anchor capture step needs a
// real DOM Selection — jsdom doesn't ship a full Selection API, so the
// capture path is covered by a small manual Selection setup. Resolution
// is fully DOM-only and works against any rendered article element.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureAnchorFromSelection,
  isWithinMermaid,
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
    expect(
      resolveAnchor(root, { exact: "", prefix: "", suffix: "" }),
    ).toBeNull();
  });

  it("locates a unique exact match via the composite prefix+exact+suffix path", () => {
    const root = makeArticle("<p>Hello world from the team</p>");
    const range = resolveAnchor(root, {
      exact: "world",
      prefix: "Hello ",
      suffix: " from",
    });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("world");
  });

  it("disambiguates duplicate exact matches by prefix/suffix scoring", () => {
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

  it("breaks a scoring tie in favor of the EARLIEST match", () => {
    // Both occurrences of "apple" score equally (no prefix/suffix context to
    // disambiguate), so the documented tie-break must pick the first one.
    // Guards the `score > bestScore` (strictly-greater) comparison against a
    // `>=` regression that would silently prefer the last match.
    const root = makeArticle("<p>apple then apple</p>");
    const range = resolveAnchor(root, {
      exact: "apple",
      prefix: "",
      suffix: "",
    });
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(0);
  });

  it("falls back to the bare exact match when prefix/suffix don't appear in the document", () => {
    const root = makeArticle("<p>Just plain text</p>");
    const range = resolveAnchor(root, {
      exact: "plain",
      prefix: "MISSING_CONTEXT_ABC",
      suffix: "ALSO_MISSING_XYZ",
    });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("plain");
  });

  it("scores partial prefix/suffix overlap when the composite match is unavailable", () => {
    // The exact text sits in different surrounding words than the anchor
    // remembers, so the match falls back to scoring how much of the prefix and
    // suffix still line up around each candidate.
    const root = makeArticle("<p>x cat ran y</p>");
    const range = resolveAnchor(root, {
      exact: "cat",
      prefix: "the ",
      suffix: " ran fast",
    });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("cat");
  });

  it("returns null when the exact text simply isn't present", () => {
    const root = makeArticle("<p>One two three</p>");
    expect(
      resolveAnchor(root, { exact: "four", prefix: "", suffix: "" }),
    ).toBeNull();
  });

  it("walks past nested element boundaries when matching", () => {
    const root = makeArticle(
      "<p>Hello <em>brave</em> new <strong>world</strong></p>",
    );
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
    expect(
      resolveAnchor(root, { exact: "", prefix: "", suffix: "", line: 5 }),
    ).toBeNull();
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

describe("isWithinMermaid", () => {
  it("is true for the diagram container element itself", () => {
    const root = makeArticle(
      '<div class="emr-mermaid"><svg><text>Alpha</text></svg></div>',
    );
    // Query the container itself so `closest` matches on the element (not an
    // ancestor): this pins the `instanceof Element ? node : parentElement`
    // branch — a mutant that always climbed to `parentElement` would step OUT
    // of the diagram (to the <article>) and wrongly report false.
    expect(isWithinMermaid(root.querySelector(".emr-mermaid")!)).toBe(true);
  });

  it("is true for a text node inside a diagram's source fallback", () => {
    const root = makeArticle(
      '<div class="emr-mermaid"><pre>graph TD; A--&gt;B</pre></div>',
    );
    expect(isWithinMermaid(root.querySelector("pre")!.firstChild!)).toBe(true);
  });

  it("is false for a text node outside any diagram", () => {
    const root = makeArticle("<p>plain prose</p>");
    expect(isWithinMermaid(root.querySelector("p")!.firstChild!)).toBe(false);
  });

  it("is false for a detached node with no parent element", () => {
    expect(isWithinMermaid(document.createTextNode("orphan"))).toBe(false);
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

  it("captures a TextQuoteAnchor with up to 80 chars of prefix/suffix", () => {
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

  it("truncates captured prefix/suffix to the 80-char context window", () => {
    // Long document so the selection has >80 chars of context on each side.
    // The short happy-path fixture never exercises the CONTEXT_LEN clamp, so a
    // Math.max/Math.min swap on the slice bounds slips through. Here prefix and
    // suffix must be capped at exactly 80 chars.
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

  it("disambiguates duplicate matches via prefix/suffix scoring", () => {
    // "apple" appears twice; only the second is followed by " tart", so the
    // remembered suffix picks it out even though the exact text is ambiguous.
    const source = "apple pie\napple tart";
    const out = withSourceLocation(
      { exact: "apple", prefix: "X\n", suffix: " tart Y" },
      source,
    );
    expect(out.line).toBe(2);
    expect(out.column).toBe(1);
    expect(out.endColumn).toBe(5);
  });

  it("selects the occurrence with the strongest prefix/suffix overlap", () => {
    // Two identical "apple" runs; the first is surrounded by the context the
    // anchor remembers, so it wins even though a later candidate also matches.
    const source = "apple tart\napple pie";
    const out = withSourceLocation(
      { exact: "apple", prefix: "X\n", suffix: " tart Y" },
      source,
    );
    expect(out.line).toBe(1);
    expect(out.column).toBe(1);
    expect(out.endColumn).toBe(5);
  });

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
    const out = withSourceLocation(
      { exact: "a\nb", prefix: "x ", suffix: " y" },
      source,
    );
    expect(out.line).toBe(1);
    expect(out.column).toBe(3);
    expect(out.endColumn).toBe(5);
  });

  it("does NOT consume the char after a lone CR as part of a CRLF pair", () => {
    // A '\r' followed by a non-'\n' char must advance by 1, not 2. If the
    // CRLF lookahead were mutated to always skip 2, the 'b' right after the
    // CR would be swallowed and the offsets (and endColumn) would shift.
    const source = "a\rbcd";
    const out = withSourceLocation(
      { exact: "bcd", prefix: "a\n", suffix: "" },
      source,
    );
    // A wrongly-widened CRLF skip would swallow 'b', leaving the quote
    // unresolvable (offsets unchanged / no line). Column is measured in the
    // original source, where a lone '\r' is not a newline, so "bcd" sits at
    // line 1, column 3.
    expect(out.line).toBe(1);
    expect(out.column).toBe(3);
    expect(out.endColumn).toBe(5);
  });
});

describe("resolveAnchor tier selection", () => {
  it("prefers the text quote over the line fallback when both are present", () => {
    // The anchor carries BOTH a resolvable exact quote and a line number. The
    // quote must win (returns the matched text range), not the whole-line
    // block. Guards the `if (quoted) return quoted` short-circuit.
    const root = makeArticle(
      '<p data-source-line="1">alpha</p><p data-source-line="2">beta gamma</p>',
    );
    const range = resolveAnchor(root, {
      exact: "gamma",
      prefix: "beta ",
      suffix: "",
      line: 1,
    });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("gamma");
  });

  it("uses the line fallback only when the exact quote fails to resolve", () => {
    // Exact text is absent from the DOM, so tier-1 misses and the resolver
    // must fall through to the data-source-line block for the given line.
    const root = makeArticle(
      '<p data-source-line="1">alpha</p><p data-source-line="2">beta gamma</p>',
    );
    const range = resolveAnchor(root, {
      exact: "not-in-document",
      prefix: "",
      suffix: "",
      line: 2,
    });
    expect(range).not.toBeNull();
    expect(range!.toString()).toContain("beta gamma");
  });

  it("returns null when exact is absent and line is 0 (not > 0)", () => {
    // Pins the `anchor.line > 0` guard: a 0 line must NOT trigger the
    // fallback (ADO lines are 1-based), so an unresolvable quote yields null.
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

describe("flattenText edge cases (via resolveAnchor)", () => {
  it("ignores empty text nodes when flattening, matching across element boundaries", () => {
    // Empty text nodes (created by adjacent tags) must be skipped so offsets
    // stay contiguous. The match spans an inline boundary with no gap.
    const root = makeArticle("<p><span></span>alpha<span></span>beta</p>");
    const range = resolveAnchor(root, {
      exact: "alphabeta",
      prefix: "",
      suffix: "",
    });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("alphabeta");
  });

  it("skips a zero-length text node when flattening (kills the length>0 guard)", () => {
    // innerHTML never yields an *empty* text node, so build one by hand: an
    // explicit `createTextNode("")` between two real runs. flattenText must
    // drop it (its `text.length > 0` guard) so offsets stay contiguous and the
    // match still spans "alphabeta".
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
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("alphabeta");
  });
});

describe("resolveAnchor graded scoring (kills scoring math mutants)", () => {
  // Three identical "TARGET" runs; the prefix/suffix never appear verbatim
  // (so the composite fast-path is skipped and the scored fallback runs), yet
  // the MIDDLE occurrence has the strongest trailing-prefix + leading-suffix
  // overlap. Any off-by-one in the pre/suf slice arithmetic, or flipping the
  // `score > bestScore` comparison, changes which occurrence wins and moves
  // the resolved start offset.
  const text = "aaaTARGETbbbcccTARGETdddeeeTARGETfff";

  it("selects the occurrence with the strongest combined overlap (the middle one)", () => {
    const root = makeArticle(`<p>${text}</p>`);
    const range = resolveAnchor(root, {
      exact: "TARGET",
      prefix: "Zccc",
      suffix: "dddZ",
    });
    expect(range).not.toBeNull();
    // Middle "TARGET" starts at index 15 within the single text node.
    expect(range!.startOffset).toBe(15);
  });

  it("lets a strong prefix overlap alone decide the winner", () => {
    // Only the prefix distinguishes candidates; the suffix is absent from the
    // document, so the winner is driven purely by the trailing-prefix score.
    const root = makeArticle(`<p>${text}</p>`);
    const range = resolveAnchor(root, {
      exact: "TARGET",
      prefix: "Zccc",
      suffix: "NOPE",
    });
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(15);
  });

  it("lets a strong suffix overlap alone decide the winner", () => {
    // Mirror of the above: only the leading-suffix score separates candidates.
    const root = makeArticle(`<p>${text}</p>`);
    const range = resolveAnchor(root, {
      exact: "TARGET",
      prefix: "NOPE",
      suffix: "dddZ",
    });
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(15);
  });
});

describe("withSourceLocation graded scoring (kills scoring math mutants)", () => {
  // Same construction as the DOM path, but exercising findTextQuoteOffsets:
  // the middle "TARGET" wins on combined prefix+suffix overlap.
  const source = "aaaTARGETbbbcccTARGETdddeeeTARGETfff";

  it("maps the strongest-overlap occurrence (the middle one) to its column", () => {
    const out = withSourceLocation(
      { exact: "TARGET", prefix: "Zccc", suffix: "dddZ" },
      source,
    );
    // Middle "TARGET" is at 0-based index 15 => 1-based column 16.
    expect(out.line).toBe(1);
    expect(out.column).toBe(16);
    expect(out.endColumn).toBe(21);
  });

  it("selects on prefix overlap alone when the suffix is absent", () => {
    const out = withSourceLocation(
      { exact: "TARGET", prefix: "Zccc", suffix: "NOPE" },
      source,
    );
    expect(out.column).toBe(16);
  });

  it("selects on suffix overlap alone when the prefix is absent", () => {
    const out = withSourceLocation(
      { exact: "TARGET", prefix: "NOPE", suffix: "dddZ" },
      source,
    );
    expect(out.column).toBe(16);
  });
});
