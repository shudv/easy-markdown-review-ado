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
    it.each([
        { name: "empty text", text: "", tokens: [] },
        {
            name: "words, whitespace and punctuation",
            text: "Hi, there!",
            tokens: ["Hi", ",", " ", "there", "!"],
        },
        { name: "a run of spaces", text: "a   b", tokens: ["a", "   ", "b"] },
        { name: "an identifier with digits and underscores", text: "v2_beta", tokens: ["v2_beta"] },
        { name: "accented words", text: "café résumé", tokens: ["café", " ", "résumé"] },
        {
            name: "Japanese kanji and kana, one character each",
            text: "今日は東京",
            tokens: ["今", "日", "は", "東", "京"],
        },
        {
            name: "katakana, one character each",
            text: "カタカナー",
            tokens: ["カ", "タ", "カ", "ナ", "ー"],
        },
        {
            name: "a Latin word inside Chinese text",
            text: "使用API调用",
            tokens: ["使", "用", "API", "调", "用"],
        },
        {
            name: "Korean words separated by spaces",
            text: "날씨가 좋다",
            tokens: ["날씨가", " ", "좋다"],
        },
        {
            name: "a line break followed by indentation",
            text: "a\n    b",
            tokens: ["a", "\n", "    ", "b"],
        },
        {
            name: "trailing spaces before CRLF and CR line breaks",
            text: "a  \r\nb\rc",
            tokens: ["a", "  ", "\r\n", "b", "\r", "c"],
        },
    ])("splits $name", ({ text, tokens }) => {
        expect(tokenizeWords(text)).toEqual(tokens);
    });

    it("keeps every character, so the tokens join back into the original text", () => {
        const text = "The `widget-cli`\n  tool — v2.0, ready?";
        expect(tokenizeWords(text).join("")).toBe(text);
    });
});

