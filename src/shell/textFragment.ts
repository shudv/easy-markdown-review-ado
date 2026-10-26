// Shareable links to a span of selected text (`?text=` deep links).
//
// The link value uses the browser's URL text-fragment syntax
// (`[prefix-,]start[,end][,-suffix]`, as in `#:~:text=`), so it reads naturally
// and stays short:
//   • a short selection is quoted whole (`start`);
//   • a long one is quoted by its first and last few words (`start,end`);
//   • `prefix-` / `-suffix` context words are added only when the quote alone
//     would match an earlier occurrence in the document.
//
// Matching ignores whitespace and letter case, so it is robust to how the
// renderer splits text across blocks and inline elements. Reference copies of
// content (removed diff blocks, "Before" panels) and UI controls are skipped,
// both when building a link and when resolving one, so a link always lands on
// live document text.
//
// Pure DOM helpers (no React), unit-testable in jsdom; PrShell owns when they
// run.

import {
  DIFF_CELL_REMOVED_CLASS,
  DIFF_DELETED_MARKER_CLASS,
  DIFF_METADATA_CLASS,
  DIFF_SOURCE_ONLY_CLASS,
} from "../markdown/diffDecorations";
import { WORD_REMOVED_CLASS } from "../markdown/wordDiffDom";

/** A parsed text link: the quote (whole, or start…end) plus optional context. */
export interface TextFragment {
  prefix?: string;
  start: string;
  end?: string;
  suffix?: string;
}

/**
 * Text that is not live document content: what the PR diff shows of the
 * *previous* version (removed blocks and table rows, struck-out words spliced
 * into changed lines, removed table cells, "Before" disclosures, source-only
 * change markers, link-target change popovers) and injected controls (section
 * chevrons, heading link buttons, "</> Source" buttons). Excluding it means a
 * link quotes only the current text, so it resolves whether or not the diff
 * is shown — and the same link made with the diff hidden lands with it shown.
 */
const NON_CONTENT_SELECTOR = [
  `.${DIFF_DELETED_MARKER_CLASS}`,
  `.${WORD_REMOVED_CLASS}`,
  `.${DIFF_CELL_REMOVED_CLASS}`,
  `.${DIFF_SOURCE_ONLY_CLASS}`,
  `.${DIFF_METADATA_CLASS}`,
  ".emr-diff-before-panel",
  ".emr-diff-before-control",
  ".emr-diff-metadata-panel",
  "button",
].join(", ");

/** Quotes up to this many characters are linked whole; longer ones by start…end. */
const WHOLE_QUOTE_MAX = 80;
/** Rough length of the start / end word runs quoted for a long selection. */
const EDGE_QUOTE_CHARS = 30;
/** Context word counts tried, in order, until the link is unambiguous. */
const CONTEXT_WORD_STEPS = [0, 3, 6, 12];

interface TextRun {
  node: Text;
  start: number;
  end: number;
}

/** True when `node` is live document text (see {@link NON_CONTENT_SELECTOR}). */
export function isContentText(node: Text): boolean {
  return !node.parentElement?.closest(NON_CONTENT_SELECTOR);
}

function flatten(root: Element): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  let text = "";
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (node.data.length === 0 || !isContentText(node)) continue;
    runs.push({
      node,
      start: text.length,
      end: text.length + node.data.length,
    });
    text += node.data;
  }
  return { text, runs };
}

/** Case fold one character without changing its length. */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  return lower.length === ch.length ? lower : ch;
}

/**
 * Whitespace-free, case-folded form of `text` plus, for every key index, the
 * index in `text` it came from — so a match maps back to DOM positions.
 */
interface KeyIndex {
  key: string;
  at: number[];
}

function keyIndex(text: string): KeyIndex {
  let key = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    key += foldChar(ch);
    at.push(i);
  }
  return { key, at };
}

const matchKey = (text: string): string => keyIndex(text).key;

/** Flat-text [start, end) of the first match of `fragment`, or null. */
function matchFragment(
  { key, at }: KeyIndex,
  fragment: TextFragment,
): { start: number; end: number } | null {
  const startKey = matchKey(fragment.start);
  if (!startKey) return null;
  const endKey = fragment.end ? matchKey(fragment.end) : "";
  const prefixKey = fragment.prefix ? matchKey(fragment.prefix) : "";
  const suffixKey = fragment.suffix ? matchKey(fragment.suffix) : "";
  for (
    let i = key.indexOf(startKey);
    i >= 0;
    i = key.indexOf(startKey, i + 1)
  ) {
    if (
      prefixKey &&
      (i < prefixKey.length || !key.startsWith(prefixKey, i - prefixKey.length))
    ) {
      continue;
    }
    let stop = i + startKey.length;
    if (endKey) {
      let j = key.indexOf(endKey, stop);
      while (
        j >= 0 &&
        suffixKey &&
        !key.startsWith(suffixKey, j + endKey.length)
      ) {
        j = key.indexOf(endKey, j + 1);
      }
      if (j < 0) continue;
      stop = j + endKey.length;
    } else if (suffixKey && !key.startsWith(suffixKey, stop)) {
      continue;
    }
    return { start: at[i]!, end: at[stop - 1]! + 1 };
  }
  return null;
}

function toRange(
  doc: Document,
  runs: TextRun[],
  start: number,
  end: number,
): Range {
  const startRun = runs.find((r) => start >= r.start && start < r.end)!;
  const endRun = runs.find((r) => end > r.start && end <= r.end)!;
  const range = doc.createRange();
  range.setStart(startRun.node, start - startRun.start);
  range.setEnd(endRun.node, end - endRun.start);
  return range;
}

