import type { DiffRange } from "../types";

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

/** Minimum word similarity (Dice coefficient) for two chunks to be an edit. */
const PAIR_MIN_SIMILARITY = 0.4;

/** Upper bound on chunk-pair comparisons per region; larger stay coarse. */
export const MAX_ALIGNMENT_CELLS = 40_000;

/** Alignment weight for identical non-blank chunks — beats any fuzzy pair. */
const EQUAL_WEIGHT = 2;

/** Similarity given to two chunks that both have no words (e.g. `| --- |`). */
const WORDLESS_SIMILARITY = 0.5;

/** A line that always starts its own Markdown block. */
const BLOCK_START =
  /^\s*(?:#{1,6}(?:\s|$)|[-*+]\s|\d{1,9}[.)](?:\s|$)|<!--|\$\$)/;

/** A heading is one line: the next non-blank line starts a new block. */
const HEADING = /^\s*#{1,6}(?:\s|$)/;

/** Consecutive lines of these kinds form one block (a table, a quote). */
const TABLE_ROW = /^\s*\|/;
const QUOTE_LINE = /^\s*>/;

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

type LineRun = "table" | "quote" | "other";

function lineRun(line: string): LineRun {
  if (TABLE_ROW.test(line)) return "table";
  if (QUOTE_LINE.test(line)) return "quote";
  return "other";
}

export interface DiffChunk {
  /** 1-based first line of the chunk in its source. */
  start: number;
  /** 1-based last line of the chunk in its source (inclusive). */
  end: number;
  /** First line of the whole block this chunk was clipped from. */
  blockStart: number;
  text: string;
  blank: boolean;
  /** True for a run of table rows. */
  table: boolean;
  /** Block kind from the first line: `h2`, `item`, `table`, `quote`, … */
  kind: string;
  words: Map<string, number>;
  wordCount: number;
}

type AlignmentOp =
  | { type: "equal"; before: DiffChunk; after: DiffChunk }
  | { type: "pair"; before: DiffChunk; after: DiffChunk }
  | { type: "removed"; before: DiffChunk }
  | { type: "added"; after: DiffChunk };

function makeChunk(
  start: number,
  lines: readonly string[],
  blockStart = start,
  table = false,
  kind = blockKind(lines[0]!),
): DiffChunk {
  const text = lines.join("\n");
  const words = new Map<string, number>();
  let wordCount = 0;
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    words.set(word, (words.get(word) ?? 0) + 1);
    wordCount++;
  }
  return {
    start,
    end: start + lines.length - 1,
    blockStart,
    text,
    blank: text.trim() === "",
    table,
    kind,
    words,
    wordCount,
  };
}

function blockKind(line: string): string {
  const heading = /^\s*(#{1,6})(?:\s|$)/.exec(line);
  if (heading) return `h${heading[1]!.length}`;
  if (/^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(line)) return "item";
  if (TABLE_ROW.test(line)) return "table";
  if (QUOTE_LINE.test(line)) return "quote";
  if (FENCE_OPEN.test(line)) return "fence";
  return "text";
}

/**
 * Split source lines into Markdown block chunks. `firstLine` is the 1-based
 * line number of `lines[0]`. A heuristic grouping, not a parse: fenced code,
 * tables and quotes stay whole, hard-wrapped paragraph lines join their
 * paragraph, and list items, headings and blank lines stand alone.
 */
export function chunkMarkdownLines(
  lines: readonly string[],
  firstLine: number,
): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let current: string[] | null = null;
  let currentStart = 0;
  let currentRun: LineRun = "other";
  let fence: string | null = null;
  let afterHeading = false;

  const close = () => {
    if (current) {
      chunks.push(
        makeChunk(currentStart, current, currentStart, currentRun === "table"),
      );
    }
    current = null;
  };

  lines.forEach((line, index) => {
    const lineNumber = firstLine + index;
    if (fence) {
      current!.push(line);
      if (line.trim().startsWith(fence)) {
        fence = null;
        close();
      }
      return;
    }
    if (line.trim() === "") {
      close();
      chunks.push(makeChunk(lineNumber, [line]));
      afterHeading = false;
      return;
    }
    const fenceOpen = FENCE_OPEN.exec(line);
    const run = lineRun(line);
    if (
      current === null ||
      afterHeading ||
      fenceOpen ||
      BLOCK_START.test(line) ||
      (run !== "other" && run !== currentRun) ||
      (currentRun === "table" && run !== "table")
    ) {
      close();
      current = [];
      currentStart = lineNumber;
      currentRun = run;
    }
    current!.push(line);
    if (fenceOpen) fence = fenceOpen[1]!;
    afterHeading = HEADING.test(line);
  });
  close();
  return chunks;
}

/** Word-overlap similarity (Dice coefficient) between two chunks, 0..1. */
export function chunkSimilarity(a: DiffChunk, b: DiffChunk): number {
  if (a.text === b.text) return 1;
  if (a.blank || b.blank) return 0;
  if (a.wordCount === 0 || b.wordCount === 0) {
    return a.wordCount === b.wordCount ? WORDLESS_SIMILARITY : 0;
  }
  let shared = 0;
  for (const [word, count] of a.words) {
    shared += Math.min(count, b.words.get(word) ?? 0);
  }
  return (2 * shared) / (a.wordCount + b.wordCount);
}

