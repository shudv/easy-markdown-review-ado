// Pure Markdown table-row splitting and original-to-current cell/column
// alignment used by the table cell diff.

/**
 * Split a Markdown table row (`| a | b | c |`) into its trimmed cell strings.
 * Ignores escaped pipes (`\|`) so a cell containing a literal pipe survives.
 */
export function splitTableRow(row: string): string[] {
    let s = row.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);

    // Split on unescaped pipes only.
    return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

export type TableCellAlignment =
    | {
          kind: "equal" | "modified";
          originalIndex: number;
          currentIndex: number;
      }
    | { kind: "added"; currentIndex: number }
    | { kind: "removed"; originalIndex: number; currentIndex: number };

/**
 * Align an unequal table row around unchanged cells. Equal-length rows keep
 * their positional mapping; structural edits require at least one exact cell
 * anchor so an entirely rewritten row remains an amber fallback.
 */
export function alignTableCells(
    original: readonly string[],
    current: readonly string[],
): TableCellAlignment[] | null {
    if (original.length === current.length) {
        return current.map((value, index) => ({
            kind: value === original[index] ? "equal" : "modified",
            originalIndex: index,
            currentIndex: index,
        }));
    }

    const isAnchor = uniqueCellAnchor(original, current);
    const costs = cellAlignmentCosts(original.length, current.length, isAnchor);

    return backtrackCellAlignment(costs, isAnchor, original.length, current.length);
}

type CellAnchorTest = (originalIndex: number, currentIndex: number) => boolean;

/** An exact, non-empty cell value that is unique on both sides. */
function uniqueCellAnchor(original: readonly string[], current: readonly string[]): CellAnchorTest {
    const originalCounts = countTableValues(original);
    const currentCounts = countTableValues(current);

    return (originalIndex, currentIndex) => {
        const value = original[originalIndex]!;

        return (
            value !== "" &&
            value === current[currentIndex] &&
            originalCounts.get(value) === 1 &&
            currentCounts.get(value) === 1
        );
    };
}

/** Edit-distance table where only anchor cells substitute for free. */
function cellAlignmentCosts(
    originalLength: number,
    currentLength: number,
    isAnchor: CellAnchorTest,
): number[][] {
    const costs = Array.from({ length: originalLength + 1 }, () =>
        // Stryker disable next-line ArrayDeclaration,ArithmeticOperator: every cell is written (first row and column, then row by row) before it is read, so the starting fill never matters
        Array<number>(currentLength + 1).fill(0),
    );

    for (let i = 0; i <= originalLength; i++) costs[i]![0] = i;
    for (let j = 0; j <= currentLength; j++) costs[0]![j] = j;

    for (let i = 1; i <= originalLength; i++) {
        for (let j = 1; j <= currentLength; j++) {
            const substitution = costs[i - 1]![j - 1]! + (isAnchor(i - 1, j - 1) ? 0 : 1);

            costs[i]![j] = Math.min(substitution, costs[i - 1]![j]! + 1, costs[i]![j - 1]! + 1);
        }
    }

    return costs;
}

function backtrackCellAlignment(
    costs: readonly (readonly number[])[],
    isAnchor: CellAnchorTest,
    originalLength: number,
    currentLength: number,
): TableCellAlignment[] | null {
    const reversed: TableCellAlignment[] = [];
    let equalCount = 0;
    let i = originalLength;
    let j = currentLength;

    while (i > 0 || j > 0) {
        const step = cellAlignmentStep(costs, isAnchor, i, j);
        reversed.push(step);
        if (step.kind === "equal") equalCount++;
        if (step.kind !== "added") i--;
        if (step.kind !== "removed") j--;
    }

    return equalCount > 0 ? reversed.reverse() : null;
}