/**
 * Resolve a text link to a live Range inside `root`, or null when the text is
 * no longer in the document (e.g. edited since the link was made).
 */
export function findTextFragment(
  root: Element,
  fragment: TextFragment,
): Range | null {
  const { text, runs } = flatten(root);
  const hit = matchFragment(keyIndex(text), fragment);
  return hit ? toRange(root.ownerDocument, runs, hit.start, hit.end) : null;
}

/** Flat-text [start, end) covered by `range`, trimmed of outer whitespace. */
function rangeOffsets(
  runs: TextRun[],
  text: string,
  range: Range,
): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (const run of runs) {
    if (!range.intersectsNode(run.node)) continue;
    const from = range.startContainer === run.node ? range.startOffset : 0;
    const to =
      range.endContainer === run.node ? range.endOffset : run.node.data.length;
    if (to <= from) continue;
    if (start < 0) start = run.start + from;
    end = run.start + to;
  }
  if (start < 0) return null;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Leading words of `text` totalling at least `minChars` (whole words). */
function leadingWords(text: string, minChars: number): string {
  const words = collapse(text).split(" ");
  let out = "";
  for (const word of words) {
    out = out ? `${out} ${word}` : word;
    if (out.length >= minChars) break;
  }
  return out;
}

/** Trailing words of `text` totalling at least `minChars` (whole words). */
function trailingWords(text: string, minChars: number): string {
  const words = collapse(text).split(" ").reverse();
  let out = "";
  for (const word of words) {
    out = out ? `${word} ${out}` : word;
    if (out.length >= minChars) break;
  }
  return out;
}

function lastWords(text: string, count: number): string {
  if (count === 0) return "";
  return collapse(text).split(" ").slice(-count).join(" ");
}

function firstWords(text: string, count: number): string {
  if (count === 0) return "";
  return collapse(text).split(" ").slice(0, count).join(" ");
}

/**
 * Build the shortest text link that resolves back to `range` inside `root`.
 * Returns null for a selection with no live text (only whitespace, or only
 * removed/reference content).
 */
export function buildTextFragment(
  root: Element,
  range: Range,
): TextFragment | null {
  const { text, runs } = flatten(root);
  const own = rangeOffsets(runs, text, range);
  if (!own) return null;
  const quote = collapse(text.slice(own.start, own.end));
  let base: TextFragment = { start: quote };
  if (quote.length > WHOLE_QUOTE_MAX) {
    const start = leadingWords(quote, EDGE_QUOTE_CHARS);
    const end = trailingWords(quote, EDGE_QUOTE_CHARS);
    // A single huge "word" (e.g. a URL) can't be split; quote it whole.
    if (start.length + end.length < quote.length) base = { start, end };
  }
  const before = text.slice(0, own.start);
  const after = text.slice(own.end);
  const index = keyIndex(text);
  let fragment = base;
  for (const words of CONTEXT_WORD_STEPS) {
    const prefix = lastWords(before, words);
    const suffix = firstWords(after, words);
    fragment = {
      ...(prefix ? { prefix } : {}),
      ...base,
      ...(suffix ? { suffix } : {}),
    };
    const hit = matchFragment(index, fragment);
    if (hit && hit.start === own.start && hit.end === own.end) break;
  }
  return fragment;
}

/** Escape a fragment piece: `%` and `,` anywhere, `-` at either end. */
function encodePiece(piece: string): string {
  return piece
    .replace(/%/g, "%25")
    .replace(/,/g, "%2C")
    .replace(/^-/, "%2D")
    .replace(/-$/, "%2D");
}

/** Serialize to the `[prefix-,]start[,end][,-suffix]` link value. */
export function serializeTextFragment(fragment: TextFragment): string {
  const parts: string[] = [];
  if (fragment.prefix) parts.push(`${encodePiece(fragment.prefix)}-`);
  parts.push(encodePiece(fragment.start));
  if (fragment.end) parts.push(encodePiece(fragment.end));
  if (fragment.suffix) parts.push(`-${encodePiece(fragment.suffix)}`);
  return parts.join(",");
}

/**
 * Parse a `[prefix-,]start[,end][,-suffix]` link value. Returns null for a
 * blank or malformed value (bad escapes, missing quote, too many parts).
 */
export function parseTextFragment(value: string): TextFragment | null {
  const parts = value.split(",");
  let prefix: string | undefined;
  let suffix: string | undefined;
  if (parts.length > 1 && parts[0]!.endsWith("-")) {
    prefix = parts.shift()!.slice(0, -1);
  }
  if (parts.length > 1 && parts[parts.length - 1]!.startsWith("-")) {
    suffix = parts.pop()!.slice(1);
  }
  if (parts.length < 1 || parts.length > 2) return null;
  // The serializer escapes a quote's edge dashes, so a raw one is malformed.
  if (parts.some((part) => part.startsWith("-") || part.endsWith("-"))) {
    return null;
  }
  try {
    const decode = (piece: string): string => decodeURIComponent(piece).trim();
    const start = decode(parts[0]!);
    const end = parts[1] !== undefined ? decode(parts[1]) : undefined;
    if (!start || end === "") return null;
    const fragment: TextFragment = { start };
    if (end) fragment.end = end;
    const p = prefix !== undefined ? decode(prefix) : "";
    const s = suffix !== undefined ? decode(suffix) : "";
    if (p) fragment.prefix = p;
    if (s) fragment.suffix = s;
    return fragment;
  } catch {
    return null;
  }
}