/** Match weight of pairing `a` with `b`; -1 when they must not pair. */
function pairWeight(a: DiffChunk, b: DiffChunk): number {
  if (a.text === b.text) {
    // Blank lines never anchor an alignment: pairing them would split one
    // rewritten region into many small removed/added runs.
    return a.blank ? -1 : EQUAL_WEIGHT;
  }
  const similarity = chunkSimilarity(a, b);
  return similarity >= PAIR_MIN_SIMILARITY ? similarity : -1;
}

/** Row-major `(rows + 1) x (cols + 1)` table of best total match weight. */
function alignmentScores(
  weight: Float64Array,
  rows: number,
  cols: number,
): Float64Array {
  const width = cols + 1;
  const score = new Float64Array((rows + 1) * width);
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      const w = weight[(i - 1) * cols + (j - 1)]!;
      const diagonal = w > 0 ? score[(i - 1) * width + (j - 1)]! + w : -1;
      score[i * width + j] = Math.max(
        score[(i - 1) * width + j]!,
        score[i * width + (j - 1)]!,
        diagonal,
      );
    }
  }
  return score;
}

interface AlignmentGrid {
  before: readonly DiffChunk[];
  after: readonly DiffChunk[];
  cols: number;
  width: number;
  weight: Float64Array;
  score: Float64Array;
}

/** Whether the best path to cell (i, j) pairs `before[i-1]` with `after[j-1]`. */
function takesDiagonal(grid: AlignmentGrid, i: number, j: number): boolean {
  if (i === 0 || j === 0) return false;
  const { cols, width, weight, score } = grid;
  const w = weight[(i - 1) * cols + (j - 1)]!;
  return (
    w > 0 && score[i * width + j] === score[(i - 1) * width + (j - 1)]! + w
  );
}

/** Walk the score table back from the bottom-right corner into ops. */
function backtrackAlignment(grid: AlignmentGrid): AlignmentOp[] {
  const { before, after, width, score } = grid;
  const ops: AlignmentOp[] = [];
  let i = before.length;
  let j = after.length;
  while (i > 0 || j > 0) {
    if (takesDiagonal(grid, i, j)) {
      const a = before[i - 1]!;
      const b = after[j - 1]!;
      ops.push({
        type: a.text === b.text ? "equal" : "pair",
        before: a,
        after: b,
      });
      i--;
      j--;
      continue;
    }
    if (
      j > 0 &&
      (i === 0 || score[i * width + (j - 1)] === score[i * width + j])
    ) {
      ops.push({ type: "added", after: after[j - 1]! });
      j--;
    } else {
      ops.push({ type: "removed", before: before[i - 1]! });
      i--;
    }
  }
  return ops.reverse();
}

/**
 * Order-preserving alignment of two chunk lists that maximises the total
 * weight of matched chunks (identical > similar > blank), the same shape as a
 * longest-common-subsequence but with fuzzy, weighted matches.
 */
function alignChunks(
  before: readonly DiffChunk[],
  after: readonly DiffChunk[],
): AlignmentOp[] {
  const rows = before.length;
  const cols = after.length;
  const weight = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      weight[i * cols + j] = pairWeight(before[i]!, after[j]!);
    }
  }
  const score = alignmentScores(weight, rows, cols);
  return backtrackAlignment({
    before,
    after,
    cols,
    width: cols + 1,
    weight,
    score,
  });
}

/** Drop blank chunks from both ends of a run. */
function trimBlankChunks(run: readonly DiffChunk[]): DiffChunk[] {
  let first = 0;
  let last = run.length - 1;
  while (first <= last && run[first]!.blank) first++;
  while (last >= first && run[last]!.blank) last--;
  return run.slice(first, last + 1);
}

/** The chunks overlapping lines [from,to], trimmed to that window. */
function clipChunks(
  chunks: readonly DiffChunk[],
  lines: readonly string[],
  from: number,
  to: number,
): DiffChunk[] {
  const clipped: DiffChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.end < from || chunk.start > to) continue;
    if (chunk.start >= from && chunk.end <= to) {
      clipped.push(chunk);
      continue;
    }
    const start = Math.max(chunk.start, from);
    const end = Math.min(chunk.end, to);
    // A clipped piece keeps its block's kind: a fragment of a code fence that
    // starts at `# comment` is still code, not a heading.
    clipped.push(
      makeChunk(
        start,
        lines.slice(start - 1, end),
        chunk.blockStart,
        chunk.table,
        chunk.kind,
      ),
    );
  }
  return clipped;
}

/** Each row of a (clipped) table chunk as its own chunk. */
function tableRows(chunk: DiffChunk): DiffChunk[] {
  return chunk.text
    .split("\n")
    .map((row, index) =>
      makeChunk(chunk.start + index, [row], chunk.blockStart, true),
    );
}

