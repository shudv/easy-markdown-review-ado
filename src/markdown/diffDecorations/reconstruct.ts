// Reconstruct the original Markdown of a changed block from the base source
// and the diff ranges that touch it.

import type { DiffRange } from "../../types";
import { renderOriginalStandalone } from "./rendering";
import {
  type ChangeRange,
  FRONTMATTER_ROW_CLASS,
  isImageOnlyBlock,
  MERMAID_SELECTOR,
  overlaps,
  PROSE_TAGS,
  type SourceSpan,
} from "./shared";

export function reconstructOriginalBlock(
  { start: blockStart, end: blockEnd }: SourceSpan,
  ranges: readonly ChangeRange[],
  originalSource?: string,
  originalLines?: readonly string[],
): string | null {
  const overlapping = ranges
    .filter(
      (range) =>
        range.kind === "modified" &&
        overlaps(blockStart, blockEnd, range.start, range.end),
    )
    .sort((a, b) => a.start - b.start);
  if (overlapping.length === 0) return null;

  const exact = overlapping.find(
    (range) =>
      range.start === blockStart &&
      range.end === blockEnd &&
      range.originalText != null,
  );
  if (exact) return exact.originalText!;

  if (originalSource === undefined || originalSource === "") return null;
  const sourceLines = originalLines ?? originalSource.split(/\r\n|\r|\n/);

  if (overlapping.length === 1) {
    const range = overlapping[0]!;
    const currentSpan = range.end - range.start;
    if (
      range.originalStart != null &&
      range.originalEnd != null &&
      range.start <= blockStart &&
      range.end >= blockEnd &&
      currentSpan === range.originalEnd - range.originalStart
    ) {
      const originalBlockStart =
        range.originalStart + (blockStart - range.start);
      const originalBlockEnd = range.originalStart + (blockEnd - range.start);
      return sourceLines
        .slice(originalBlockStart - 1, originalBlockEnd)
        .join("\n");
    }
  }

  if (
    overlapping.some(
      (range) =>
        range.start < blockStart ||
        range.end > blockEnd ||
        range.originalStart == null ||
        range.originalEnd == null,
    )
  ) {
    return null;
  }
  const first = overlapping[0]!;
  const last = overlapping[overlapping.length - 1]!;
  const originalBlockStart = first.originalStart! - (first.start - blockStart);
  const originalBlockEnd = last.originalEnd! + (blockEnd - last.end);
  if (originalBlockStart < 1 || originalBlockEnd < originalBlockStart) {
    return null;
  }
  return sourceLines.slice(originalBlockStart - 1, originalBlockEnd).join("\n");
}

export interface InteriorEdit {
  /** The block's original Markdown source. */
  original: string;
  /** Deletions inside the block, shown by its inline diff instead of a marker. */
  deletions: DiffRange[];
}

/** Blocks whose original can be rebuilt line by line and diffed in place. */
function canDiffInPlace(el: HTMLElement): boolean {
  return (
    (PROSE_TAGS.has(el.tagName) ||
      el.tagName === "PRE" ||
      el.classList.contains("emr-math") ||
      el.matches(MERMAID_SELECTOR)) &&
    !isImageOnlyBlock(el) &&
    !el.classList.contains(FRONTMATTER_ROW_CLASS)
  );
}

/**
 * Rebuild the original source of a block that a line diff only partly
 * touches: lines added to it, or removed from its middle. ADO reports those as
 * pure additions/deletions, which would paint the whole surviving block as new
 * or float the removal after it. Walking the block's CURRENT lines — dropping
 * added ones, restoring modified ones and splicing deletions back in — yields
 * the original block to word-diff against. Returns null when the block is
 * wholly new, untouched by such edits, or wasn't one block before.
 */
