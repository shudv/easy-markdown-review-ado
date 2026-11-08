// Anchor resolution and capture.
//
//   - resolveAnchor(article, anchor) -> DOM Range | null: find the Range whose
//     text matches `exact`, using `prefix`/`suffix` to disambiguate.
//   - captureAnchorFromSelection(article) -> TextQuoteAnchor | null: convert
//     the current selection into a TextQuoteSelector with ~80 chars of context.
//
// Both operate purely on text nodes within `article` (data-source-line attrs
// don't affect text content), so they're robust to the rendering pipeline.

import { numAttr } from "../markdown/diffDecorations/shared";
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
    // Stryker disable next-line ArrayDeclaration: a stray non-run entry has no node or offsets, so every run lookup (find by end, contains, filter by overlap) passes over it
    const runs: TextRun[] = [];
    let acc = "";

    // The root's own document, so an inert (DOMParser) document works too.
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

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
function locateOffset(runs: TextRun[], offset: number): { run: TextRun; nodeOffset: number } {
    // Runs are contiguous from 0 and callers pass in-bounds match offsets, so
    // the first run ending at/after `offset` always contains it. Linear is fine
    // for documents of our size.
    const run = runs.find((candidate) => offset <= candidate.end)!;

    return { run, nodeOffset: offset - run.start };
}

/**
 * Resolve a TextQuoteAnchor to a live DOM Range inside `root`, or null.
 *   1. If `exact` is non-empty, run the text-quote resolver.
 *   2. Otherwise, if the anchor carries a 1-based `line`, fall back to the
 *      block with the matching `data-source-line` (native ADO diff-line
 *      anchors that have no text quote).
 *   3. Else the anchor is orphaned.
 */
export function resolveAnchor(root: Element, anchor: TextQuoteAnchor): Range | null {
    if (anchor.exact.length > 0) {
        const quoted = resolveTextQuote(root, anchor);
        if (quoted) return quoted;
    }

    // Stryker disable next-line ConditionalExpression: dead code: `line` is typed as an optional number, and an absent one already fails the `> 0` check, candidate for removal
    if (typeof anchor.line === "number" && anchor.line > 0) {
        return resolveLineAnchor(root, anchor.line, anchor.endLine ?? anchor.line);
    }

    return null;
}

/**
 * Tier-1/2 resolver: locate `exact` (optionally disambiguated by
 * `prefix`/`suffix`) within the flattened text of `root`.
 */
function resolveTextQuote(root: Element, anchor: TextQuoteAnchor): Range | null {
    const match = matchTextQuote(root, anchor);
    if (!match) return null;
    const start = locateOffset(match.runs, match.start);
    const end = locateOffset(match.runs, match.end);
    const range = document.createRange();
    range.setStart(start.run.node, start.nodeOffset);
    range.setEnd(end.run.node, end.nodeOffset);

    return range;
}

/** Where a text quote sits in `root`'s flattened text (`end` exclusive). */
function matchTextQuote(
    root: Element,
    anchor: TextQuoteAnchor,
): { start: number; end: number; runs: TextRun[] } | null {
    const { text, runs } = flattenText(root);
    // Stryker disable next-line ConditionalExpression: dead code: with no text the quote search below finds nothing and returns null anyway, candidate for removal
    if (runs.length === 0) return null;

    const exactStart = findQuoteStart(text, anchor);
    if (exactStart < 0) return null;

    return {
        start: exactStart,
        end: exactStart + anchor.exact.length,
        runs,
    };
}

/**
 * Start offset of `quote.exact` in `text`, or -1 when it doesn't occur.
 * Shared by the DOM resolver and the source-text matcher:
 *   1. composite (`prefix + exact + suffix`) match — most reliable;
 *   2. otherwise every bare `exact` occurrence, scored by prefix/suffix overlap.
 */
function findQuoteStart(
    text: string,
    quote: Pick<TextQuoteAnchor, "exact" | "prefix" | "suffix">,
): number {
    // Stryker disable ArithmeticOperator,ConditionalExpression,EqualityOperator,BlockStatement: dead code: a redundant fast path — the scored search below gives an occurrence with its full context the top score and breaks ties by earliest index, so it lands on the same offset, candidate for removal
    const composite = quote.prefix + quote.exact + quote.suffix;

    if (composite.length > quote.exact.length) {
        const cIdx = text.indexOf(composite);
        if (cIdx >= 0) return cIdx + quote.prefix.length;
    }

    // Stryker restore ArithmeticOperator,ConditionalExpression,EqualityOperator,BlockStatement

    return bestScoredOccurrence(text, quote);
}

