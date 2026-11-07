import type { DiffRange } from "../types";
import {
    MAX_ALIGNMENT_CELLS,
    alignChunks,
    chunkMarkdownLines,
    clipChunks,
    expandTablePairs,
    rowAlignable,
    trimBlankChunks,
    type DiffChunk,
} from "./diffChunks";

/**
 * Line diffs — ADO's `lineDiffBlocks` and our own line-level
 * diff_match_patch pass — report a rewrite as ONE coarse hunk: "these N old
 * lines became these M new lines". When a one-line placeholder grows into a
 * table and a nested list, every new block lands in the same `modified` hunk,
 * so the renderer paints them all as edits (amber) with no sensible "before"
 * to compare against.
 *
 * `refineDiffRanges` re-aligns changed regions at Markdown block granularity
 * using both sources:
 *
 * - hunks separated only by blank lines are merged into one region (a line
 *   diff anchors on blank lines and so splits one rewrite into hunks that pair
 *   unrelated blocks);
 * - each source is split into Markdown block chunks (a paragraph, list item,
 *   table, quote, heading, fenced block, or blank line), clipped to the region;
 * - chunks are aligned in order, pairing a new chunk with an old one only when
 *   their words are similar enough to read as an edit (a table whose header is
 *   unchanged is then aligned row by row);
 * - paired chunks become precise `modified` ranges with their own original
 *   text, unpaired new chunks become `added`, and unpaired old chunks become a
 *   `deleted-marker` carrying the removed text — unless a removed run and an
 *   added run have the same shape of blocks, which pair one for one as edits.
 *
 * Pure and SDK-free; returns the input unchanged when either source is missing
 * or the ranges don't fit the sources.
 */

interface SourceSide {
    lines: readonly string[];
    chunks: readonly DiffChunk[];
}

function sourceSide(source: string): SourceSide {
    const lines = source.split(/\r\n|\r|\n/);

    return { lines, chunks: chunkMarkdownLines(lines, 1) };
}

/** A changed region: current lines [start,end] replaced original lines. */
interface Span {
    startLine: number;
    endLine: number;
    originalStartLine: number;
    originalEndLine: number;
}

/** A modified range pairing a current chunk with its original chunk. */
function modifiedRange(before: DiffChunk, after: DiffChunk): DiffRange {
    return {
        startLine: after.start,
        endLine: after.end,
        kind: "modified",
        originalText: before.text,
        originalStartLine: before.start,
        originalEndLine: before.end,
        linesAdded: after.end - after.start + 1,
        linesDeleted: before.end - before.start + 1,
    };
}

/** Removed/added chunks between two paired chunks, emitted on flush. */
interface SpanRuns {
    out: DiffRange[];
    originalLines: readonly string[];
    removedRun: DiffChunk[];
    addedRun: DiffChunk[];
    nextCurrentLine: number;
}

/** Ranges for a removed run and an added run that don't pair one for one. */
function pushUnpairedRuns(
    runs: SpanRuns,
    removed: readonly DiffChunk[],
    added: readonly DiffChunk[],
): void {
    if (removed.length > 0) {
        const from = removed[0]!.start;
        const to = removed[removed.length - 1]!.end;
        const at = added.length > 0 ? added[0]!.start : runs.nextCurrentLine;
        runs.out.push({
            startLine: at,
            endLine: at,
            kind: "deleted-marker",
            deletedContent: runs.originalLines.slice(from - 1, to).join("\n"),
            linesAdded: 0,
            linesDeleted: to - from + 1,
        });
    }

    if (added.length > 0) {
        const from = added[0]!.start;
        const to = added[added.length - 1]!.end;
        runs.out.push({
            startLine: from,
            endLine: to,
            kind: "added",
            linesAdded: to - from + 1,
            linesDeleted: 0,
        });
    }
}

