import { describe, it, expect } from "vitest";
import {
  diffCharacters,
  diffWords,
  tokenizeWords,
  unchangedRatio,
  type WordDiffOp,
} from "../src/markdown/wordDiff";

/** Concatenate the values of ops of the given kinds, in order. */
function join(ops: WordDiffOp[], kinds: WordDiffOp["kind"][]): string {
  return ops
    .filter((o) => kinds.includes(o.kind))
    .map((o) => o.value)
    .join("");
}

describe("tokenizeWords", () => {
  it("returns an empty array for the empty string", () => {
    expect(tokenizeWords("")).toEqual([]);
  });

  it("splits words, whitespace, and punctuation into separate tokens", () => {
    expect(tokenizeWords("Hi, there!")).toEqual(["Hi", ",", " ", "there", "!"]);
  });

  it("keeps a whitespace run as a single token", () => {
    expect(tokenizeWords("a   b")).toEqual(["a", "   ", "b"]);
  });

  it("treats digits and underscores as word characters", () => {
    expect(tokenizeWords("v2_beta")).toEqual(["v2_beta"]);
  });

  it("round-trips: joining tokens reproduces the input exactly", () => {
    const s = "The `widget-cli`\n  tool — v2.0, ready?";
    expect(tokenizeWords(s).join("")).toBe(s);
  });

  it("tokenizes non-ASCII letters as words", () => {
    expect(tokenizeWords("café résumé")).toEqual(["café", " ", "résumé"]);
  });

  it("splits CJK ideographs and kana into single-character tokens", () => {
    expect(tokenizeWords("今日は東京")).toEqual(["今", "日", "は", "東", "京"]);
    expect(tokenizeWords("カタカナー")).toEqual(["カ", "タ", "カ", "ナ", "ー"]);
  });

  it("keeps Latin words whole next to CJK text", () => {
    expect(tokenizeWords("使用API调用")).toEqual([
      "使",
      "用",
      "API",
      "调",
      "用",
    ]);
  });

  it("keeps Hangul words whole (Korean separates words with spaces)", () => {
    expect(tokenizeWords("날씨가 좋다")).toEqual(["날씨가", " ", "좋다"]);
  });

  it("separates line breaks from indentation", () => {
    expect(tokenizeWords("a\n    b")).toEqual(["a", "\n", "    ", "b"]);
    expect(tokenizeWords("a  \r\nb\rc")).toEqual([
      "a",
      "  ",
      "\r\n",
      "b",
      "\r",
      "c",
    ]);
  });
});