/** Every start offset at which `needle` occurs in `text` (overlaps included). */
function occurrencesOf(text: string, needle: string): number[] {
    const candidates: number[] = [];
    let from = 0;

    // Stryker disable next-line EqualityOperator: searching from the very end can only find an empty needle, and quotes are never empty here
    while (from <= text.length) {
        const idx = text.indexOf(needle, from);
        if (idx < 0) break;
        candidates.push(idx);
        from = idx + 1;
    }

    return candidates;
}

/**
 * Bare `exact` occurrence whose surroundings best match the quote's context,
 * or -1 when `exact` doesn't occur. Score: count of matching prefix chars
 * (trailing) + suffix chars (leading). Best score wins; ties broken by
 * smallest index (earliest match).
 */
function bestScoredOccurrence(
    text: string,
    quote: Pick<TextQuoteAnchor, "exact" | "prefix" | "suffix">,
): number {
    const { exact, prefix, suffix } = quote;
    let best = -1;
    let bestScore = -1;

    for (const c of occurrencesOf(text, exact)) {
        const preActual = text.slice(Math.max(0, c - prefix.length), c);

        const sufActual = text.slice(c + exact.length, c + exact.length + suffix.length);

        const score = commonSuffixLen(preActual, prefix) + commonPrefixLen(sufActual, suffix);

        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }

    return best;
}

/**
 * Source lines of the text between two flattened-text offsets, from the
 * renderer's `data-source-line` stamps on the runs that actually overlap it
 * (a boundary offset also touches the end of the previous run, whose line may
 * belong to an earlier block). Empty when the HTML carries no source lines.
 */
function sourceLinesOf(
    runs: readonly TextRun[],
    start: number,
    end: number,
): Pick<TextQuoteAnchor, "line" | "endLine"> {
    const overlapping = runs.filter((run) => run.end > start && run.start < end);

    const line = sourceLineFromNode(overlapping[0]!.node);
    if (typeof line !== "number") return {};

    const endLine = sourceLineFromNode(overlapping[overlapping.length - 1]!.node);

    return {
        line,
        endLine: typeof endLine === "number" ? Math.max(line, endLine) : line,
    };
}

/**
 * Re-locate a text-quote anchor in another rendering of the same document —
 * HTML from the same renderer, e.g. the LATEST version of a file while the
 * selection was made in an older PR update. Returns the anchor with source
 * lines taken from that rendering (so a comment is positioned against it), or
 * `null` when the quoted text doesn't occur there. Parses into an inert
 * document, so nothing in the HTML (images, media) loads.
 */
export function relocateAnchor(anchor: TextQuoteAnchor, html: string): TextQuoteAnchor | null {
    if (!anchor.exact) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const match = matchTextQuote(doc.body, anchor);
    if (!match) return null;

    return {
        exact: anchor.exact,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        ...sourceLinesOf(match.runs, match.start, match.end),
    };
}

/** True when generated diagram/equation internals cannot hold durable anchors. */
export function isWithinGeneratedContent(node: Node): boolean {
    const el = node instanceof Element ? node : node.parentElement;

    // `.emr-math` covers the pre-hydration and load-failure source fallback, not
    // just KaTeX output — that text is replaced once hydration succeeds, so an
    // anchor placed on it would orphan. Mirrors `.emr-mermaid`, which wraps its
    // own fallback. `.emr-wiki-macro` is a generated table of contents/subpages.
    return el?.closest(".emr-mermaid, .emr-math, .katex, .emr-wiki-macro") != null;
}

/**
 * Convert the current window selection to a TextQuoteAnchor.
 * Returns null if the selection is empty, not inside `root`, or inside
 * generated diagram/equation markup whose text cannot be durably anchored.
 */
