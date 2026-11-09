import { describe, it, expect } from "vitest";

import { anchorKindOf } from "../src/shell/anchorKind";
import type { TextQuoteAnchor } from "../src/types";

describe("anchorKindOf", () => {
    it.each<{ name: string; anchor: TextQuoteAnchor; kind: ReturnType<typeof anchorKindOf> }>([
        {
            name: "a comment on selected text",
            anchor: { exact: "hello", prefix: "", suffix: "" },
            kind: "text-quote",
        },
        {
            name: "a comment on a source line with no selected text",
            anchor: { exact: "", prefix: "", suffix: "", line: 12 },
            kind: "line",
        },
        {
            name: "a comment on the whole file",
            anchor: { exact: "", prefix: "", suffix: "" },
            kind: "file-level",
        },
    ])("classifies $name as $kind", ({ anchor, kind }) => {
        expect(anchorKindOf(anchor)).toBe(kind);
    });
});