describe("diffWords", () => {
  it("returns nothing for two empty strings", () => {
    expect(diffWords("", "")).toEqual([]);
  });

  it("returns a single equal run for identical text", () => {
    expect(diffWords("same text", "same text")).toEqual([
      { kind: "equal", value: "same text" },
    ]);
  });

  it("marks a pure insertion as added", () => {
    const ops = diffWords("", "brand new");
    expect(ops).toEqual([{ kind: "added", value: "brand new" }]);
  });

  it("marks a pure deletion as removed", () => {
    const ops = diffWords("all gone", "");
    expect(ops).toEqual([{ kind: "removed", value: "all gone" }]);
  });

  it("detects a single changed word amid unchanged context", () => {
    const ops = diffWords("The quick brown fox", "The quick red fox");
    // equal+added reconstructs the modified string.
    expect(join(ops, ["equal", "added"])).toBe("The quick red fox");
    // equal+removed reconstructs the original string.
    expect(join(ops, ["equal", "removed"])).toBe("The quick brown fox");
    // "brown" removed, "red" added; "fox" untouched (not split mid-word).
    expect(
      ops.some((o) => o.kind === "removed" && o.value.includes("brown")),
    ).toBe(true);
    expect(ops.some((o) => o.kind === "added" && o.value.includes("red"))).toBe(
      true,
    );
  });

  it("reconstructs both sides for a multi-word edit", () => {
    const original = "look for a stack trace in the console";
    const modified = "check the network tab in the console";
    const ops = diffWords(original, modified);
    expect(join(ops, ["equal", "removed"])).toBe(original);
    expect(join(ops, ["equal", "added"])).toBe(modified);
  });

  it("keeps a trailing addition separate from the equal prefix", () => {
    const ops = diffWords("hello", "hello world");
    expect(join(ops, ["equal", "added"])).toBe("hello world");
    expect(ops[0]).toEqual({ kind: "equal", value: "hello" });
    expect(ops.at(-1)?.kind).toBe("added");
  });

  it("merges adjacent runs of the same kind", () => {
    const ops = diffWords("a b c", "a x y c");
    // No two consecutive ops share a kind.
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i]!.kind).not.toBe(ops[i - 1]!.kind);
    }
  });

  it("never emits an empty-value op", () => {
    const ops = diffWords("one two three", "one three");
    expect(ops.every((o) => o.value.length > 0)).toBe(true);
  });

  it("handles punctuation-only changes", () => {
    const ops = diffWords("Ready.", "Ready?");
    expect(join(ops, ["equal", "added"])).toBe("Ready?");
    expect(join(ops, ["equal", "removed"])).toBe("Ready.");
  });

  it("preserves whitespace exactly on both sides", () => {
    const original = "one  two";
    const modified = "one two three";
    const ops = diffWords(original, modified);
    expect(join(ops, ["equal", "removed"])).toBe(original);
    expect(join(ops, ["equal", "added"])).toBe(modified);
  });

  it("does NOT split a word to share a substring with a neighbour", () => {
    // "here" and "everywhere" share the suffix "here"; a char-level cleanup
    // would split "everywhere" into "everyw"+"here". Word-level must treat
    // them as whole-word replace.
    const ops = diffWords(
      "review of files here.",
      "review of files everywhere.",
    );
    const added = ops.find((o) => o.kind === "added");
    const removed = ops.find((o) => o.kind === "removed");
    expect(added?.value).toContain("everywhere");
    expect(added?.value).not.toBe("everyw");
    expect(removed?.value).toContain("here");
    // No equal op contains a bare partial word "here" carved out of a word.
    expect(join(ops, ["equal", "added"])).toBe("review of files everywhere.");
    expect(join(ops, ["equal", "removed"])).toBe("review of files here.");
  });

  it("isolates a single changed CJK character", () => {
    expect(diffWords("我们今天去公园玩。", "我们明天去公园玩。")).toEqual([
      { kind: "equal", value: "我们" },
      { kind: "removed", value: "今" },
      { kind: "added", value: "明" },
      { kind: "equal", value: "天去公园玩。" },
    ]);
  });

  it("re-indents code by marking only the added spaces", () => {
    expect(diffWords("def f():\n  return 1", "def f():\n    return 1")).toEqual(
      [
        { kind: "equal", value: "def f():\n  " },
        { kind: "added", value: "  " },
        { kind: "equal", value: "return 1" },
      ],
    );
  });

  it("dedents code by marking only the removed spaces", () => {
    expect(diffWords("if x:\n    y", "if x:\n  y")).toEqual([
      { kind: "equal", value: "if x:\n  " },
      { kind: "removed", value: "  " },
      { kind: "equal", value: "y" },
    ]);
  });

  it("keeps a tab-for-spaces swap as a replacement", () => {
    expect(diffWords("\treturn", "    return")).toEqual([
      { kind: "removed", value: "\t" },
      { kind: "added", value: "    " },
      { kind: "equal", value: "return" },
    ]);
  });

  it("adds trailing whitespace without re-adding the line break", () => {
    expect(diffWords("a\nb", "a  \nb")).toEqual([
      { kind: "equal", value: "a" },
      { kind: "added", value: "  " },
      { kind: "equal", value: "\nb" },
    ]);
  });

  it("aligns a removed line to its line boundaries", () => {
    expect(
      diffWords(
        "Sentence one.\nSentence two.\nSentence three.",
        "Sentence one.\nSentence three.",
      ),
    ).toEqual([
      { kind: "equal", value: "Sentence one.\n" },
      { kind: "removed", value: "Sentence two.\n" },
      { kind: "equal", value: "Sentence three." },
    ]);
  });

  it("aligns an inserted paragraph between blank lines", () => {
    expect(diffWords("a\n\nb", "a\n\nx\n\nb")).toEqual([
      { kind: "equal", value: "a\n\n" },
      { kind: "added", value: "x\n\n" },
      { kind: "equal", value: "b" },
    ]);
  });

  it("aligns a removed sentence to sentence boundaries", () => {
    expect(diffWords("One. Two. Three.", "One. Three.")).toEqual([
      { kind: "equal", value: "One. " },
      { kind: "removed", value: "Two. " },
      { kind: "equal", value: "Three." },
    ]);
  });

  it("slides a repeated phrase to the start of the text", () => {
    expect(diffWords("a b c", "a b a b c")).toEqual([
      { kind: "added", value: "a b " },
      { kind: "equal", value: "a b c" },
    ]);
  });

  it("never slides an edit into the middle of a word", () => {
    // Character-level boundary sliding would prefer `the cat{+s cat+}`.
    const ops = diffWords("the cat", "the cats cat");
    expect(ops).toContainEqual({ kind: "added", value: "cats " });
  });

  it("keeps both sides reconstructable across many random edits", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const vocabulary = ["a", "b", "cat", "cats", " ", " ", "\n", ".", "我"];
    const text = (length: number) =>
      Array.from(
        { length },
        () => vocabulary[Math.floor(random() * vocabulary.length)],
      ).join("");
    for (let run = 0; run < 400; run++) {
      const original = text(Math.floor(random() * 12));
      const modified = text(Math.floor(random() * 12));
      const ops = diffWords(original, modified);
      expect(join(ops, ["equal", "removed"])).toBe(original);
      expect(join(ops, ["equal", "added"])).toBe(modified);
      expect(ops.every((op) => op.value.length > 0)).toBe(true);
      for (let i = 1; i < ops.length; i++) {
        expect(ops[i]!.kind).not.toBe(ops[i - 1]!.kind);
      }
    }
  });
});