/** The alignment step that reaches cell `[i][j]` of the cost table. */
function cellAlignmentStep(
    costs: readonly (readonly number[])[],
    isAnchor: CellAnchorTest,
    i: number,
    j: number,
): TableCellAlignment {
    // Stryker disable next-line LogicalOperator,EqualityOperator: on row or column 0 the anchor test reads a missing cell value, which is never an anchor
    if (i > 0 && j > 0 && isAnchor(i - 1, j - 1) && costs[i]![j] === costs[i - 1]![j - 1]) {
        return { kind: "equal", originalIndex: i - 1, currentIndex: j - 1 };
    }

    // Stryker disable next-line EqualityOperator: in column 0 the diagonal cost is missing, so the comparison is false either way
    if (i > 0 && j > 0 && costs[i]![j] === costs[i - 1]![j - 1]! + 1) {
        // Stryker disable next-line StringLiteral: the cell diff recomputes equal/modified for every paired cell, so the provisional name is never read
        return { kind: "modified", originalIndex: i - 1, currentIndex: j - 1 };
    }

    // Stryker disable next-line EqualityOperator: in column 0 the left-hand cost is missing, so the comparison is false either way
    if (j > 0 && costs[i]![j] === costs[i]![j - 1]! + 1) {
        return { kind: "added", currentIndex: j - 1 };
    }

    return { kind: "removed", originalIndex: i - 1, currentIndex: j };
}

function countTableValues(values: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

    return counts;
}

/**
 * Align table columns using unique header identities. Exact unique names may
 * move; same-width unmatched headers are treated as positional renames. An
 * unequal schema with both unmatched old and new headers remains ambiguous.
 */
export function alignTableColumns(
    original: readonly string[],
    current: readonly string[],
): TableCellAlignment[] | null {
    const originalCounts = countTableValues(original);
    const currentCounts = countTableValues(current);
    const currentByOriginal = new Map<number, number>();
    const originalByCurrent = new Map<number, number>();

    // Stryker disable next-line EqualityOperator: one step past the end reads undefined, which never counts as a unique header
    for (let originalIndex = 0; originalIndex < original.length; originalIndex++) {
        const value = original[originalIndex]!;

        if (value === "" || originalCounts.get(value) !== 1 || currentCounts.get(value) !== 1) {
            continue;
        }

        const currentIndex = current.indexOf(value);
        currentByOriginal.set(originalIndex, currentIndex);
        originalByCurrent.set(currentIndex, originalIndex);
    }

    if (original.length === current.length) {
        const allExact = currentByOriginal.size === original.length;

        return current.map((value, currentIndex) => {
            const originalIndex = allExact ? originalByCurrent.get(currentIndex)! : currentIndex;

            return {
                kind: value === original[originalIndex] ? "equal" : "modified",
                originalIndex,
                currentIndex,
            };
        });
    }

    // Stryker disable next-line ConditionalExpression: dead code: with no matched header and differing widths both sides have unmatched headers, which the check below already rejects, candidate for removal
    if (currentByOriginal.size === 0) return null;

    const unmatchedOriginal = original
        .map((_, index) => index)
        .filter((index) => !currentByOriginal.has(index));

    const unmatchedCurrent = current
        .map((_, index) => index)
        .filter((index) => !originalByCurrent.has(index));

    if (unmatchedOriginal.length > 0 && unmatchedCurrent.length > 0) {
        return null;
    }

    const alignment: TableCellAlignment[] = current.map((_, currentIndex) => {
        const originalIndex = originalByCurrent.get(currentIndex);

        return originalIndex == null
            ? { kind: "added", currentIndex }
            : { kind: "equal", originalIndex, currentIndex };
    });

    for (const originalIndex of unmatchedOriginal) {
        // Stryker disable next-line EqualityOperator: an unmatched header is never among the matched ones, so >= finds the same later headers
        const laterMapped = [...currentByOriginal.keys()].filter((index) => index > originalIndex);

        const currentIndex =
            laterMapped.length === 0
                ? current.length
                : currentByOriginal.get(Math.min(...laterMapped))!;

        const insertionIndex = alignment.findIndex((item) => item.currentIndex >= currentIndex);

        alignment.splice(insertionIndex < 0 ? alignment.length : insertionIndex, 0, {
            kind: "removed",
            originalIndex,
            currentIndex,
        });
    }

    return alignment;
}
