// Anchor resolution and capture.
//
//   - resolveAnchor(article, anchor) -> DOM Range | null: find the Range whose
//     text matches `exact`, using `prefix`/`suffix` to disambiguate.
//   - captureAnchorFromSelection(article) -> TextQuoteAnchor | null: convert
//     the current selection into a TextQuoteSelector with ~80 chars of context.
//
// Both operate purely on text nodes within `article` (data-source-line attrs
// don't affect text content), so they're robust to the rendering pipeline.

import type { TextQuoteAnchor } from "../types";

/** Context length captured on either side of a new anchor. */
const CONTEXT_LEN = 80;

interface TextRun {
  node: Text;
  /** Index in the flattened text where this node starts. */
  start: number;
  /** Index in the flattened text where this node ends (exclusive). */
  end: number;
}

/** Collect all text-node "runs" inside `root` and the concatenated string. */
function flattenText(root: Element): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  let acc = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let n: Node | null = walker.nextNode();
  while (n) {
    const text = (n as Text).data;
    if (text.length > 0) {
      const start = acc.length;
      runs.push({ node: n as Text, start, end: start + text.length });
      acc += text;
    }
    n = walker.nextNode();
  }
  return { text: acc, runs };
}

/** Find the text-run + offset-within-node for a flattened-string offset. */
function locateOffset(
  runs: TextRun[],
  offset: number,
): { run: TextRun; nodeOffset: number } | null {
  // Binary search would be nicer but linear is fine for documents of our size.
  for (const run of runs) {
    if (offset >= run.start && offset <= run.end) {
      return { run, nodeOffset: offset - run.start };
    }
  }
  /* v8 ignore next 2 -- unreachable: callers pass in-bounds indexOf offsets, so only a degenerate empty-text root could miss */
  return null;
}

/**
 * Resolve a TextQuoteAnchor to a live DOM Range inside `root`, or null.
 *   1. If `exact` is non-empty, run the text-quote resolver.
 *   2. Otherwise, if the anchor carries a 1-based `line`, fall back to the
 *      block with the matching `data-source-line` (native ADO diff-line
 *      anchors that have no text quote).
 *   3. Else the anchor is orphaned.
 */
export function resolveAnchor(
  root: Element,
  anchor: TextQuoteAnchor,
): Range | null {
  if (anchor.exact.length > 0) {
    const quoted = resolveTextQuote(root, anchor);
    if (quoted) return quoted;
  }
  if (typeof anchor.line === "number" && anchor.line > 0) {
    return resolveLineAnchor(root, anchor.line, anchor.endLine ?? anchor.line);
  }
  return null;
}

/**
 * Tier-1/2 resolver: locate `exact` (optionally disambiguated by
 * `prefix`/`suffix`) within the flattened text of `root`.
 */
function resolveTextQuote(
  root: Element,
  anchor: TextQuoteAnchor,
): Range | null {
  const { text, runs } = flattenText(root);
  if (runs.length === 0) return null;

  const composite = anchor.prefix + anchor.exact + anchor.suffix;

  // Step 1: composite match — most reliable.
  let exactStart = -1;
  if (composite.length > anchor.exact.length) {
    const cIdx = text.indexOf(composite);
    if (cIdx >= 0) {
      exactStart = cIdx + anchor.prefix.length;
    }
  }

  // Step 2: bare exact + prefix/suffix scoring.
  if (exactStart < 0) {
    const candidates: number[] = [];
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(anchor.exact, from);
      if (idx < 0) break;
      candidates.push(idx);
      from = idx + 1;
    }
    if (candidates.length === 0) return null;
    // Score: count of matching prefix chars (trailing) + suffix chars (leading)
    // Best score wins; ties broken by smallest index (earliest match).
    let best = candidates[0]!;
    let bestScore = -1;
    for (const c of candidates) {
      const preActual = text.slice(Math.max(0, c - anchor.prefix.length), c);
      const sufActual = text.slice(
        c + anchor.exact.length,
        c + anchor.exact.length + anchor.suffix.length,
      );
      const preScore = commonSuffixLen(preActual, anchor.prefix);
      const sufScore = commonPrefixLen(sufActual, anchor.suffix);
      const score = preScore + sufScore;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    exactStart = best;
  }

  const exactEnd = exactStart + anchor.exact.length;
  const startLoc = locateOffset(runs, exactStart)!;
  const endLoc = locateOffset(runs, exactEnd)!;

  const range = document.createRange();
  range.setStart(startLoc.run.node, startLoc.nodeOffset);
  range.setEnd(endLoc.run.node, endLoc.nodeOffset);
  return range;
}