describe("diffCharacters", () => {
  it("isolates a TeX exponent edit at character granularity", () => {
    const original = String.raw`g_i`;
    const modified = String.raw`g_i^2`;
    const ops = diffCharacters(original, modified);

    expect(join(ops, ["equal", "removed"])).toBe(original);
    expect(join(ops, ["equal", "added"])).toBe(modified);
    expect(ops).toContainEqual({ kind: "added", value: "^2" });
    expect(ops).not.toContainEqual({ kind: "removed", value: "g_i" });
  });

  it("isolates a TeX character removal", () => {
    expect(diffCharacters(String.raw`g_i^2`, String.raw`g_i`)).toContainEqual({
      kind: "removed",
      value: "^2",
    });
  });

  it("handles identical and empty source", () => {
    expect(diffCharacters("", "")).toEqual([]);
    expect(diffCharacters("x", "x")).toEqual([{ kind: "equal", value: "x" }]);
  });
});

describe("unchangedRatio", () => {
  it("is 1 for an empty op list", () => {
    expect(unchangedRatio([])).toBe(1);
  });

  it("is 1 when everything is equal", () => {
    expect(unchangedRatio([{ kind: "equal", value: "same words here" }])).toBe(
      1,
    );
  });

  it("is 0 when nothing is equal", () => {
    expect(
      unchangedRatio([
        { kind: "removed", value: "old" },
        { kind: "added", value: "new" },
      ]),
    ).toBe(0);
  });

  it("reports the fraction of the modified text that is unchanged", () => {
    // 6 equal chars out of 10 on the modified side (equal + added).
    const ratio = unchangedRatio([
      { kind: "equal", value: "aaaaaa" }, // 6
      { kind: "added", value: "bbbb" }, // 4
    ]);
    expect(ratio).toBeCloseTo(0.6, 5);
  });

  it("excludes removed text from the denominator (modified side only)", () => {
    // equal=2, added=0, removed=2 → modified side is just the 2 equal chars.
    const ratio = unchangedRatio([
      { kind: "equal", value: "ab" }, // 2
      { kind: "removed", value: "cd" }, // 2 (ignored)
    ]);
    expect(ratio).toBeCloseTo(1, 5);
  });

  it("counts a long replacement that keeps a shared prefix as mostly unchanged", () => {
    // Real-world case: a reworded sentence sharing a leading clause. Removed
    // text must NOT drag the ratio below the inline threshold.
    const ratio = unchangedRatio([
      { kind: "equal", value: "If it fails, open the console and " }, // 34
      { kind: "removed", value: "look for a stack trace" }, // ignored
      { kind: "added", value: "check the network tab" }, // 21
    ]);
    // 34 / (34 + 21) ≈ 0.62 — comfortably above a 0.3 inline threshold.
    expect(ratio).toBeGreaterThan(0.5);
  });
});
