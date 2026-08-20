// Word-level diff of two prose strings, built on the already-bundled
// `diff-match-patch` (a direct production dependency).
//
// diff-match-patch is character-oriented. Character diffs read badly for prose
// ("Th[is→at]" splits mid-word), so we apply the library's documented
// line-mode recipe at WORD granularity: tokenise both strings into words +
// whitespace + punctuation runs, map each unique token to a single UTF-16 code
// unit, diff the compact encoded strings, then expand back to word tokens. A
// final semantic cleanup merges noisy edits into human-readable chunks.
//
// The output is a flat op list in *modified*-string order — exactly what the
// DOM applier needs to wrap added words and splice in removed ones.

import { diff_match_patch } from "diff-match-patch";

/** One contiguous run of the word diff. */
export interface WordDiffOp {
  /**
   * `equal` — present in both; `added` — only in the modified text;
   * `removed` — only in the original text.
   */
  kind: "equal" | "added" | "removed";
  /** The verbatim text of this run (including its surrounding whitespace). */
  value: string;
}

const DIFF_DELETE = -1;
const DIFF_INSERT = 1;
// DIFF_EQUAL === 0.

/**
 * Split `text` into word / whitespace / punctuation tokens. Keeping whitespace
 * and punctuation as their own tokens means the reassembled text is a perfect
 * round-trip of the input (no lost spaces) and edits align to word boundaries.
 */
export function tokenizeWords(text: string): string[] {
  // Runs of: word chars (letters/digits/underscore/combining marks) OR a
  // single whitespace run OR any other single char (punctuation/symbol).
  const matches = text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu);
  return matches ?? [];
}

/**
 * Encode both token streams into strings of single code units (one unique
 * char per unique token) so `diff_main` runs at word rather than char
 * granularity. Mirrors diff-match-patch's own `diff_linesToChars_` trick.
 */
function wordsToChars(
  a: string,
  b: string,
): { chars1: string; chars2: string; tokenArray: string[] } {
  const tokenArray: string[] = [];
  const tokenHash = new Map<string, number>();

  const encode = (text: string): string => {
    const tokens = tokenizeWords(text);
    let chars = "";
    for (const token of tokens) {
      let index = tokenHash.get(token);
      if (index === undefined) {
        index = tokenArray.length;
        tokenArray.push(token);
        tokenHash.set(token, index);
      }
      chars += String.fromCharCode(index);
    }
    return chars;
  };

  return { chars1: encode(a), chars2: encode(b), tokenArray };
}

/** Expand an encoded-char string back into its original token text. */
function charsToText(chars: string, tokenArray: readonly string[]): string {
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    out += tokenArray[chars.charCodeAt(i)];
  }
  return out;
}

/**
 * Compute a word-level diff between `original` and `modified`.
 *
 * Returns a flat list of runs in modified-text order. `equal` + `added` values
 * concatenate back to exactly `modified`; `equal` + `removed` values
 * concatenate back to exactly `original`. Adjacent runs of the same kind are
 * merged, and empty runs are dropped.
 */
export function diffWords(original: string, modified: string): WordDiffOp[] {
  if (original === modified) {
    return modified.length > 0 ? [{ kind: "equal", value: modified }] : [];
  }

  const dmp = new diff_match_patch();
  const { chars1, chars2, tokenArray } = wordsToChars(original, modified);
  const diffs = dmp.diff_main(chars1, chars2, false);
  // Run the prose-friendly cleanup on the ENCODED token-chars (each char is a
  // whole word/space/punctuation token). Doing it here — not after expansion —
  // keeps merges at word boundaries; running it on expanded prose would let it
  // find common substrings INSIDE words (e.g. splitting "everywhere" into
  // "everyw" + "here" to share the suffix of a nearby "here"). It also
  // coalesces adjacent same-op runs, so the expansion below needs no merging.
  dmp.diff_cleanupSemantic(diffs);

  const ops: WordDiffOp[] = [];
  for (const [op, chars] of diffs) {
    const kind: WordDiffOp["kind"] =
      op === DIFF_INSERT ? "added" : op === DIFF_DELETE ? "removed" : "equal";
    ops.push({ kind, value: charsToText(chars, tokenArray) });
  }
  return ops;
}

/**
 * Fraction of the MODIFIED (post-edit) text that is unchanged (0–1). A block
 * whose new text is mostly brand-new reads better as a plain block-level
 * change than as a sea of red/green words, so callers below a threshold fall
 * back to the block wash.
 *
 * The denominator is the modified side only (equal + added) — NOT removed —
 * so a replacement that swaps a long phrase for another but keeps a real
 * shared prefix still counts as "mostly unchanged" and shows inline, rather
 * than being penalised twice for the swap.
 */
export function unchangedRatio(ops: readonly WordDiffOp[]): number {
  let equal = 0;
  let modified = 0;
  for (const op of ops) {
    if (op.kind === "removed") continue;
    modified += op.value.length;
    if (op.kind === "equal") equal += op.value.length;
  }
  if (modified === 0) return 1;
  return equal / modified;
}