/**
 * True when `node` sits inside a rendered Mermaid diagram (`.emr-mermaid`).
 *
 * A diagram's internals are transient: before hydration the `.emr-mermaid`
 * placeholder holds a `<pre>` source fallback, and after hydration it holds the
 * rendered SVG whose `<text>` labels are regenerated on every render and are
 * absent from the pristine HTML anchors resolve against. A comment anchored
 * inside a diagram could therefore never durably resolve, so callers withhold
 * the "add comment" affordance there.
 */
export function isWithinMermaid(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest(".emr-mermaid") != null;
}

/**
 * Convert the current window selection to a TextQuoteAnchor.
 * Returns null if the selection is empty, not inside `root`, or inside a
 * rendered Mermaid diagram (whose transient labels can't be anchored).
 */
export function captureAnchorFromSelection(
  root: Element,
): TextQuoteAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  // A rendered Mermaid diagram's labels can't carry a durable anchor (see
  // `isWithinMermaid`), so withhold the comment affordance when the selection
  // sits inside one.
  if (isWithinMermaid(range.commonAncestorContainer)) return null;

  const raw = range.toString();
  if (!raw.trim()) return null;
  // Compute flattened-text offsets for start/end of the selection.
  const { text, runs } = flattenText(root);
  const rawStart = boundaryOffsetToFlat(
    runs,
    range.startContainer,
    range.startOffset,
  );
  const rawEnd = boundaryOffsetToFlat(
    runs,
    range.endContainer,
    range.endOffset,
  );
  /* v8 ignore next -- valid DOM ranges inside root resolve ordered boundary offsets */
  if (rawStart < 0 || rawEnd < rawStart) return null;

  // Trim the selection as represented by the article's flattened text, not
  // Range.toString(). Triple-click appends synthetic block separators (`\n\n`)
  // and often ends at child offset 0 on the next block element; those line
  // breaks do not exist in the durable rendered-text model. Double-click's
  // adjacent space does exist there, so it is still trimmed as before.
  const selectedText = text.slice(rawStart, rawEnd);
  /* v8 ignore next -- raw.trim() above already rejects textless selections; this guards browser-only synthetic separators */
  if (!selectedText.trim()) return null;
  const leadWs = selectedText.length - selectedText.trimStart().length;
  const trailWs = selectedText.length - selectedText.trimEnd().length;
  const exact = selectedText.slice(leadWs, selectedText.length - trailWs);

  // Shift the boundaries past the trimmed whitespace so prefix/suffix align.
  const startOffset = rawStart + leadWs;
  const endOffset = rawEnd - trailWs;

  const prefix = text.slice(
    Math.max(0, startOffset - CONTEXT_LEN),
    startOffset,
  );
  const suffix = text.slice(
    endOffset,
    Math.min(text.length, endOffset + CONTEXT_LEN),
  );

  const result: TextQuoteAnchor = { exact, prefix, suffix };

  // Robust source-line capture straight from the DOM. The renderer stamps
  // `data-source-line` on every block AND inline element, so the nearest
  // ancestor of each selection boundary tells us the source line directly —
  // no fragile text-matching of the rendered string against the raw Markdown
  // (which breaks when the selection crosses inline syntax like ** or ``).
  // `withSourceLocation` later refines this to a precise line+column when the
  // quote resolves verbatim; when it can't, this block-level line survives so
  // the comment still anchors to the right line in native ADO views.
  const selectedRuns = runs.filter(
    (run) => run.end > startOffset && run.start < endOffset,
  );
  const startLine = sourceLineFromNode(selectedRuns[0]!.node);
  if (typeof startLine === "number") {
    const endLine = sourceLineFromNode(
      selectedRuns[selectedRuns.length - 1]!.node,
    );
    result.line = startLine;
    result.endLine =
      typeof endLine === "number" ? Math.max(startLine, endLine) : startLine;
  }

  return result;
}

/**
 * Walk up from a selection-boundary text node to the nearest element carrying a
 * `data-source-line` attribute and return that 1-based line, or undefined.
 * Callers only reach this with text-node boundaries (element boundaries are
 * rejected earlier), so we start from the parent element.
 */
function sourceLineFromNode(node: Node): number | undefined {
  let el: Element | null = node.parentElement;
  while (el) {
    const raw = el.getAttribute("data-source-line");
    if (raw != null) {
      const n = Number.parseInt(raw, 10);
      /* v8 ignore next -- parseInt of a present numeric attribute is always finite */
      if (Number.isFinite(n)) return n;
    }
    el = el.parentElement;
  }
  return undefined;
}

/**
 * Enrich a text-quote anchor with source line/column coordinates by locating
 * the selected text in the raw markdown source.
 */