function flushRuns(runs: SpanRuns): void {
    const removed = trimBlankChunks(runs.removedRun);
    const added = trimBlankChunks(runs.addedRun);
    runs.removedRun = [];
    runs.addedRun = [];
    // Blocks replaced by the same shape of blocks (a heading and paragraph by
    // a heading and paragraph) still read as edits of them, one for one.
    const removedBlocks = removed.filter((chunk) => !chunk.blank);
    const addedBlocks = added.filter((chunk) => !chunk.blank);

    if (
        removedBlocks.length > 0 &&
        removedBlocks.length === addedBlocks.length &&
        removedBlocks.every((chunk, i) => chunk.kind === addedBlocks[i]!.kind)
    ) {
        removedBlocks.forEach((chunk, i) => runs.out.push(modifiedRange(chunk, addedBlocks[i]!)));

        return;
    }

    pushUnpairedRuns(runs, removed, added);
}

/**
 * One content block replaced by one content block is already as precise as
 * it gets — except a multi-row table whose rows can still be told apart.
 */
function isSingleBlockEdit(before: readonly DiffChunk[], after: readonly DiffChunk[]): boolean {
    const contentBefore = before.filter((chunk) => !chunk.blank);
    const contentAfter = after.filter((chunk) => !chunk.blank);

    return (
        contentBefore.length === 1 &&
        contentAfter.length === 1 &&
        (!rowAlignable(contentBefore[0]!, contentAfter[0]!) ||
            (contentBefore[0]!.start === contentBefore[0]!.end &&
                contentAfter[0]!.start === contentAfter[0]!.end))
    );
}

/**
 * Re-align a changed span block by block. Returns null when the span is too
 * large to align, or — for a span that was one line-diff hunk
 * (`keepSingleBlock`) — when it is already as precise as it gets: one block
 * for one block, except a multi-row table whose rows can still be told apart.
 */
function refineSpan(
    span: Span,
    original: SourceSide,
    current: SourceSide,
    keepSingleBlock: boolean,
): DiffRange[] | null {
    const before = clipChunks(
        original.chunks,
        original.lines,
        span.originalStartLine,
        span.originalEndLine,
    );

    const after = clipChunks(current.chunks, current.lines, span.startLine, span.endLine);

    if (keepSingleBlock && isSingleBlockEdit(before, after)) return null;
    if (before.length * after.length > MAX_ALIGNMENT_CELLS) return null;

    const runs: SpanRuns = {
        out: [],
        originalLines: original.lines,
        removedRun: [],
        addedRun: [],
        nextCurrentLine: span.startLine,
    };

    for (const op of expandTablePairs(alignChunks(before, after))) {
        if (op.type === "removed") {
            runs.removedRun.push(op.before);
            continue;
        }

        if (op.type === "added") {
            runs.addedRun.push(op.after);
            runs.nextCurrentLine = op.after.end + 1;
            continue;
        }

        flushRuns(runs);
        runs.nextCurrentLine = op.after.end + 1;

        if (op.type === "pair") {
            runs.out.push(modifiedRange(op.before, op.after));
        }
    }

    flushRuns(runs);

    return runs.out;
}

/** A diff range with its position on both sides of the comparison. */
interface PlacedRange {
    range: DiffRange;
    /** Current-side span; empty (`end < start`) for a deletion. */
    start: number;
    end: number;
    /** Original-side span; empty (`end < start`) for an addition. */
    originalStart: number;
    originalEnd: number;
}

/**
 * Place every range on both sides by walking the unchanged gaps between them
 * (an unchanged line keeps a constant offset between the two sources).
 * Returns null when the ranges don't agree with the sources, so the caller
 * can fall back to refining each hunk on its own.
 */
function placeRanges(ranges: readonly DiffRange[], original: SourceSide): PlacedRange[] | null {
    const placed: PlacedRange[] = [];
    let offset = 0;
    let previousEnd = 0;

    for (const range of ranges) {
        if (range.startLine <= previousEnd) return null;
        const originalStart = range.startLine + offset;

        if (range.kind === "modified") {
            if (range.originalStartLine !== originalStart) return null;
            placed.push({
                range,
                start: range.startLine,
                end: range.endLine,
                originalStart,
                originalEnd: range.originalEndLine!,
            });
            offset = range.originalEndLine! - range.endLine;
            previousEnd = range.endLine;
        } else if (range.kind === "added") {
            placed.push({
                range,
                start: range.startLine,
                end: range.endLine,
                originalStart,
                originalEnd: originalStart - 1,
            });
            offset = originalStart - 1 - range.endLine;
            previousEnd = range.endLine;
        } else {
            const deleted = range.linesDeleted ?? 0;
            const originalEnd = originalStart + deleted - 1;

            if (
                deleted < 1 ||
                originalEnd > original.lines.length ||
                (range.deletedContent != null &&
                    original.lines.slice(originalStart - 1, originalEnd).join("\n") !==
                        range.deletedContent.split(/\r\n|\r|\n/).join("\n"))
            ) {
                return null;
            }

            placed.push({
                range,
                start: range.startLine,
                end: range.startLine - 1,
                originalStart,
                originalEnd,
            });
            offset = originalEnd - (range.startLine - 1);
            previousEnd = range.startLine - 1;
        }
    }

    return placed;
}