describe("diffWords", () => {
    it.each<{ name: string; original: string; modified: string; ops: WordDiffOp[] }>([
        { name: "two empty texts have no changes", original: "", modified: "", ops: [] },
        {
            name: "identical text is one unchanged run",
            original: "same text",
            modified: "same text",
            ops: [{ kind: "equal", value: "same text" }],
        },
        {
            name: "text written from nothing is all added",
            original: "",
            modified: "brand new",
            ops: [{ kind: "added", value: "brand new" }],
        },
        {
            name: "text cleared completely is all removed",
            original: "all gone",
            modified: "",
            ops: [{ kind: "removed", value: "all gone" }],
        },
        {
            name: "a replaced word is removed then added between unchanged context",
            original: "The quick brown fox",
            modified: "The quick red fox",
            ops: [
                { kind: "equal", value: "The quick " },
                { kind: "removed", value: "brown" },
                { kind: "added", value: "red" },
                { kind: "equal", value: " fox" },
            ],
        },
        {
            name: "an appended word follows the unchanged text",
            original: "hello",
            modified: "hello world",
            ops: [
                { kind: "equal", value: "hello" },
                { kind: "added", value: " world" },
            ],
        },
        {
            name: "a word sharing a suffix with its replacement is replaced whole",
            original: "review of files here.",
            modified: "review of files everywhere.",
            ops: [
                { kind: "equal", value: "review of files " },
                { kind: "removed", value: "here" },
                { kind: "added", value: "everywhere" },
                { kind: "equal", value: "." },
            ],
        },
        {
            name: "one changed CJK character is isolated",
            original: "我们今天去公园玩。",
            modified: "我们明天去公园玩。",
            ops: [
                { kind: "equal", value: "我们" },
                { kind: "removed", value: "今" },
                { kind: "added", value: "明" },
                { kind: "equal", value: "天去公园玩。" },
            ],
        },
        {
            name: "re-indented code marks only the added spaces",
            original: "def f():\n  return 1",
            modified: "def f():\n    return 1",
            ops: [
                { kind: "equal", value: "def f():\n  " },
                { kind: "added", value: "  " },
                { kind: "equal", value: "return 1" },
            ],
        },
        {
            name: "code with its indentation reduced marks only the removed spaces",
            original: "if x:\n    y",
            modified: "if x:\n  y",
            ops: [
                { kind: "equal", value: "if x:\n  " },
                { kind: "removed", value: "  " },
                { kind: "equal", value: "y" },
            ],
        },
        {
            name: "a tab swapped for spaces is a replacement",
            original: "\treturn",
            modified: "    return",
            ops: [
                { kind: "removed", value: "\t" },
                { kind: "added", value: "    " },
                { kind: "equal", value: "return" },
            ],
        },
        {
            name: "spaces added after a tab mark only the added spaces",
            original: "\treturn",
            modified: "\t  return",
            ops: [
                { kind: "equal", value: "\t" },
                { kind: "added", value: "  " },
                { kind: "equal", value: "return" },
            ],
        },
        {
            name: "spaces removed after a tab mark only the removed spaces",
            original: "\t  return",
            modified: "\treturn",
            ops: [
                { kind: "equal", value: "\t" },
                { kind: "removed", value: "  " },
                { kind: "equal", value: "return" },
            ],
        },
        {
            name: "added trailing whitespace leaves the line break unchanged",
            original: "a\nb",
            modified: "a  \nb",
            ops: [
                { kind: "equal", value: "a" },
                { kind: "added", value: "  " },
                { kind: "equal", value: "\nb" },
            ],
        },
        {
            name: "a removed line is aligned to its line boundaries",
            original: "Sentence one.\nSentence two.\nSentence three.",
            modified: "Sentence one.\nSentence three.",
            ops: [
                { kind: "equal", value: "Sentence one.\n" },
                { kind: "removed", value: "Sentence two.\n" },
                { kind: "equal", value: "Sentence three." },
            ],
        },
        {
            name: "a removed line in a Windows (CRLF) document is aligned to its line boundaries",
            original: "Sentence one.\r\nSentence two.\r\nSentence three.",
            modified: "Sentence one.\r\nSentence three.",
            ops: [
                { kind: "equal", value: "Sentence one.\r\n" },
                { kind: "removed", value: "Sentence two.\r\n" },
                { kind: "equal", value: "Sentence three." },
            ],
        },
        {
            name: "a blank line inserted between two lines is marked after the first line's break",
            original: "Intro\nNext",
            modified: "Intro\n\nNext",
            ops: [
                { kind: "equal", value: "Intro\n" },
                { kind: "added", value: "\n" },
                { kind: "equal", value: "Next" },
            ],
        },
        {
            name: "a line added to the end of a paragraph leaves the paragraph break unchanged",
            original: "Intro line.\nSecond line.\n\nNext paragraph.",
            modified: "Intro line.\nSecond line.\nThird line.\n\nNext paragraph.",
            ops: [
                { kind: "equal", value: "Intro line.\nSecond line." },
                { kind: "added", value: "\nThird line." },
                { kind: "equal", value: "\n\nNext paragraph." },
            ],
        },
        {
            name: "a sentence inserted after two-space sentence spacing starts at its first word",
            original: "One.  Two.",
            modified: "One.  One and a half.  Two.",
            ops: [
                { kind: "equal", value: "One.  " },
                { kind: "added", value: "One and a half.  " },
                { kind: "equal", value: "Two." },
            ],
        },
        {
            name: "a doubled negation on an indented line is marked after the indentation",
            original: "const ok =\n    !ready;",
            modified: "const ok =\n    !!ready;",
            ops: [
                { kind: "equal", value: "const ok =\n    " },
                { kind: "added", value: "!" },
                { kind: "equal", value: "!ready;" },
            ],
        },
        {
            name: "a slash added to fix a URL scheme is marked after the existing one",
            original: "See http:/example.com",
            modified: "See http://example.com",
            ops: [
                { kind: "equal", value: "See http:/" },
                { kind: "added", value: "/" },
                { kind: "equal", value: "example.com" },
            ],
        },
        {
            name: "a lengthened diagram arrow marks the added dash inside the arrow",
            original: "A->B",
            modified: "A-->B",
            ops: [
                { kind: "equal", value: "A-" },
                { kind: "added", value: "-" },
                { kind: "equal", value: ">B" },
            ],
        },
        {
            name: "a phrase repeated in Japanese text is marked after the phrase it repeats",
            original: "日本語のテスト。",
            modified: "日本語のテストのテスト。",
            ops: [
                { kind: "equal", value: "日本語のテスト" },
                { kind: "added", value: "のテスト" },
                { kind: "equal", value: "。" },
            ],
        },
        {
            name: "an inserted paragraph is aligned between blank lines",
            original: "a\n\nb",
            modified: "a\n\nx\n\nb",
            ops: [
                { kind: "equal", value: "a\n\n" },
                { kind: "added", value: "x\n\n" },
                { kind: "equal", value: "b" },
            ],
        },
        {
            name: "a removed sentence is aligned to sentence boundaries",
            original: "One. Two. Three.",
            modified: "One. Three.",
            ops: [
                { kind: "equal", value: "One. " },
                { kind: "removed", value: "Two. " },
                { kind: "equal", value: "Three." },
            ],
        },
        {
            name: "a repeated phrase is shown as added at the start",
            original: "a b c",
            modified: "a b a b c",
            ops: [
                { kind: "added", value: "a b " },
                { kind: "equal", value: "a b c" },
            ],
        },
    ])("$name", ({ original, modified, ops }) => {
        expect(diffWords(original, modified)).toEqual(ops);
    });

    it("never slides an edit into the middle of a word", () => {
        // Character-level boundary sliding would prefer `the cat{+s cat+}`.
        expect(diffWords("the cat", "the cats cat")).toContainEqual({
            kind: "added",
            value: "cats ",
        });
    });

    it.each([
        {
            name: "a multi-word rewrite",
            original: "look for a stack trace in the console",
            modified: "check the network tab in the console",
        },
        { name: "a punctuation-only change", original: "Ready.", modified: "Ready?" },
        { name: "collapsed double spaces", original: "one  two", modified: "one two three" },
        { name: "bold text made bold italic", original: "**bold**", modified: "***bold***" },
    ])("rebuilds both sides exactly for $name", ({ original, modified }) => {
        const ops = diffWords(original, modified);
        expect(join(ops, ["equal", "removed"])).toBe(original);
        expect(join(ops, ["equal", "added"])).toBe(modified);
    });

    // Deterministic pseudo-random edits over a tiny vocabulary that mixes words,
    // a shared prefix (cat/cats), whitespace, line breaks and CJK.
    const randomEdits = (() => {
        let seed = 7;

        const random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed / 2147483648;
        };

        const vocabulary = ["a", "b", "cat", "cats", " ", " ", "\n", ".", "我"];

        const text = (length: number) =>
            Array.from({ length }, () => vocabulary[Math.floor(random() * vocabulary.length)]).join(
                "",
            );

        return Array.from({ length: 400 }, () => {
            const original = text(Math.floor(random() * 12));

            return [original, text(Math.floor(random() * 12))] as const;
        });
    })();

    /** Why `diffWords(original, modified)` breaks the diff contract, or null if it holds. */
    const contractViolation = ([original, modified]: readonly [string, string]) => {
        const ops = diffWords(original, modified);

        const problems = [
            join(ops, ["equal", "removed"]) !== original && "does not rebuild the original",
            join(ops, ["equal", "added"]) !== modified && "does not rebuild the modified text",
            ops.some((op) => op.value.length === 0) && "has an empty run",
            ops.slice(1).some((op, i) => op.kind === ops[i]!.kind) && "repeats a run kind",
        ].filter(Boolean);

        return problems.length > 0 ? { original, modified, problems } : null;
    };

    it("rebuilds both sides from non-empty, alternating runs for any mix of words, spaces, line breaks and CJK", () => {
        expect(randomEdits.map(contractViolation).filter(Boolean)).toEqual([]);
    });
});

