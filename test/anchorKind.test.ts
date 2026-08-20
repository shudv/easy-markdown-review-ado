import { describe, it, expect } from "vitest";

import { anchorKindOf } from "../src/shell/anchorKind";
import type { TextQuoteAnchor } from "../src/types";

describe("anchorKindOf", () => {
  it("classifies a non-empty selection as text-quote", () => {
    const anchor: TextQuoteAnchor = { exact: "hello", prefix: "", suffix: "" };
    expect(anchorKindOf(anchor)).toBe("text-quote");
  });

  it("classifies an empty-selection anchor with a source line as line", () => {
    const anchor: TextQuoteAnchor = {
      exact: "",
      prefix: "",
      suffix: "",
      line: 12,
    };
    expect(anchorKindOf(anchor)).toBe("line");
  });

  it("classifies a whole-file anchor (no exact, no line) as file-level", () => {
    const anchor: TextQuoteAnchor = { exact: "", prefix: "", suffix: "" };
    expect(anchorKindOf(anchor)).toBe("file-level");
  });
});
