// Unit tests for the shared HAST text extractor. It underpins heading slugs
// and mermaid source recovery, so its contract — concatenate all descendant
// text in document order — is worth pinning directly.

import { describe, it, expect } from "vitest";
import type { Element } from "hast";

import { extractHastText } from "../src/markdown/hast-text";

function el(tagName: string, children: Element["children"]): Element {
  return { type: "element", tagName, properties: {}, children };
}

describe("extractHastText", () => {
  it("returns the empty string for an element with no children", () => {
    expect(extractHastText(el("p", []))).toBe("");
  });

  it("treats a missing children array as empty", () => {
    // hast nodes from some producers omit `children` entirely; the extractor
    // must not throw and should yield the empty string.
    const node = { type: "element", tagName: "br", properties: {} } as Element;
    expect(extractHastText(node)).toBe("");
  });

  it("concatenates direct text nodes", () => {
    expect(
      extractHastText(
        el("p", [
          { type: "text", value: "Hello " },
          { type: "text", value: "world" },
        ]),
      ),
    ).toBe("Hello world");
  });

  it("recurses into nested elements in document order", () => {
    // <h1>Get <em>started <code>now</code></em>!</h1>
    const heading = el("h1", [
      { type: "text", value: "Get " },
      el("em", [
        { type: "text", value: "started " },
        el("code", [{ type: "text", value: "now" }]),
      ]),
      { type: "text", value: "!" },
    ]);
    expect(extractHastText(heading)).toBe("Get started now!");
  });

  it("ignores children that are neither text nor element nodes", () => {
    // A HAST comment node sits between two text runs; the extractor skips it
    // and returns just the readable text.
    const node = el("p", [
      { type: "text", value: "before " },
      { type: "comment", value: " ignored " },
      { type: "text", value: "after" },
    ]);
    expect(extractHastText(node)).toBe("before after");
  });
});
