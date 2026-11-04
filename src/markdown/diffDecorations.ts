// Subtle inline diff decorations for the rendered Markdown article.
//
// The PR view knows which source line ranges changed (`DiffRange[]`), and the
// renderer stamps every block with `data-source-line` / `data-source-end-line`
// (see `rehypeSourcePositions`). This module joins the two: it tags block
// elements whose source lines fall inside a changed range, inserts a marker
// where lines were deleted, and — for a reworded prose block — renders the
// original source and overlays an inline WORD-level diff so only the changed
// words show (green added / struck-through red removed) instead of washing the
// whole block. Pure, idempotent DOM transform; jsdom-tested.
//
// The implementation lives in `./diffDecorations/`, split by concern; this
// file is the public entry point.

import type { DiffRange } from "../types";
import {
  createDecorationPass,
  type DiffDecorationOptions,
  markContiguousGroups,
} from "./diffDecorations/pass";
import { decorateBlock } from "./diffDecorations/blocks";
import { decorateMermaidBlock } from "./diffDecorations/mermaid";
import {
  insertDeletionMarkers,
  insertSourceOnlyMarkers,
} from "./diffDecorations/markers";
import { clearDecorations } from "./diffDecorations/clear";
import { BLOCK_SELECTOR, MERMAID_SELECTOR } from "./diffDecorations/shared";

export { stripMermaidFence } from "./diffDecorations/mermaid";
export { selectionTouchesDeletedDiff } from "./diffDecorations/markers";
export {
  alignTableColumns,
  alignTableCells,
  splitTableRow,
} from "./diffDecorations/tableAlignment";
export { reconstructOriginalBlock } from "./diffDecorations/reconstruct";
export {
  DIFF_BLOCK_CLASS,
  DIFF_DELETED_MARKER_CLASS,
  DIFF_INLINE_CLASS,
  DIFF_MATH_CLASS,
  DIFF_MERMAID_CLASS,
  DIFF_IMAGE_CLASS,
  DIFF_CELL_CLASS,
  DIFF_CELL_INLINE_CLASS,
  DIFF_CELL_ADDED_CLASS,
  DIFF_CELL_METADATA_CLASS,
  DIFF_CELL_REMOVED_CLASS,
  DIFF_FORMAT_CLASS,
  DIFF_METADATA_CLASS,
  DIFF_SOURCE_ONLY_CLASS,
  DIFF_TOOLTIP_CLASS,
} from "./diffDecorations/shared";

export interface DiffDecorationResult {
  /** Number of block elements that received a change bar. */
  decorated: number;
  /** Number of deletion markers inserted. */
  markers: number;
  /** Number of blocks that received an inline word-level diff overlay. */
  inlined: number;
}

/** Roll-up counts used by the show/hide-changes toggle legend. */
export interface DiffSummary {
  /** Number of added source-line ranges. */
  added: number;
  /** Number of modified source-line ranges. */
  modified: number;
  /** Total lines removed across all deletion markers. */
  deleted: number;
}

/**
 * Summarize a set of diff ranges into added / modified / deleted counts.
 * Pure; drives the toggle legend without touching the DOM.
 */
export function summarizeDiff(ranges: readonly DiffRange[]): DiffSummary {
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const r of ranges) {
    if (r.kind === "added") added++;
    else if (r.kind === "modified") modified++;
    else deleted += r.linesDeleted ?? 0;
  }
  return { added, modified, deleted };
}

/** One entry in the toggle's change legend. */
export interface DiffLegendStat {
  kind: "added" | "modified" | "deleted";
  label: string;
}

/**
 * Turn a {@link DiffSummary} into the non-zero legend entries shown next to the
 * show/hide-changes toggle. Zero-count kinds are omitted. Pure so the branch
 * logic is unit-tested here rather than inside the React shell.
 */
export function diffLegendStats(summary: DiffSummary): DiffLegendStat[] {
  const stats: DiffLegendStat[] = [];
  if (summary.added > 0)
    stats.push({ kind: "added", label: `${summary.added} added` });
  if (summary.modified > 0)
    stats.push({ kind: "modified", label: `${summary.modified} edited` });
  if (summary.deleted > 0)
    stats.push({ kind: "deleted", label: `${summary.deleted} removed` });
  return stats;
}

/**
 * Apply subtle change decorations to `root` for the given `ranges`.
 * Safe to call repeatedly; each call first clears prior decorations.
 */
export function decorateDiffRanges(
  root: HTMLElement,
  ranges: readonly DiffRange[],
  options?: DiffDecorationOptions,
): DiffDecorationResult {
  clearDecorations(root);
  if (ranges.length === 0) return { decorated: 0, markers: 0, inlined: 0 };

  const pass = createDecorationPass(root, ranges, options);
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  for (const el of blocks) decorateBlock(pass, el);

  // Merge contiguous same-kind blocks into a single visual group so a run of
  // added (or edited) siblings reads as one card with one corner tag.
  markContiguousGroups(pass.decoratedEls);

  // Mermaid diagrams: a rendered diagram can't be word- or wash-diffed, so a
  // changed diagram gets a quiet left accent bar (hue by kind) and stashes its
  // original source so the "Source" modal can show the full diagram diff.
  for (const el of root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)) {
    decorateMermaidBlock(pass, el);
  }

  const markerAnchors = Array.from(
    root.querySelectorAll<HTMLElement>(
      `${BLOCK_SELECTOR}, ${MERMAID_SELECTOR}`,
    ),
  );
  insertSourceOnlyMarkers(pass, markerAnchors);
  const markers = insertDeletionMarkers(pass, markerAnchors);

  return { decorated: pass.decorated, markers, inlined: pass.inlined };
}
