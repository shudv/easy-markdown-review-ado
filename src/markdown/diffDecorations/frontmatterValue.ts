// Inline value diffs for changed frontmatter metadata rows.

import { diffWords } from "../wordDiff";
import {
    frontmatterValuesForKey,
    frontmatterValueText,
    parseFrontmatterListItems,
} from "../frontmatter";
import { applyInlineWordDiff } from "../wordDiffDom";
import { type ChangeRange, FRONTMATTER_ROW_CLASS, overlaps, type SourceSpan } from "./shared";

/**
 * A frontmatter row only counts as added when its `key:` line is new. A row
 * whose existing block list gained item lines was edited: just the new items
 * are added, which the value diff shows.
 */
export function frontmatterRowKind(
    el: HTMLElement,
    start: number,
    kind: "added" | "modified" | null,
    ranges: readonly ChangeRange[],
): "added" | "modified" | null {
    if (kind !== "added" || !el.classList.contains(FRONTMATTER_ROW_CLASS)) return kind;

    return ranges.some((r) => overlaps(start, start, r.start, r.end)) ? kind : "modified";
}

/**
 * Inline word-diff for a frontmatter row's value cell. The value renders as a
 * single string (lists are comma-joined), so a metadata change reads as a plain
 * word-diff: added words green, removed words struck red, unchanged neutral —
 * always expressed as add/remove, never a background wash that stretches right.
 *   - ADDED row (brand-new `key: value`): diff against "" → every word green.
 *   - MODIFIED row: diff against the pre-edit value parsed from the change's
 *     original source.
 * Returns true when at least one word mark was applied (so the caller flags the
 * row as inline-diffed); false for a row whose original value can't be resolved
 * or whose value is unchanged.
 */
export function decorateFrontmatterValue(
    el: HTMLElement,
    kind: "added" | "modified",
    row: SourceSpan,
    changeRanges: readonly ChangeRange[],
): boolean {
    const valueEl = el.querySelector<HTMLElement>(".emr-frontmatter-value");
    if (!valueEl) return false;

    const modifiedText = valueEl.textContent;

    // Resolve the pre-edit value text. A wholly-added row has no "before", so we
    // diff against an empty string — every word reads as added (green).
    let originalText = "";

    if (kind === "modified") {
        // Stryker disable next-line MethodExpression: the renderer writes the bare key into the key element, so there is no surrounding whitespace to trim
        const key = el.querySelector(".emr-frontmatter-key")?.textContent.trim();

        if (key === undefined || key === "") return false;

        const resolved = resolveFrontmatterOriginalValue(key, modifiedText, row, changeRanges);

        if (resolved == null) return false;
        originalText = resolved;
    }

    // Stryker disable next-line ConditionalExpression: diffing identical text yields one unchanged run, which places no marks and so also returns false below
    if (originalText === modifiedText) return false;

    // Word-diff the value against its pre-edit text. Unlike the prose blocks we
    // apply NO unchanged-ratio threshold: metadata values are short and a full
    // replacement (e.g. `Draft` → `Published`) still reads best as struck-old +
    // green-new rather than a flat wash.
    const ops = diffWords(originalText, modifiedText);
    const res = applyInlineWordDiff(valueEl, ops);

    // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator: dead code: the ops were diffed against the value's own text, so they always rebuild it (res is never null), and the texts differ, so at least one mark is placed; candidate for removal
    return res != null && res.added + res.removed > 0;
}

/**
 * Reconstruct the pre-edit value text of a frontmatter row from the change
 * range(s) overlapping its source span [rowStart, rowEnd].
 *
 * Two shapes of `originalText` arrive from ADO's line diff:
 *   1. Whole-line values (scalars `status: Draft`, inline arrays
 *      `tags: [a, b]`): the fragment contains the `key:` line, so we parse the
 *      value straight out.
 *   2. Block-list items (`  - Grace Hopper`): the fragment is just the changed
 *      item line(s) with no key, so we splice those original items back into
 *      the current value list at the line position they occupy — a block-list
 *      row is `key:` on `rowStart` and items on `rowStart+1…rowEnd`. Added item
 *      lines are spliced out, since they weren't there before.
 * Returns null when no overlapping range carries usable original text.
 */
function resolveFrontmatterOriginalValue(
    key: string,
    currentText: string,
    { start: rowStart, end: rowEnd }: SourceSpan,
    ranges: readonly ChangeRange[],
): string | null {
    // Added item lines carry no previous text: they simply weren't there.
    const overlapping = ranges.filter(
        (r) =>
            (r.kind === "added" || r.originalText != null) &&
            overlaps(rowStart, rowEnd, r.start, r.end),
    );

    // Stryker disable next-line ConditionalExpression: with nothing to splice in, the value is rebuilt from the current items unchanged, which the caller treats as no change
    if (overlapping.length === 0) return null;

    // Shape 1: a fragment that carries the `key:` line resolves the value whole.
    for (const r of overlapping) {
        if (r.originalText == null) continue;
        const values = frontmatterValuesForKey(r.originalText, key);
        if (values) return frontmatterValueText(values);
    }

    // Shape 2: block-list item fragments — substitute the original item(s) back
    // at their line position. Items sit on `rowStart+1…`, so a range starting at
    // line L maps to current item index `L - (rowStart + 1)`. Apply back-to-front
    // so earlier indices stay valid when item counts differ.
    const firstItemLine = rowStart + 1;
    // Stryker disable next-line ConditionalExpression,ArrayDeclaration: an empty list has no item lines, so any range reaching here starts on the key line and is rejected below before the items are read
    const originalItems = currentText === "" ? [] : currentText.split(", ");
    const sorted = [...overlapping].sort((a, b) => b.start - a.start);

    for (const r of sorted) {
        const startIdx = r.start - firstItemLine;
        if (startIdx < 0) return null; // Can't map the fragment onto an item slot.
        const modifiedCount = r.end - r.start + 1;
        originalItems.splice(
            startIdx,
            modifiedCount,
            ...(r.originalText == null ? [] : parseFrontmatterListItems(r.originalText)),
        );
    }

    return frontmatterValueText(originalItems);
}