export function withSourceLocation(
  anchor: TextQuoteAnchor,
  source: string,
): TextQuoteAnchor {
  if (!anchor.exact || anchor.exact.length === 0) return anchor;
  const span = findTextQuoteOffsets(source, anchor);
  if (!span) return anchor;
  const start = offsetToLineColumn(source, span.start);
  // `span.end` is exclusive; endColumn is inclusive.
  const end = offsetToLineColumn(source, Math.max(span.start, span.end - 1));
  return {
    ...anchor,
    line: start.line,
    endLine: end.line,
    column: start.column,
    endColumn: end.column,
  };
}

interface TextSpan {
  start: number;
  end: number;
}

/**
 * Normalize CRLF/CR line endings to LF, returning the normalized string plus a
 * map from each normalized offset to the corresponding original-source offset.
 * `map` has length `normalized.length + 1`; the final entry maps the exclusive
 * end to `src.length`.
 */
function normalizeSourceForMatching(src: string): {
  normalized: string;
  map: number[];
} {
  let normalized = "";
  const map: number[] = [];
  for (let i = 0; i < src.length; ) {
    const ch = src[i]!;
    if (ch === "\r") {
      normalized += "\n";
      map.push(i);
      i += i + 1 < src.length && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    normalized += ch;
    map.push(i);
    i += 1;
  }
  map.push(src.length);
  return { normalized, map };
}

/** Collapse CRLF/CR to LF (for DOM-captured quote text vs. raw source). */
function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Find the [start, end) offsets of a text-quote anchor in a plain string.
 * Uses the same composite-then-scored matching strategy as the DOM resolver.
 *
 * Line endings are normalized to LF for matching: DOM-captured quote text uses
 * `\n` while a CRLF source has `\r\n`, so matching against the raw source would
 * otherwise fail and the thread would fall back to the default position. The
 * matched offsets are mapped back to the original source so line/column math
 * stays correct.
 */
function findTextQuoteOffsets(
  text: string,
  anchor: TextQuoteAnchor,
): TextSpan | null {
  const { normalized, map } = normalizeSourceForMatching(text);
  const exact = normalizeNewlines(anchor.exact);
  const prefix = normalizeNewlines(anchor.prefix);
  const suffix = normalizeNewlines(anchor.suffix);
  const composite = prefix + exact + suffix;

  // Step 1: exact composite match.
  let exactStart = -1;
  if (composite.length > exact.length) {
    const cIdx = normalized.indexOf(composite);
    if (cIdx >= 0) exactStart = cIdx + prefix.length;
  }

  // Step 2: exact-only candidates scored by prefix/suffix overlap.
  if (exactStart < 0) {
    const candidates: number[] = [];
    let from = 0;
    while (from <= normalized.length) {
      const idx = normalized.indexOf(exact, from);
      if (idx < 0) break;
      candidates.push(idx);
      from = idx + 1;
    }
    if (candidates.length === 0) return null;

    let best = candidates[0]!;
    let bestScore = -1;
    for (const c of candidates) {
      const preActual = normalized.slice(Math.max(0, c - prefix.length), c);
      const sufActual = normalized.slice(
        c + exact.length,
        c + exact.length + suffix.length,
      );
      const score =
        commonSuffixLen(preActual, prefix) + commonPrefixLen(sufActual, suffix);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    exactStart = best;
  }

  // Map normalized offsets back to the original source.
  return { start: map[exactStart]!, end: map[exactStart + exact.length]! };
}

/** Convert a zero-based string offset to a 1-based (line, column) pair. */
function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  let lineIdx = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    const start = lineStarts[i]!;
    const next = i + 1 < lineStarts.length ? lineStarts[i + 1]! : Infinity;
    if (offset >= start && offset < next) {
      lineIdx = i;
      break;
    }
  }
  const lineStart = lineStarts[lineIdx]!;
  return { line: lineIdx + 1, column: offset - lineStart + 1 };
}

