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
  // In order: a single CJK ideograph/kana (those scripts don't separate words
  // with spaces, so a whole sentence would otherwise be one "word"); a run of
  // other word chars (letters/digits/underscore); a line break on its own; a
  // run of horizontal whitespace; or any other single char. Keeping line
  // breaks apart from indentation stops a code re-indent from striking and
  // re-adding the newline itself.
  const matches = text.match(
    /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]|(?:(?![\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}])[\p{L}\p{N}_])+|\r\n?|\n|[^\S\r\n]+|[^\p{L}\p{N}_\s]/gu,
  );
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
  shiftEditsToBoundaries(diffs, tokenArray);

  const ops: WordDiffOp[] = [];
  for (const [op, chars] of diffs) {
    const kind: WordDiffOp["kind"] =
      op === DIFF_INSERT ? "added" : op === DIFF_DELETE ? "removed" : "equal";
    ops.push({ kind, value: charsToText(chars, tokenArray) });
  }
  return narrowWhitespaceSwaps(ops);
}

/** A run of whitespace within one line (spaces and tabs, no line break). */
export const LINE_WHITESPACE = /^[^\S\r\n]+$/;

/**
 * Re-indenting replaces one whitespace run with another — two different
 * tokens. When one run extends the other (2 → 4 spaces), keep the shared part
 * unchanged and mark only the spaces actually added or removed.
 */
function narrowWhitespaceSwaps(ops: readonly WordDiffOp[]): WordDiffOp[] {
  const out: WordDiffOp[] = [];
  const push = (kind: WordDiffOp["kind"], value: string): void => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.value += value;
    else out.push({ kind, value });
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const next = ops[i + 1];
    if (
      op.kind === "removed" &&
      next?.kind === "added" &&
      LINE_WHITESPACE.test(op.value) &&
      LINE_WHITESPACE.test(next.value)
    ) {
      if (next.value.startsWith(op.value)) {
        push("equal", op.value);
        push("added", next.value.slice(op.value.length));
        i++;
        continue;
      }
      if (op.value.startsWith(next.value)) {
        push("equal", next.value);
        push("removed", op.value.slice(next.value.length));
        i++;
        continue;
      }
    }
    push(op.kind, op.value);
  }
  return out;
}

/**
 * How natural the boundary between `left` and `right` is for an edit to start
 * or end at (higher is better), after diff-match-patch's
 * `diff_cleanupSemanticScore_`: blank lines, then line breaks, whitespace and
 * punctuation. The tokens beside the pair tell a blank line from a single line
 * break. Ties go to the later position, so an edit starts at a word rather
 * than at the space before it.
 */
function boundaryScore(
  beforeLeft: string | undefined,
  left: string,
  right: string,
  afterRight: string | undefined,
): number {
  const newline = (token?: string) => token != null && /^[\r\n]+$/.test(token);
  if (
    (newline(left) && newline(beforeLeft)) ||
    (newline(right) && newline(afterRight))
  ) {
    return 5;
  }
  if (newline(left) || newline(right)) return 4;
  if (/^\s+$/.test(left) || /^\s+$/.test(right)) return 2;
  const word = /^[\p{L}\p{N}_]/u;
  if (!word.test(left) || !word.test(right)) return 1;
  return 0;
}

/**
 * Slide each lone insertion/deletion between two equalities to its most
 * natural position — `one.\n[-two.\n-]three` rather than the equivalent
 * `one.\n[two.\n]three` split mid-line. diff-match-patch's own pass scores the
 * ENCODED token chars, so it can't see real boundaries; this repeats it a
 * whole token at a time (so it can never split a word) with real scores. The
 * equalities always keep a token, so the op structure is unchanged.
 */
function shiftEditsToBoundaries(
  diffs: [number, string][],
  tokens: readonly string[],
): void {
  const token = (chars: string, index: number): string | undefined =>
    tokens[chars.charCodeAt(index)];
  const boundary = (chars: string, at: number): number =>
    boundaryScore(
      token(chars, at - 2),
      token(chars, at - 1)!,
      token(chars, at)!,
      token(chars, at + 1),
    );
  const score = (before: string, edit: string, after: string): number => {
    const chars = before + edit + after;
    return (
      boundary(chars, before.length) +
      boundary(chars, before.length + edit.length)
    );
  };
  for (let i = 1; i < diffs.length - 1; i++) {
    if (diffs[i - 1]![0] !== 0 || diffs[i + 1]![0] !== 0) continue;
    let before = diffs[i - 1]![1];
    let edit = diffs[i]![1];
    let after = diffs[i + 1]![1];
    while (
      before.length > 1 &&
      before[before.length - 1] === edit[edit.length - 1]
    ) {
      const moved = edit[edit.length - 1]!;
      before = before.slice(0, -1);
      edit = moved + edit.slice(0, -1);
      after = moved + after;
    }
    let best = { before, edit, after, score: score(before, edit, after) };
    while (after.length > 1 && edit[0] === after[0]) {
      before += edit[0];
      edit = edit.slice(1) + after[0];
      after = after.slice(1);
      const candidate = score(before, edit, after);
      if (candidate >= best.score) {
        best = { before, edit, after, score: candidate };
      }
    }
    diffs[i - 1]![1] = best.before;
    diffs[i]![1] = best.edit;
    diffs[i + 1]![1] = best.after;
  }
}

/** Compute a character-level diff for source formats where every token matters. */
export function diffCharacters(
  original: string,
  modified: string,
): WordDiffOp[] {
  if (original === modified) {
    return modified.length > 0 ? [{ kind: "equal", value: modified }] : [];
  }

  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(original, modified, false);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, value]) => ({
    kind:
      op === DIFF_INSERT
        ? ("added" as const)
        : op === DIFF_DELETE
          ? ("removed" as const)
          : ("equal" as const),
    value,
  }));
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