export function reconstructEditedBlock(
  el: HTMLElement,
  { start, end }: SourceSpan,
  {
    changeRanges: ranges,
    deletedRanges,
    currentLines,
    renderInline,
  }: InteriorEditSources,
): InteriorEdit | null {
  if (!canDiffInPlace(el)) return null;
  const deletions = deletedRanges.filter(
    (range) => range.startLine > start && range.startLine <= end,
  );
  const touching = ranges.filter((range) =>
    overlaps(start, end, range.start, range.end),
  );
  if (deletions.length === 0 && !blockPredatesAddition(touching, start, end)) {
    return null;
  }
  const lines = rebuildOriginalLines(
    { start, end, deletions, touching },
    currentLines,
  );
  if (!lines) return null;
  const original = lines.join("\n");
  // An edit that joined or split blocks reads better as separate changes.
  const rendered = renderOriginalStandalone(el, original, renderInline);
  if (rendered.children.length !== 1) return null;
  if (el.tagName === "LI" && rendered.querySelectorAll("li").length !== 1) {
    return null;
  }
  return { original, deletions };
}

/** The diff and render inputs {@link reconstructEditedBlock} rebuilds from. */
interface InteriorEditSources {
  changeRanges: readonly ChangeRange[];
  deletedRanges: readonly DiffRange[];
  currentLines: readonly string[];
  renderInline: (md: string) => string;
}

/** The changes touching a block that {@link reconstructEditedBlock} undoes. */
interface BlockEdits {
  start: number;
  end: number;
  deletions: readonly DiffRange[];
  touching: readonly ChangeRange[];
}

function changeRangeAt(
  touching: readonly ChangeRange[],
  line: number,
): ChangeRange | undefined {
  return touching.find((range) => range.start <= line && line <= range.end);
}

/** True when lines were added to a block that has at least one older line. */
function blockPredatesAddition(
  touching: readonly ChangeRange[],
  start: number,
  end: number,
): boolean {
  if (!touching.some((range) => range.kind === "added")) return false;
  for (let line = start; line <= end; line++) {
    if (changeRangeAt(touching, line)?.kind !== "added") return true;
  }
  return false;
}

function rebuildOriginalLines(
  edits: BlockEdits,
  currentLines: readonly string[],
): string[] | null {
  const lines: string[] = [];
  for (let line = edits.start; line <= edits.end; line++) {
    const deleted = deletedLinesAt(edits.deletions, line);
    if (!deleted) return null;
    lines.push(...deleted);
    const range = changeRangeAt(edits.touching, line);
    const restored = range
      ? originalRangeLines(range, line, edits)
      : currentLineAt(currentLines, line);
    if (!restored) return null;
    lines.push(...restored);
  }
  return lines;
}

/** Lines deleted just before `line`; null when their content is unknown. */
function deletedLinesAt(
  deletions: readonly DiffRange[],
  line: number,
): string[] | null {
  const lines: string[] = [];
  for (const deletion of deletions) {
    if (deletion.startLine !== line) continue;
    if (deletion.deletedContent == null) return null;
    lines.push(
      ...deletion.deletedContent.replace(/\r?\n$/, "").split(/\r\n|\r|\n/),
    );
  }
  return lines;
}

/**
 * The original lines a change range contributes at `line`: nothing for an
 * added line, the whole original text at a modified range's first line, and
 * null when the range spills outside the block or lost its original text.
 */
function originalRangeLines(
  range: ChangeRange,
  line: number,
  block: { start: number; end: number },
): string[] | null {
  if (range.kind === "added") return [];
  if (
    range.start < block.start ||
    range.end > block.end ||
    range.originalText == null
  ) {
    return null;
  }
  return line === range.start ? range.originalText.split(/\r\n|\r|\n/) : [];
}

function currentLineAt(
  currentLines: readonly string[],
  line: number,
): string[] | null {
  const current =
    line >= 1 && line <= currentLines.length
      ? currentLines[line - 1]
      : undefined;
  return current == null ? null : [current];
}

/**
 * Return the single MODIFIED change range that overlaps [start,end], or null
 * when zero or more than one do. Requiring exactly one keeps the inline word
 * diff to the unambiguous single-block-per-hunk case; multi-range or
 * multi-block hunks safely fall back to the block wash.
 */
export function soleModifiedRange(
  start: number,
  end: number,
  ranges: readonly ChangeRange[],
): ChangeRange | null {
  let found: ChangeRange | null = null;
  for (const r of ranges) {
    if (r.kind !== "modified") continue;
    if (!overlaps(start, end, r.start, r.end)) continue;
    if (found) return null;
    found = r;
  }
  return found;
}