describe("diffCharacters", () => {
    it("isolates an added TeX exponent", () => {
        const ops = diffCharacters(String.raw`g_i`, String.raw`g_i^2`);

        expect(ops).toEqual([
            { kind: "equal", value: "g_i" },
            { kind: "added", value: "^2" },
        ]);
    });

    it("isolates a removed TeX exponent", () => {
        expect(diffCharacters(String.raw`g_i^2`, String.raw`g_i`)).toContainEqual({
            kind: "removed",
            value: "^2",
        });
    });

    it.each([
        { name: "two empty sources have no changes", original: "", modified: "", ops: [] },
        {
            name: "identical source is one unchanged run",
            original: "x",
            modified: "x",
            ops: [{ kind: "equal", value: "x" }],
        },
    ])("$name", ({ original, modified, ops }) => {
        expect(diffCharacters(original, modified)).toEqual(ops);
    });
});

// The share of the CURRENT text (unchanged + added) that is unchanged; it
// decides whether a block is word-diffed or shown as a rewrite.
describe("unchangedRatio", () => {
    it.each<{ name: string; ops: WordDiffOp[]; ratio: number }>([
        { name: "no text at all counts as fully unchanged", ops: [], ratio: 1 },
        {
            name: "unchanged text counts as fully unchanged",
            ops: [{ kind: "equal", value: "same words here" }],
            ratio: 1,
        },
        {
            name: "a complete replacement counts as nothing unchanged",
            ops: [
                { kind: "removed", value: "old" },
                { kind: "added", value: "new" },
            ],
            ratio: 0,
        },
        {
            name: "6 unchanged of 10 current characters is 0.6",
            ops: [
                { kind: "equal", value: "aaaaaa" },
                { kind: "added", value: "bbbb" },
            ],
            ratio: 0.6,
        },
        {
            name: "removed text does not lower the ratio",
            ops: [
                { kind: "equal", value: "ab" },
                { kind: "removed", value: "cd" },
            ],
            ratio: 1,
        },
    ])("$name", ({ ops, ratio }) => {
        expect(unchangedRatio(ops)).toBeCloseTo(ratio, 5);
    });

    it("keeps a reworded sentence that shares its leading clause above the inline threshold", () => {
        const ratio = unchangedRatio([
            { kind: "equal", value: "If it fails, open the console and " }, // 34
            { kind: "removed", value: "look for a stack trace" }, // ignored
            { kind: "added", value: "check the network tab" }, // 21
        ]);

        // 34 / (34 + 21) ≈ 0.62 — comfortably above the 0.3 inline threshold.
        expect(ratio).toBeGreaterThan(0.5);
    });
});