/**
 * A changed table is re-aligned row by row — so an inserted row reads as
 * added and an edited row compares against its own original — but only when
 * its header is unchanged. A header edit can add, drop or reorder columns,
 * which the renderer resolves against the whole table's original text.
 */
function rowAlignable(before: DiffChunk, after: DiffChunk): boolean {
  if (!before.table || !after.table) return false;
  const beforeHasHeader = before.start === before.blockStart;
  const afterHasHeader = after.start === after.blockStart;
  if (!beforeHasHeader && !afterHasHeader) return true;
  if (!beforeHasHeader || !afterHasHeader) return false;
  const header = (chunk: DiffChunk) =>
    chunk.text.split("\n").slice(0, 2).join("\n");
  return header(before) === header(after);
}

/** Replace row-alignable table pairs with their row-level alignment. */
function expandTablePairs(ops: readonly AlignmentOp[]): AlignmentOp[] {
  return ops.flatMap((op) => {
    if (op.type !== "pair" || !rowAlignable(op.before, op.after)) return [op];
    const beforeRows = tableRows(op.before);
    const afterRows = tableRows(op.after);
    return beforeRows.length * afterRows.length > MAX_ALIGNMENT_CELLS
      ? [op]
      : alignChunks(beforeRows, afterRows);
  });
}

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
  const after = clipChunks(
    current.chunks,
    current.lines,
    span.startLine,
    span.endLine,
  );
  const originalLines = original.lines;
  const contentBefore = before.filter((chunk) => !chunk.blank);
  const contentAfter = after.filter((chunk) => !chunk.blank);
  if (
    keepSingleBlock &&
    contentBefore.length === 1 &&
    contentAfter.length === 1 &&
    (!rowAlignable(contentBefore[0]!, contentAfter[0]!) ||
      (contentBefore[0]!.start === contentBefore[0]!.end &&
        contentAfter[0]!.start === contentAfter[0]!.end))
  ) {
    return null;
  }
  if (before.length * after.length > MAX_ALIGNMENT_CELLS) return null;

  const out: DiffRange[] = [];
  let removedRun: DiffChunk[] = [];
  let addedRun: DiffChunk[] = [];
  let nextCurrentLine = span.startLine;

  const pushModified = (before: DiffChunk, after: DiffChunk) => {
    out.push({
      startLine: after.start,
      endLine: after.end,
      kind: "modified",
      originalText: before.text,
      originalStartLine: before.start,
      originalEndLine: before.end,
      linesAdded: after.end - after.start + 1,
      linesDeleted: before.end - before.start + 1,
    });
  };

  const flush = () => {
    const removed = trimBlankChunks(removedRun);
    const added = trimBlankChunks(addedRun);
    removedRun = [];
    addedRun = [];
    // Blocks replaced by the same shape of blocks (a heading and paragraph by
    // a heading and paragraph) still read as edits of them, one for one.
    const removedBlocks = removed.filter((chunk) => !chunk.blank);
    const addedBlocks = added.filter((chunk) => !chunk.blank);
    if (
      removedBlocks.length > 0 &&
      removedBlocks.length === addedBlocks.length &&
      removedBlocks.every((chunk, i) => chunk.kind === addedBlocks[i]!.kind)
    ) {
      removedBlocks.forEach((chunk, i) => pushModified(chunk, addedBlocks[i]!));
      return;
    }
    if (removed.length > 0) {
      const from = removed[0]!.start;
      const to = removed[removed.length - 1]!.end;
      const at = added.length > 0 ? added[0]!.start : nextCurrentLine;
      out.push({
        startLine: at,
        endLine: at,
        kind: "deleted-marker",
        deletedContent: originalLines.slice(from - 1, to).join("\n"),
        linesAdded: 0,
        linesDeleted: to - from + 1,
      });
    }
    if (added.length > 0) {
      const from = added[0]!.start;
      const to = added[added.length - 1]!.end;
      out.push({
        startLine: from,
        endLine: to,
        kind: "added",
        linesAdded: to - from + 1,
        linesDeleted: 0,
      });
    }
  };

  for (const op of expandTablePairs(alignChunks(before, after))) {
    if (op.type === "removed") {
      removedRun.push(op.before);
      continue;
    }
    if (op.type === "added") {
      addedRun.push(op.after);
      nextCurrentLine = op.after.end + 1;
      continue;
    }
    flush();
    nextCurrentLine = op.after.end + 1;
    if (op.type === "pair") pushModified(op.before, op.after);
  }
  flush();
  return out;
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
function placeRanges(
  ranges: readonly DiffRange[],
  original: SourceSide,
): PlacedRange[] | null {
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
function clusterRanges(
  placed: readonly PlacedRange[],
  current: SourceSide,
): PlacedRange[][] {
  const clusters: PlacedRange[][] = [];
  for (const item of placed) {
    const cluster = clusters[clusters.length - 1];
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
      (range.kind === "deleted-marker" ||
        range.endLine <= current.lines.length) &&
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