export function captureAnchorFromSelection(root: Element): TextQuoteAnchor | null {
    const sel = window.getSelection();
    // Stryker disable next-line ConditionalExpression,LogicalOperator: dead code: getSelection() is never null for the page document, a selection with no range reports isCollapsed, and a collapsed range has no text, which the blank-text check below rejects, candidate for removal
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    // Generated labels/glyphs do not map durably back to Markdown source text.
    if (isWithinGeneratedContent(range.commonAncestorContainer)) return null;

    const raw = range.toString();
    if (!raw.trim()) return null;
    // Compute flattened-text offsets for start/end of the selection.
    const { text, runs } = flattenText(root);

    const rawStart = boundaryOffsetToFlat(runs, range.startContainer, range.startOffset);

    const rawEnd = boundaryOffsetToFlat(runs, range.endContainer, range.endOffset);

    // An empty Text node has no run, so a boundary inside one maps to -1.
    // Stryker disable next-line EqualityOperator: dead code: the range holds non-blank text from the article's own text runs, so its end always maps strictly after its start, candidate for removal
    if (rawStart < 0 || rawEnd < rawStart) return null;

    // Trim the selection as represented by the article's flattened text, not
    // Range.toString(). Triple-click appends synthetic block separators (`\n\n`)
    // and often ends at child offset 0 on the next block element; those line
    // breaks do not exist in the durable rendered-text model. Double-click's
    // adjacent space does exist there, so it is still trimmed as before. The
    // slice holds exactly the range's Text data, so it is non-blank like `raw`.
    const selectedText = text.slice(rawStart, rawEnd);
    const leadWs = selectedText.length - selectedText.trimStart().length;
    const trailWs = selectedText.length - selectedText.trimEnd().length;
    const exact = selectedText.slice(leadWs, selectedText.length - trailWs);

    // Shift the boundaries past the trimmed whitespace so prefix/suffix align.
    const startOffset = rawStart + leadWs;
    const endOffset = rawEnd - trailWs;

    const prefix = text.slice(Math.max(0, startOffset - CONTEXT_LEN), startOffset);

    const suffix = text.slice(endOffset, Math.min(text.length, endOffset + CONTEXT_LEN));

    return {
        exact,
        prefix,
        suffix,
        // Robust source-line capture straight from the DOM. The renderer stamps
        // `data-source-line` on every block AND inline element, so the nearest
        // stamped ancestor of the selected text gives its source line directly —
        // no fragile text-matching of the rendered string against the raw
        // Markdown (which breaks when the selection crosses inline syntax like **
        // or ``). `withSourceLocation` later refines this to a precise line+column
        // when the quote resolves verbatim; when it can't, this block-level line
        // survives so the comment still anchors to the right line in native ADO
        // views.
        ...sourceLinesOf(runs, startOffset, endOffset),
    };
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

        // Stryker disable next-line ConditionalExpression: dead code: parseInt(null) is NaN, which the isFinite check already skips, candidate for removal
        if (raw != null) {
            const n = Number.parseInt(raw, 10);
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
export function withSourceLocation(anchor: TextQuoteAnchor, source: string): TextQuoteAnchor {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: dead code: `exact` is always a string, so "falsy" and "empty" are the same test, candidate for removal
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

    // Stryker disable next-line EqualityOperator: one extra pass only appends text past the end of the source, where a quote taken from the rendered document never lands
    for (let i = 0; i < src.length; ) {
        const ch = src[i]!;

        if (ch === "\r") {
            normalized += "\n";
            map.push(i);
            // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator: reading past the end yields undefined, which is never "\n", so the bounds check can be dropped or loosened
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
    // Stryker disable next-line StringLiteral: dead code: quotes are captured from rendered DOM text, which never contains "\r", so these replacements never fire, candidate for removal
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
function findTextQuoteOffsets(text: string, anchor: TextQuoteAnchor): TextSpan | null {
    const { normalized, map } = normalizeSourceForMatching(text);
    const exact = normalizeNewlines(anchor.exact);

    const exactStart = findQuoteStart(normalized, {
        exact,
        prefix: normalizeNewlines(anchor.prefix),
        suffix: normalizeNewlines(anchor.suffix),
    });

    if (exactStart < 0) return null;

    // Map normalized offsets back to the original source.
    return { start: map[exactStart]!, end: map[exactStart + exact.length]! };
}

/** Convert a zero-based string offset to a 1-based (line, column) pair. */
function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
    const lineStarts = [0];

    // Stryker disable next-line EqualityOperator: text[text.length] is undefined, never "\n"
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") lineStarts.push(i + 1);
    }

    let lineIdx = 0;

    // Stryker disable next-line EqualityOperator: the last line has no upper bound, so the loop always breaks before running past it
    for (let i = 0; i < lineStarts.length; i++) {
        const start = lineStarts[i]!;
        const next = i + 1 < lineStarts.length ? lineStarts[i + 1]! : Infinity;

        // Stryker disable next-line ConditionalExpression: dead code: lines are scanned in ascending order, so the first line whose successor starts after `offset` already contains it, candidate for removal
        if (offset >= start && offset < next) {
            lineIdx = i;
            break;
        }
    }

    const lineStart = lineStarts[lineIdx]!;

    return { line: lineIdx + 1, column: offset - lineStart + 1 };
}

function boundaryOffsetToFlat(runs: TextRun[], node: Node, offsetInNode: number): number {
    if (node instanceof Text) {
        for (const run of runs) {
            if (run.node === node) return run.start + offsetInNode;
        }

        // Empty Text nodes are skipped by flattenText, so they have no run.
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

    // Stryker disable next-line EqualityOperator: skipping the first child only lifts the boundary to the parent, and flat text is contiguous, so the end of the run before equals the start of the run after
    for (let index = offsetInNode - 1; index >= 0; index--) {
        const child = node.childNodes[index]!;

        const previous = [...runs].reverse().find((run) => child.contains(run.node));

        if (previous) return previous.end;
    }

    // Empty inline wrappers can themselves be range boundaries. Lift the point
    // to the equivalent boundary in the parent and continue toward the root.
    // The caller only passes boundaries inside a root holding a non-blank text
    // run, so the scans above always succeed by the time the lift reaches root.
    const parent = node.parentNode!;

    const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;

    // Stryker disable next-line ConditionalExpression,EqualityOperator: dead code: this node holds no text runs, so the points just before and just after it map to the same flat offset, candidate for removal
    return boundaryOffsetToFlat(runs, parent, offsetInNode === 0 ? index : index + 1);
}

function commonPrefixLen(a: string, b: string): number {
    // Stryker disable next-line MethodExpression: past the shorter string one side is undefined, which never equals a character, so the loop stops at the same point
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;

    return i;
}

function commonSuffixLen(a: string, b: string): number {
    // Stryker disable next-line MethodExpression: past the shorter string one side is undefined, which never equals a character, so the loop stops at the same point
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

/**
 * Resolve a 1-based source line range to a Range over the rendered block(s)
 * that own those lines, via the `data-source-line` / `data-source-end-line`
 * attributes. Picks the most specific block at each end; falls back to the
 * first block at/after the line, then the last block.
 */
function resolveLineAnchor(root: Element, startLine: number, endLine: number): Range | null {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(LINE_ANCHOR_BLOCK_SELECTOR));

    if (blocks.length === 0) return null;

    // Most-specific block (largest start) whose [s, e] range contains `line`.
    const mostSpecificAt = (line: number): HTMLElement | null => {
        let best: HTMLElement | null = null;
        let bestStart = -1;

        for (const el of blocks) {
            const s = numAttr(el, "data-source-line");
            const e = numAttr(el, "data-source-end-line");
            // Stryker disable next-line ConditionalExpression,LogicalOperator: the renderer stamps a block's start and end lines together from the same source map, so a block never has one without the other (and a missing end line already fails `line <= e`)
            if (s == null || e == null) continue;

            if (s <= line && line <= e && s > bestStart) {
                best = el;
                bestStart = s;
            }
        }

        return best;
    };

    const startEl = mostSpecificAt(startLine);
    // Stryker disable next-line ConditionalExpression,EqualityOperator: dead code: looking up an end line that is not after the start line yields the start block or one before it, and both fall back to the single start block below, candidate for removal
    const endEl = endLine > startLine ? mostSpecificAt(endLine) : startEl;

    if (startEl) {
        // Span from the start block to the end block when both resolve and the
        // end block follows the start block in document order; otherwise anchor
        // to the single resolved block.
        if (
            endEl &&
            // Stryker disable next-line ConditionalExpression: dead code: a block never follows itself, so the document-position check below already rejects endEl === startEl, candidate for removal
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
        const s = numAttr(el, "data-source-line");

        // Stryker disable next-line ConditionalExpression: dead code: a null start line compares as 0, which is never at or after a 1-based line, candidate for removal
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
    let n: Node | null;
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
