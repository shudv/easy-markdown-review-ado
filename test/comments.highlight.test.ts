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

  function makeRange(
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number,
  ) {
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

  it("applies the optional background color override", () => {
    const p = document.createElement("p");
    p.textContent = "color me";
    document.body.appendChild(p);
    const text = p.firstChild as Text;

    const range = makeRange(text, 0, text, 5);
    const [span] = wrapRangeWithHighlight(range, {
      className: "hl",
      threadId: "t-2",
      background: "rgb(255, 200, 100)",
    });

    expect(span!.style.backgroundColor).toBe("rgb(255, 200, 100)");
  });

  it("leaves backgroundColor unset when no override is given", () => {
    const p = document.createElement("p");
    p.textContent = "plain span";
    document.body.appendChild(p);
    const text = p.firstChild as Text;

    const [span] = wrapRangeWithHighlight(makeRange(text, 0, text, 5), {
      className: "hl",
      threadId: "t-nobg",
    });
    // The `if (opts.background)` guard must not assign anything when omitted.
    expect(span!.style.backgroundColor).toBe("");
  });

  it("wraps a mid-node slice, splitting off BOTH the leading and trailing text", () => {
    // start > 0 AND end < length, so both splitText branches must run. The
    // wrapper holds exactly the middle slice and the siblings keep the rest.
    const p = document.createElement("p");
    p.textContent = "abcdefgh";
    document.body.appendChild(p);
    const text = p.firstChild as Text;

    const [span] = wrapRangeWithHighlight(makeRange(text, 2, text, 5), {
      className: "hl",
      threadId: "t-mid",
    });
    expect(span!.textContent).toBe("cde");
    // Leading "ab" and trailing "fgh" remain as separate, unwrapped text.
    expect(p.textContent).toBe("abcdefgh");
    expect(p.querySelectorAll("span.hl")).toHaveLength(1);
    // The wrapper is flanked by two bare text nodes (proves both splits ran).
    expect(span!.previousSibling!.textContent).toBe("ab");
    expect(span!.nextSibling!.textContent).toBe("fgh");
  });

  it("wraps a node-initial slice without splitting off a leading node", () => {
    // start === 0 → the `frag.start > 0` split must be skipped; only the
    // trailing split runs.
    const p = document.createElement("p");
    p.textContent = "headtail";
    document.body.appendChild(p);
    const text = p.firstChild as Text;

    const [span] = wrapRangeWithHighlight(makeRange(text, 0, text, 4), {
      className: "hl",
      threadId: "t-head",
    });
    expect(span!.textContent).toBe("head");
    expect(span!.previousSibling).toBeNull();
    expect(span!.nextSibling!.textContent).toBe("tail");
  });

  it("skips a whitespace-only single-text-node range (no span emitted)", () => {
    // The common-ancestor-is-text path must drop pure-whitespace selections.
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

  it("skips whitespace-only fragments in the multi-node walk", () => {
    // The inter-element whitespace text node (between the two spans) must be
    // skipped, so only the two real words get wrapped — not the gap.
    const p = document.createElement("p");
    p.appendChild(document.createTextNode("one"));
    p.appendChild(document.createTextNode("   "));
    p.appendChild(document.createTextNode("two"));
    document.body.appendChild(p);

    const range = makeRange(p.firstChild as Text, 0, p.lastChild as Text, 3);
    const spans = wrapRangeWithHighlight(range, {
      className: "hl",
      threadId: "t-wsmulti",
    });
    expect(spans.map((s) => s.textContent)).toEqual(["one", "two"]);
    expect(p.textContent).toBe("one   two");
  });

  it("wraps each text fragment when the range crosses element boundaries", () => {
    const p = document.createElement("p");
    // <strong>bold</strong> tail
    const strong = document.createElement("strong");
    strong.textContent = "bold";
    p.appendChild(strong);
    p.appendChild(document.createTextNode(" tail"));
    document.body.appendChild(p);

    const range = makeRange(
      strong.firstChild as Text,
      0,
      p.lastChild as Text,
      5,
    );
    const spans = wrapRangeWithHighlight(range, {
      className: "hl",
      threadId: "t-3",
    });

    expect(spans.length).toBeGreaterThanOrEqual(2);
    // Reassembled text content should still be intact.
    expect(p.textContent).toBe("bold tail");
    // Every wrapper carries the thread id.
    for (const s of spans) expect(s.dataset.threadId).toBe("t-3");
  });

  it("returns an empty array for a collapsed range", () => {
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
    wrapRangeWithHighlight(range, { className: "hl", threadId: "t-5" });
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