function boundaryOffsetToFlat(
  runs: TextRun[],
  node: Node,
  offsetInNode: number,
): number {
  if (node instanceof Text) {
    for (const run of runs) {
      if (run.node === node) return run.start + offsetInNode;
    }
    /* v8 ignore next -- root containment guarantees selected text nodes occur in runs */
    return -1;
  }

  // Element boundary offsets point between child nodes. Map to the first text
  // run at/after that boundary; if none follows, map just after the last text
  // run before it. This is the shape Chromium uses for triple-click selections.
  for (let index = offsetInNode; index < node.childNodes.length; index++) {
    const child = node.childNodes[index]!;
    const next = runs.find((run) => child.contains(run.node));
    if (next) return next.start;
  }
  for (let index = offsetInNode - 1; index >= 0; index--) {
    const child = node.childNodes[index]!;
    const previous = [...runs]
      .reverse()
      .find((run) => child.contains(run.node));
    if (previous) return previous.end;
  }

  // Empty inline wrappers can themselves be range boundaries. Lift the point
  // to the equivalent boundary in the parent and continue toward the root.
  const parent = node.parentNode;
  /* v8 ignore next -- a valid selection boundary inside root always has a parent */
  if (parent) {
    const index = Array.prototype.indexOf.call(
      parent.childNodes,
      node,
    ) as number;
    return boundaryOffsetToFlat(
      runs,
      parent,
      offsetInNode === 0 ? index : index + 1,
    );
  }
  /* v8 ignore next -- defensive fallback for a detached non-Text boundary */
  return -1;
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

// ---------------------------------------------------------------------------
// Line-based fallback (native ADO diff-line anchors)
// ---------------------------------------------------------------------------

/**
 * Block-level tags that carry meaningful `data-source-line` ranges. Anchoring
 * a whole block reads better than wrapping a stray inline fragment.
 */
const LINE_ANCHOR_BLOCK_SELECTOR =
  "p, li, pre, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, img";

function lineAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  /* v8 ignore next -- parseInt of a present numeric attribute is always finite */
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a 1-based source line range to a Range over the rendered block(s)
 * that own those lines, via the `data-source-line` / `data-source-end-line`
 * attributes. Picks the most specific block at each end; falls back to the
 * first block at/after the line, then the last block.
 */
function resolveLineAnchor(
  root: Element,
  startLine: number,
  endLine: number,
): Range | null {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(LINE_ANCHOR_BLOCK_SELECTOR),
  );
  if (blocks.length === 0) return null;

  // Most-specific block (largest start) whose [s, e] range contains `line`.
  const mostSpecificAt = (line: number): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let bestStart = -1;
    for (const el of blocks) {
      const s = lineAttr(el, "data-source-line");
      const e = lineAttr(el, "data-source-end-line");
      if (s == null || e == null) continue;
      if (s <= line && line <= e && s > bestStart) {
        best = el;
        bestStart = s;
      }
    }
    return best;
  };

  const startEl = mostSpecificAt(startLine);
  const endEl = endLine > startLine ? mostSpecificAt(endLine) : startEl;

  if (startEl) {
    // Span from the start block to the end block when both resolve and the
    // end block follows the start block in document order; otherwise anchor
    // to the single resolved block.
    if (
      endEl &&
      endEl !== startEl &&
      startEl.compareDocumentPosition(endEl) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      return rangeAcrossElements(startEl, endEl);
    }
    return rangeOverElementText(startEl);
  }

  // No block spans the line — anchor to the first block that begins at or
  // after it so the balloon lands near the right place.
  let fallback: HTMLElement | null = null;
  for (const el of blocks) {
    const s = lineAttr(el, "data-source-line");
    if (s != null && s >= startLine) {
      fallback = el;
      break;
    }
  }
  const resolved = fallback ?? blocks[blocks.length - 1]!;
  return rangeOverElementText(resolved);
}

/** Build a Range spanning from the first text of `startEl` to the last of `endEl`. */
function rangeAcrossElements(startEl: Element, endEl: Element): Range | null {
  const start = firstLastText(startEl);
  const end = firstLastText(endEl);
  if (!start || !end) {
    // One side has no text — fall back to selecting both nodes.
    const r = document.createRange();
    r.setStartBefore(startEl);
    r.setEndAfter(endEl);
    return r;
  }
  const range = document.createRange();
  range.setStart(start.first, 0);
  range.setEnd(end.last, end.last.data.length);
  return range;
}

/** First and last text nodes inside `el`, or null if it has none. */
function firstLastText(el: Element): { first: Text; last: Text } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const first = walker.nextNode() as Text | null;
  if (!first) return null;
  let last: Text = first;
  let n: Node | null = first;
  while ((n = walker.nextNode())) last = n as Text;
  return { first, last };
}

/** Build a Range spanning all the text inside `el` (first → last text node). */
function rangeOverElementText(el: Element): Range | null {
  const fl = firstLastText(el);
  if (!fl) {
    // No text content (e.g. a bare image) — select the element itself so the
    // caller can at least measure its position.
    const r = document.createRange();
    r.selectNode(el);
    return r;
  }
  const range = document.createRange();
  range.setStart(fl.first, 0);
  range.setEnd(fl.last, fl.last.data.length);
  return range;
}
