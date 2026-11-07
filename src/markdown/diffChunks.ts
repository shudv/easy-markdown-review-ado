/**
 * Markdown block chunking and weighted chunk alignment for `refineDiffRanges`
 * (see diffRefine.ts).
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
const BLOCK_START = /^\s*(?:#{1,6}(?:\s|$)|[-*+]\s|\d{1,9}[.)](?:\s|$)|<!--|\$\$)/;

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

/**
 * The enclosing block a chunk was cut from. Each field defaults to the chunk
 * itself: its own start line, not a table, and the kind of its first line.
 */
interface ChunkBlock {
    blockStart?: number;
    table?: boolean;
    kind?: string;
}

function makeChunk(
    start: number,
    lines: readonly string[],
    { blockStart = start, table = false, kind = blockKind(lines[0]!) }: ChunkBlock = {},
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
export function chunkMarkdownLines(lines: readonly string[], firstLine: number): DiffChunk[] {
    const chunks: DiffChunk[] = [];
    let current: string[] | null = null;
    let currentStart = 0;
    let currentRun: LineRun = "other";
    let fence: string | null = null;
    let afterHeading = false;

    const close = () => {
        if (current) {
            chunks.push(
                makeChunk(currentStart, current, {
                    blockStart: currentStart,
                    table: currentRun === "table",
                }),
            );
        }

        current = null;
    };

    lines.forEach((line, index) => {
        const lineNumber = firstLine + index;

        if (fence !== null) {
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
function alignmentScores(weight: Float64Array, rows: number, cols: number): Float64Array {
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

    return w > 0 && score[i * width + j] === score[(i - 1) * width + (j - 1)]! + w;
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

        if (j > 0 && (i === 0 || score[i * width + (j - 1)] === score[i * width + j])) {
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
export function alignChunks(
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
export function trimBlankChunks(run: readonly DiffChunk[]): DiffChunk[] {
    let first = 0;
    let last = run.length - 1;
    while (first <= last && run[first]!.blank) first++;
    while (last >= first && run[last]!.blank) last--;

    return run.slice(first, last + 1);
}

/** The chunks overlapping lines [from,to], trimmed to that window. */
export function clipChunks(
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
            makeChunk(start, lines.slice(start - 1, end), {
                blockStart: chunk.blockStart,
                table: chunk.table,
                kind: chunk.kind,
            }),
        );
    }

    return clipped;
}

/** Each row of a (clipped) table chunk as its own chunk. */
function tableRows(chunk: DiffChunk): DiffChunk[] {
    return chunk.text.split("\n").map((row, index) =>
        makeChunk(chunk.start + index, [row], {
            blockStart: chunk.blockStart,
            table: true,
        }),
    );
}

/**
 * A changed table is re-aligned row by row — so an inserted row reads as
 * added and an edited row compares against its own original — but only when
 * its header is unchanged. A header edit can add, drop or reorder columns,
 * which the renderer resolves against the whole table's original text.
 */
export function rowAlignable(before: DiffChunk, after: DiffChunk): boolean {
    if (!before.table || !after.table) return false;
    const beforeHasHeader = before.start === before.blockStart;
    const afterHasHeader = after.start === after.blockStart;
    if (!beforeHasHeader && !afterHasHeader) return true;
    if (!beforeHasHeader || !afterHasHeader) return false;

    const header = (chunk: DiffChunk) => chunk.text.split("\n").slice(0, 2).join("\n");

    return header(before) === header(after);
}

/** Replace row-alignable table pairs with their row-level alignment. */
export function expandTablePairs(ops: readonly AlignmentOp[]): AlignmentOp[] {
    return ops.flatMap((op) => {
        if (op.type !== "pair" || !rowAlignable(op.before, op.after)) {
            return [op];
        }

        const beforeRows = tableRows(op.before);
        const afterRows = tableRows(op.after);

        return beforeRows.length * afterRows.length > MAX_ALIGNMENT_CELLS
            ? [op]
            : alignChunks(beforeRows, afterRows);
    });
}