/** True when every line in [from,to] is blank (an empty window counts). */
function allBlank(lines: readonly string[], from: number, to: number): boolean {
    if (to > lines.length) return false;

    for (let line = from; line <= to; line++) {
        if (lines[line - 1]!.trim() !== "") return false;
    }

    return true;
}

/**
 * Group placed ranges that are separated only by blank lines. A line diff
 * anchors on blank lines, splitting one rewritten region into hunks that pair
 * unrelated blocks; aligning the whole region at once undoes that.
 */
function clusterRanges(placed: readonly PlacedRange[], current: SourceSide): PlacedRange[][] {
    const clusters: PlacedRange[][] = [];

    for (const item of placed) {
        const cluster = clusters.length > 0 ? clusters[clusters.length - 1] : undefined;

        const last = cluster?.[cluster.length - 1];

        if (last && allBlank(current.lines, last.end + 1, item.start - 1)) {
            cluster!.push(item);
        } else {
            clusters.push([item]);
        }
    }

    return clusters;
}

/** Refine one cluster, or return its ranges unchanged. */
function refineCluster(
    cluster: readonly PlacedRange[],
    original: SourceSide,
    current: SourceSide,
): DiffRange[] {
    const ranges = cluster.map((item) => item.range);
    const first = cluster[0]!;
    const last = cluster[cluster.length - 1]!;

    const span: Span = {
        startLine: first.start,
        endLine: last.end,
        originalStartLine: first.originalStart,
        originalEndLine: last.originalEnd,
    };

    // Only a region that both lost and gained lines can be re-paired.
    if (
        span.endLine < span.startLine ||
        span.originalEndLine < span.originalStartLine ||
        !(
            ranges.some((range) => range.kind === "modified") ||
            (ranges.some((range) => range.kind === "added") &&
                ranges.some((range) => range.kind === "deleted-marker"))
        )
    ) {
        return ranges;
    }

    return refineSpan(span, original, current, ranges.length === 1) ?? ranges;
}

/**
 * Re-align coarse line-diff hunks at Markdown block granularity (see the
 * module comment). Untouched ranges pass through as they are.
 */
export function refineDiffRanges(
    ranges: readonly DiffRange[],
    originalSource: string | undefined,
    currentSource: string | undefined,
): DiffRange[] {
    if (
        originalSource == null ||
        currentSource == null ||
        !ranges.some((range) => range.kind !== "deleted-marker")
    ) {
        return [...ranges];
    }

    const original = sourceSide(originalSource);
    const current = sourceSide(currentSource);

    const inBounds = ranges.every(
        (range) =>
            range.startLine >= 1 &&
            range.endLine >= range.startLine &&
            (range.kind === "deleted-marker" || range.endLine <= current.lines.length) &&
            (range.kind !== "modified" ||
                (range.originalStartLine != null &&
                    range.originalEndLine != null &&
                    range.originalStartLine >= 1 &&
                    range.originalEndLine >= range.originalStartLine &&
                    range.originalEndLine <= original.lines.length)),
    );

    if (!inBounds) return [...ranges];
    const placed = placeRanges(ranges, original);

    if (placed) {
        return clusterRanges(placed, current).flatMap((cluster) =>
            refineCluster(cluster, original, current),
        );
    }

    return ranges.flatMap((range) =>
        range.kind === "modified"
            ? (refineSpan(
                  {
                      startLine: range.startLine,
                      endLine: range.endLine,
                      originalStartLine: range.originalStartLine!,
                      originalEndLine: range.originalEndLine!,
                  },
                  original,
                  current,
                  true,
              ) ?? [range])
            : [range],
    );
}
