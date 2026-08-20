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

import type { DiffRange } from "../types";
import { diffWords, unchangedRatio } from "./wordDiff";
import {
  frontmatterValuesForKey,
  frontmatterValueText,
  parseFrontmatterListItems,
} from "./frontmatter";
import {
  applyInlineWordDiff,
  WORD_ADDED_CLASS,
  WORD_REMOVED_CLASS,
} from "./wordDiffDom";

/** Class applied to a block element that overlaps a changed range. */
export const DIFF_BLOCK_CLASS = "emr-diff-block";
/** Class on the inserted deletion marker. */
export const DIFF_DELETED_MARKER_CLASS = "emr-diff-deleted-marker";
/** Class added to a modified block when an inline word-diff was overlaid. */
export const DIFF_INLINE_CLASS = "emr-diff-block--inline";
/** Class added to a changed Mermaid diagram (left-bar only, no wash). */
export const DIFF_MERMAID_CLASS = "emr-diff-mermaid";
/** Class added to an image-only block (left-bar only, no wash). */
export const DIFF_IMAGE_CLASS = "emr-diff-image";
/** Class added to an individual changed table cell (td/th). */
export const DIFF_CELL_CLASS = "emr-diff-cell";
/** Class marking a changed cell whose change is shown as an inline word diff. */
export const DIFF_CELL_INLINE_CLASS = "emr-diff-cell--inline";
/** Class marking a structurally added table cell (for example a new column). */
export const DIFF_CELL_ADDED_CLASS = "emr-diff-cell--added";
/** Class on a temporary table cell inserted to show a removed cell in place. */
export const DIFF_CELL_REMOVED_CLASS = "emr-diff-cell--removed";
/** Class marking a cell whose non-text metadata change has its own indicator. */
export const DIFF_CELL_METADATA_CLASS = "emr-diff-cell--metadata";
/** Shared inline indicator for non-visible rendered-content metadata changes. */
export const DIFF_METADATA_CLASS = "emr-diff-metadata";
/** Class on text whose Markdown formatting changed without a text edit. */
export const DIFF_FORMAT_CLASS = "emr-diff-format-change";
/** Class on a localized amber change with an explanatory hover/focus tooltip. */
export const DIFF_TOOLTIP_CLASS = "emr-diff-explained-change";
const DIFF_SUPPRESSED_TITLE_CLASS = "emr-diff-suppressed-native-title";
const DIFF_TOOLTIP_RIGHT_CLASS = "emr-diff-explained-change--right";
const DIFF_LIST_MARKER_CLASS = "emr-diff-list-marker-change";
const DIFF_TASK_STATE_CLASS = "emr-diff-task-state-change";
const DIFF_TASK_TOOLTIP_CLASS = "emr-diff-task-tooltip-anchor";
const DIFF_TABLE_COMPARISON_CLASS = "emr-diff-table-comparison";
export const DIFF_SOURCE_ONLY_CLASS = "emr-diff-source-only";
/** Class marking a frontmatter metadata row (a granular leaf like `li`/`tr`). */
export const FRONTMATTER_ROW_CLASS = "emr-frontmatter-row";

/**
 * Block-level tags we decorate. Note the ABSENCE of the container tags
 * `ul` / `ol` / `table`: instead of washing a whole list or table when a
 * single item changed, we decorate the granular `li` (list item) and `tr`
 * (table row) leaves so only the changed rows/items highlight.
 *
 * `.emr-frontmatter-row` is one key row of the metadata card. Each row carries
 * its own `data-source-line` span, so — exactly like `li` / `tr` — only the
 * edited/added key highlights rather than washing the whole card. (The card
 * container `.emr-frontmatter` is the analogue of `ul` / `table` and is
 * intentionally NOT selected.)
 */
const BLOCK_SELECTOR =
  "p, pre, blockquote, dl, h1, h2, h3, h4, h5, h6, hr, img, li, tr, .emr-frontmatter-row";

/** Tags decorated at the row/item level (inside a list or table container). */
const GRANULAR_TAGS = new Set(["LI", "TR"]);

/**
 * A granular leaf (list item / table row / frontmatter row) owns no group card
 * — it tints in place rather than joining a contiguous run.
 */
function isGranularLeaf(el: Element): boolean {
  return (
    GRANULAR_TAGS.has(el.tagName) ||
    el.classList.contains(FRONTMATTER_ROW_CLASS)
  );
}

/** An image by itself (optionally wrapped in a link/span) owns the whole block. */
function isImageOnlyBlock(el: HTMLElement): boolean {
  if (el.tagName === "IMG") return true;
  return (
    el.tagName === "P" &&
    el.querySelector("img") !== null &&
    el.textContent?.trim() === ""
  );
}

/** Selector for a rendered Mermaid diagram placeholder/host. */
const MERMAID_SELECTOR = ".emr-mermaid";

/**
 * Tags whose rendered text is prose we can safely word-diff inline. Excludes
 * table rows (`tr` — the original row source is a pipe line that won't render
 * back to matching text), code (`pre` — char-precise, monospace), and void
 * blocks. `li` is included so a reworded list item shows word-level changes.
 */
const PROSE_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "DD",
  "DT",
]);

/**
 * Minimum fraction of a modified block that must stay unchanged for the inline
 * word diff to be worth showing. Below this the block was essentially
 * rewritten, and a sea of red/green words reads worse than the block wash.
 */
const INLINE_MIN_UNCHANGED_RATIO = 0.3;

/** Options controlling the richer inline word-diff overlay. */
export interface DiffDecorationOptions {
  /**
   * Render a Markdown source fragment to HTML (typically `renderMarkdownSync`).
   * Supplied by the view layer so this pure module stays free of the heavy
   * unified pipeline. When provided, modified prose blocks that carry an
   * `originalText` get an inline word-level diff instead of a flat wash.
   */
  renderInline?: (md: string) => string;
  /** Complete Markdown source at the base commit for old-block reconstruction. */
  originalSource?: string;
  /** Complete Markdown source at the current commit for source-only fallbacks. */
  currentSource?: string;
}

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

/** Human-readable corner tag shown on a changed block. */
const KIND_LABEL: Record<"added" | "modified", string> = {
  added: "Added",
  modified: "Edited",
};

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

interface ChangeRange {
  start: number;
  end: number;
  kind: "added" | "modified";
  /** Original source text of the changed lines (modified ranges only). */
  originalText?: string;
  originalStart?: number;
  originalEnd?: number;
}

function numAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * The last source line a block "owns" for change-classification. A list item
 * that contains a nested list only owns the lines up to where that nested list
 * begins — its nested children are their own `<li>` blocks and classify
 * themselves — so a change confined to a child doesn't light up the parent.
 * Falls back to `end` for everything else.
 */
function ownSpanEnd(el: HTMLElement, start: number, end: number): number {
  const nested = el.querySelector<HTMLElement>(":scope > ul, :scope > ol");
  if (nested) {
    const nestedStart = numAttr(nested, "data-source-line");
    /* v8 ignore next -- a nested list always carries a source line greater than its parent item's */
    if (nestedStart != null && nestedStart > start) return nestedStart - 1;
  }
  return end;
}

/** True when [aStart,aEnd] and [bStart,bEnd] share at least one line. */
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Classify a block spanning [start,end]: 'modified' wins over 'added'; null
 * when it doesn't intersect any change.
 */
function classifyBlock(
  start: number,
  end: number,
  ranges: readonly ChangeRange[],
): "added" | "modified" | null {
  let sawAdded = false;
  for (const r of ranges) {
    if (!overlaps(start, end, r.start, r.end)) continue;
    if (r.kind === "modified") return "modified";
    sawAdded = true;
  }
  return sawAdded ? "added" : null;
}

/**
 * Remove any decorations a previous pass applied so the transform stays
 * idempotent across re-renders / section toggles.
 */
function clearDecorations(root: HTMLElement): void {
  root
    .querySelectorAll(".emr-diff-before-control, .emr-diff-before-panel")
    .forEach((el) => el.remove());
  root
    .querySelectorAll(`.${DIFF_CELL_REMOVED_CLASS}`)
    .forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>(`.${DIFF_BLOCK_CLASS}`).forEach((el) => {
    el.classList.remove(
      DIFF_BLOCK_CLASS,
      "emr-diff-block--added",
      "emr-diff-block--modified",
      DIFF_INLINE_CLASS,
      DIFF_MERMAID_CLASS,
      DIFF_IMAGE_CLASS,
    );
    delete el.dataset.diffKind;
    delete el.dataset.diffLabel;
    delete el.dataset.diffGroup;
    delete el.dataset.diffInline;
    delete el.dataset.diffOriginal;
    delete el.dataset.diffCells;
    delete el.dataset.diffAmberMode;
  });
  // Undo per-cell table highlights (wash + inline modifier).
  root
    .querySelectorAll(`.${DIFF_CELL_CLASS}`)
    .forEach((el) =>
      el.classList.remove(
        DIFF_CELL_CLASS,
        DIFF_CELL_INLINE_CLASS,
        DIFF_CELL_ADDED_CLASS,
        DIFF_CELL_METADATA_CLASS,
      ),
    );
  root.querySelectorAll(`.${DIFF_METADATA_CLASS}`).forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>(`.${DIFF_TOOLTIP_CLASS}`).forEach((el) => {
    el.removeEventListener("pointerenter", alignDiffTooltip);
    el.removeEventListener("focus", alignDiffTooltip);
    el.classList.remove(DIFF_TOOLTIP_CLASS);
    el.classList.remove(DIFF_TOOLTIP_RIGHT_CLASS);
    delete el.dataset.diffTooltip;
    delete el.dataset.diffAmberMode;
    if (el.dataset.diffTooltipHadTitle === "true") {
      el.setAttribute("title", el.dataset.diffTooltipPreviousTitle!);
    } else {
      el.removeAttribute("title");
    }
    if (el.dataset.diffTooltipHadTabindex === "true") {
      el.setAttribute("tabindex", el.dataset.diffTooltipPreviousTabindex!);
    } else {
      el.removeAttribute("tabindex");
    }
    delete el.dataset.diffTooltipHadTitle;
    delete el.dataset.diffTooltipPreviousTitle;
    delete el.dataset.diffTooltipHadTabindex;
    delete el.dataset.diffTooltipPreviousTabindex;
    if (el.dataset.diffTooltipHadDescription === "true") {
      el.setAttribute(
        "aria-description",
        el.dataset.diffTooltipPreviousDescription!,
      );
    } else {
      el.removeAttribute("aria-description");
    }
    delete el.dataset.diffTooltipHadDescription;
    delete el.dataset.diffTooltipPreviousDescription;
  });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_SUPPRESSED_TITLE_CLASS}`)
    .forEach((el) => {
      el.classList.remove(DIFF_SUPPRESSED_TITLE_CLASS);
      el.setAttribute("title", el.dataset.diffTooltipPreviousTitle!);
      delete el.dataset.diffTooltipPreviousTitle;
    });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)
    .forEach((element) =>
      element.replaceWith(...Array.from(element.childNodes)),
    );
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_LIST_MARKER_CLASS}`)
    .forEach((element) => {
      element.classList.remove(DIFF_LIST_MARKER_CLASS);
    });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_TASK_STATE_CLASS}`)
    .forEach((element) => {
      element.classList.remove(DIFF_TASK_STATE_CLASS);
    });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_TASK_TOOLTIP_CLASS}`)
    .forEach((wrapper) =>
      wrapper.replaceWith(...Array.from(wrapper.childNodes)),
    );
  // Undo any inline word-diff overlay: drop the removed-word insertions and
  // unwrap the added-word marks back to plain text so a re-decorate is stable.
  root.querySelectorAll(`.${WORD_REMOVED_CLASS}`).forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>(`.${WORD_ADDED_CLASS}`).forEach((el) => {
    /* v8 ignore next -- element textContent is never null */
    el.replaceWith(el.ownerDocument.createTextNode(el.textContent ?? ""));
  });
  root
    .querySelectorAll(
      `.${DIFF_DELETED_MARKER_CLASS}, .emr-diff-deleted-table-row`,
    )
    .forEach((el) => el.remove());
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_TABLE_COMPARISON_CLASS}`)
    .forEach((wrapper) =>
      wrapper.replaceWith(...Array.from(wrapper.childNodes)),
    );
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_SOURCE_ONLY_CLASS}`)
    .forEach((element) => element.remove());
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

  const changeRanges: ChangeRange[] = [];
  const deletedRanges: DiffRange[] = [];
  for (const r of ranges) {
    if (r.kind === "deleted-marker") deletedRanges.push(r);
    else
      changeRanges.push({
        start: r.startLine,
        end: r.endLine,
        kind: r.kind,
        originalText: r.originalText,
        originalStart: r.originalStartLine,
        originalEnd: r.originalEndLine,
      });
  }
  const originalLines = options?.originalSource?.split(/\r\n|\r|\n/);

  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));

  const decoratedEls: HTMLElement[] = [];
  let decorated = 0;
  let inlined = 0;
  for (const el of blocks) {
    const start = numAttr(el, "data-source-line");
    const end = numAttr(el, "data-source-end-line");
    if (start == null || end == null) continue;
    // Avoid stacking bars: if an ancestor block is already decorated
    // (e.g. a <li> inside a marked <ul>), let the outer bar stand alone.
    if (el.parentElement!.closest(`.${DIFF_BLOCK_CLASS}`)) continue;
    // A list item that contains a nested list "owns" only the lines up to
    // where that nested list starts — the nested items are their own <li>
    // blocks and decorate themselves. Without this, changing a nested child
    // would light up the whole parent item.
    const ownEnd = ownSpanEnd(el, start, end);
    const kind = classifyBlock(start, ownEnd, changeRanges);
    if (!kind) continue;
    el.classList.add(
      DIFF_BLOCK_CLASS,
      kind === "added" ? "emr-diff-block--added" : "emr-diff-block--modified",
    );
    el.dataset.diffKind = kind;
    el.dataset.diffLabel = KIND_LABEL[kind];
    if (isImageOnlyBlock(el)) el.classList.add(DIFF_IMAGE_CLASS);
    decorated++;
    decoratedEls.push(el);

    // For a reworded prose block, overlay an inline word-level diff so only
    // the changed words are coloured. Requires the caller's `renderInline` so
    // we can compare RENDERED-plain-text (not raw Markdown) on both sides.
    if (
      kind === "modified" &&
      options?.renderInline &&
      PROSE_TAGS.has(el.tagName)
    ) {
      const range = soleModifiedRange(start, end, changeRanges);
      // The change range must COVER the block's whole source span. Otherwise
      // `originalText` (only the changed lines) is a fragment of the block's
      // text, and word-diffing it against the full rendered block would mark
      // the unchanged remainder as "added". When only part of a multi-line
      // block changed, fall back to the block wash.
      const coversBlock =
        range != null && range.start <= start && range.end >= end;
      const reconstructed = reconstructOriginalBlock(
        start,
        end,
        changeRanges,
        options.originalSource,
        originalLines,
      );
      let originalMarkdown = reconstructed;
      if (originalMarkdown == null && coversBlock) {
        originalMarkdown = range!.originalText ?? null;
      }
      if (
        originalMarkdown != null &&
        tryInlineWordDiff(el, originalMarkdown, options.renderInline)
      ) {
        el.classList.add(DIFF_INLINE_CLASS);
        el.dataset.diffInline = "true";
        inlined++;
      }
    }

    // For an edited TABLE ROW, highlight only the CELLS that changed rather
    // than the whole row. The line-based diff can't isolate a cell on its own,
    // but the original row's source is available, so we split both rows into
    // cells and compare them — turning a "single cell edit" or "column edit"
    // into precise per-cell highlights.
    if (kind === "modified" && options?.renderInline && el.tagName === "TR") {
      const range = soleModifiedRange(start, ownEnd, changeRanges);
      // `soleModifiedRange`/`overlaps` guarantees the range covers this row's
      // line, so `start - range.start` indexes the row's original source. A
      // range without `originalText` (or an out-of-range index) yields a falsy
      // `originalRow` and simply falls back to the whole-row tint.
      const originalRow =
        range?.originalText != null
          ? range.originalText.split(/\r\n|\r|\n/)[start - range.start]
          : undefined;
      if (originalRow && range) {
        const columnAlignment = el.closest("thead")
          ? undefined
          : resolveTableColumnAlignment(el, range, options.renderInline);
        const tableDiff = diffTableRowCells(
          el,
          originalRow,
          options.renderInline,
          columnAlignment,
        );
        if (tableDiff === "precise") {
          el.dataset.diffCells = "true";
        } else if (tableDiff === "unchanged") {
          el.classList.remove(DIFF_BLOCK_CLASS, "emr-diff-block--modified");
          delete el.dataset.diffKind;
          delete el.dataset.diffLabel;
          decorated--;
          decoratedEls.pop();
        } else {
          attachTableBeforeDisclosure(el, range, options.renderInline);
        }
      }
    }

    if (kind === "modified" && options?.renderInline && el.tagName === "PRE") {
      const range = soleModifiedRange(start, end, changeRanges);
      const coversBlock =
        range != null && range.start <= start && range.end >= end;
      const reconstructed = reconstructOriginalBlock(
        start,
        end,
        changeRanges,
        options.originalSource,
        originalLines,
      );
      let originalMarkdown = reconstructed;
      if (originalMarkdown == null && coversBlock) {
        originalMarkdown = range!.originalText ?? null;
      }
      const metadataChange =
        originalMarkdown != null
          ? readCodeMetadataChange(el, originalMarkdown, options.renderInline)
          : null;
      const hasInlineDiff =
        originalMarkdown != null &&
        tryInlineWordDiff(el, originalMarkdown, options.renderInline);
      if (metadataChange) {
        applySimpleMetadataIndicator(
          el,
          metadataChange.label,
          metadataChange.before,
          metadataChange.after,
        );
      }
      if (hasInlineDiff || metadataChange?.contentUnchanged) {
        el.classList.add(DIFF_INLINE_CLASS);
        el.dataset.diffInline = "true";
        inlined++;
      }
    }

    // For a frontmatter row, express the value change as a simple inline
    // word-diff of its (comma-joined) value text: added words green, removed
    // words struck red, unchanged neutral. This never washes the value cell
    // (so a list never paints a bar stretching to the right) and reuses the
    // same word-diff machinery as prose blocks.
    if (el.classList.contains(FRONTMATTER_ROW_CLASS)) {
      if (decorateFrontmatterValue(el, kind, start, ownEnd, changeRanges)) {
        el.dataset.diffInline = "true";
      }
    }

    if (
      kind === "modified" &&
      options?.renderInline &&
      el.tagName !== "TR" &&
      !el.classList.contains(FRONTMATTER_ROW_CLASS) &&
      !el.classList.contains(DIFF_IMAGE_CLASS) &&
      !el.classList.contains(DIFF_INLINE_CLASS) &&
      el.dataset.diffInline !== "true"
    ) {
      const originalBlock = reconstructOriginalBlock(
        start,
        end,
        changeRanges,
        options.originalSource,
        originalLines,
      );
      if (originalBlock) {
        attachBlockBeforeDisclosure(el, originalBlock, options.renderInline);
      }
    }

    if (
      kind === "modified" &&
      el.classList.contains("emr-diff-block--modified") &&
      !el.classList.contains(DIFF_IMAGE_CLASS) &&
      !el.classList.contains(DIFF_INLINE_CLASS) &&
      el.dataset.diffInline !== "true" &&
      el.dataset.diffCells !== "true" &&
      el.dataset.diffAmberMode == null &&
      !el.querySelector(`.${DIFF_TOOLTIP_CLASS}`)
    ) {
      applyDiffTooltip(
        el,
        "Previous content unavailable; exact comparison cannot be shown",
      );
    }
  }

  // Merge contiguous same-kind blocks into a single visual group so a run of
  // added (or edited) siblings reads as one card with one corner tag.
  markContiguousGroups(decoratedEls);

  // Mermaid diagrams: a rendered diagram can't be word- or wash-diffed, so a
  // changed diagram gets a quiet left accent bar (hue by kind) and stashes its
  // original source so the "Source" modal can show the full diagram diff.
  for (const el of root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)) {
    const start = numAttr(el, "data-source-line");
    const end = numAttr(el, "data-source-end-line");
    if (start == null || end == null) continue;
    if (el.parentElement?.closest(`.${DIFF_BLOCK_CLASS}`)) continue;
    const kind = classifyBlock(start, end, changeRanges);
    if (!kind) continue;
    el.classList.add(
      DIFF_BLOCK_CLASS,
      kind === "added" ? "emr-diff-block--added" : "emr-diff-block--modified",
      DIFF_MERMAID_CLASS,
    );
    el.dataset.diffKind = kind;
    // Stash the original diagram source (fence stripped) for the Source modal,
    // but only when the change spans essentially the WHOLE diagram body — a
    // narrow single-line edit would leave `originalText` a fragment, making the
    // modal diff misleading. The ±1 tolerance covers the common case where the
    // fenced markers are unchanged but every inner line changed.
    const range = soleModifiedRange(start, end, changeRanges);
    if (
      range?.originalText != null &&
      range.start <= start + 1 &&
      range.end >= end - 1
    ) {
      const originalSource = stripMermaidFence(range.originalText);
      if (originalSource) el.dataset.diffOriginal = originalSource;
    }
    decorated++;
  }

  const markerAnchors = Array.from(
    root.querySelectorAll<HTMLElement>(
      `${BLOCK_SELECTOR}, ${MERMAID_SELECTOR}`,
    ),
  );
  if (options?.currentSource) {
    const currentLines = options.currentSource.split(/\r\n|\r|\n/);
    const renderedSpans = markerAnchors.flatMap((element) => {
      const start = numAttr(element, "data-source-line");
      const end = numAttr(element, "data-source-end-line");
      return start == null || end == null ? [] : [{ start, end }];
    });
    for (const range of changeRanges) {
      if (
        renderedSpans.some((span) =>
          overlaps(span.start, span.end, range.start, range.end),
        )
      ) {
        continue;
      }
      const currentText = currentLines
        .slice(range.start - 1, range.end)
        .join("\n");
      if (currentText.trim().length === 0) continue;
      const marker = buildSourceOnlyMarker(
        range,
        currentText,
        root.ownerDocument,
      );
      const anchor = firstBlockAtOrAfter(markerAnchors, range.start);
      if (anchor?.parentElement)
        anchor.parentElement.insertBefore(marker, anchor);
      else root.appendChild(marker);
      decorated++;
    }
  }

  // Deletion markers: lines removed have no surviving DOM, so we insert a
  // thin marker just before the block that now occupies the deletion's
  // line, and stash the removed text for a hover/expand affordance.
  //
  // Anchor candidates must also include Mermaid placeholders (decorated in a
  // separate pass, so absent from `blocks`) — otherwise a deletion sitting
  // right before a diagram would skip past it and land on a later block, or
  // fall through to being appended at the very end. The combined selector
  // returns nodes in document order, which matches source order.
  let markers = 0;
  for (const r of deletedRanges) {
    const anchor = firstBlockAtOrAfter(markerAnchors, r.startLine);
    const tableMarker = options?.renderInline
      ? buildDeletedTableRows(r, anchor, markerAnchors, options.renderInline)
      : null;
    if (tableMarker) {
      const { parent, before, rows } = tableMarker;
      for (const row of rows) parent.insertBefore(row, before);
      markers++;
      continue;
    }
    const marker = buildDeletedMarker(r, options?.renderInline);
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(marker, anchor);
    } else {
      root.appendChild(marker);
    }
    markers++;
  }

  return { decorated, markers, inlined };
}

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

type TableCellAlignment =
  | { kind: "equal" | "modified"; originalIndex: number; currentIndex: number }
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

  const originalCounts = countTableValues(original);
  const currentCounts = countTableValues(current);
  const isAnchor = (originalIndex: number, currentIndex: number): boolean => {
    const value = original[originalIndex]!;
    return (
      value !== "" &&
      value === current[currentIndex] &&
      originalCounts.get(value) === 1 &&
      currentCounts.get(value) === 1
    );
  };

  const costs = Array.from({ length: original.length + 1 }, () =>
    Array<number>(current.length + 1).fill(0),
  );
  for (let i = 0; i <= original.length; i++) costs[i]![0] = i;
  for (let j = 0; j <= current.length; j++) costs[0]![j] = j;
  for (let i = 1; i <= original.length; i++) {
    for (let j = 1; j <= current.length; j++) {
      const substitution =
        costs[i - 1]![j - 1]! + (isAnchor(i - 1, j - 1) ? 0 : 1);
      costs[i]![j] = Math.min(
        substitution,
        costs[i - 1]![j]! + 1,
        costs[i]![j - 1]! + 1,
      );
    }
  }

  const reversed: TableCellAlignment[] = [];
  let equalCount = 0;
  let i = original.length;
  let j = current.length;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      isAnchor(i - 1, j - 1) &&
      costs[i]![j] === costs[i - 1]![j - 1]
    ) {
      reversed.push({
        kind: "equal",
        originalIndex: i - 1,
        currentIndex: j - 1,
      });
      equalCount++;
      i--;
      j--;
    } else if (i > 0 && j > 0 && costs[i]![j] === costs[i - 1]![j - 1]! + 1) {
      reversed.push({
        kind: "modified",
        originalIndex: i - 1,
        currentIndex: j - 1,
      });
      i--;
      j--;
    } else if (j > 0 && costs[i]![j] === costs[i]![j - 1]! + 1) {
      reversed.push({ kind: "added", currentIndex: j - 1 });
      j--;
    } else {
      reversed.push({
        kind: "removed",
        originalIndex: i - 1,
        currentIndex: j,
      });
      i--;
    }
  }
  return equalCount > 0 ? reversed.reverse() : null;
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
  for (
    let originalIndex = 0;
    originalIndex < original.length;
    originalIndex++
  ) {
    const value = original[originalIndex]!;
    if (
      value === "" ||
      originalCounts.get(value) !== 1 ||
      currentCounts.get(value) !== 1
    ) {
      continue;
    }
    const currentIndex = current.indexOf(value);
    currentByOriginal.set(originalIndex, currentIndex);
    originalByCurrent.set(currentIndex, originalIndex);
  }

  if (original.length === current.length) {
    const allExact = currentByOriginal.size === original.length;
    return current.map((value, currentIndex) => {
      const originalIndex = allExact
        ? originalByCurrent.get(currentIndex)!
        : currentIndex;
      return {
        kind: value === original[originalIndex] ? "equal" : "modified",
        originalIndex,
        currentIndex,
      };
    });
  }

  if (currentByOriginal.size === 0) return null;
  const unmatchedOriginal = original
    .map((_, index) => index)
    .filter((index) => !currentByOriginal.has(index));
  const unmatchedCurrent = current
    .map((_, index) => index)
    .filter((index) => !originalByCurrent.has(index));
  if (unmatchedOriginal.length > 0 && unmatchedCurrent.length > 0) return null;

  const alignment: TableCellAlignment[] = current.map((_, currentIndex) => {
    const originalIndex = originalByCurrent.get(currentIndex);
    return originalIndex == null
      ? { kind: "added", currentIndex }
      : { kind: "equal", originalIndex, currentIndex };
  });
  for (const originalIndex of unmatchedOriginal) {
    const nextMappedOriginal = [...currentByOriginal.keys()]
      .filter((index) => index > originalIndex)
      .sort((a, b) => a - b)[0];
    const currentIndex =
      nextMappedOriginal == null
        ? current.length
        : currentByOriginal.get(nextMappedOriginal)!;
    const insertionIndex = alignment.findIndex(
      (item) => item.currentIndex >= currentIndex,
    );
    alignment.splice(
      insertionIndex < 0 ? alignment.length : insertionIndex,
      0,
      {
        kind: "removed",
        originalIndex,
        currentIndex,
      },
    );
  }
  return alignment;
}

function resolveTableColumnAlignment(
  row: HTMLElement,
  range: ChangeRange,
  renderInline: (md: string) => string,
): TableCellAlignment[] | null | undefined {
  const headerRow = row
    .closest("table")!
    .querySelector<HTMLElement>("thead tr")!;
  const headerLine = numAttr(headerRow, "data-source-line");
  if (
    headerLine == null ||
    headerLine < range.start ||
    headerLine > range.end
  ) {
    return undefined;
  }
  const originalHeader =
    range.originalText!.split(/\r\n|\r|\n/)[headerLine - range.start]!;
  const originalHeaders = renderTableSourceTexts(originalHeader, renderInline);
  const currentHeaders = Array.from(
    headerRow.querySelectorAll<HTMLElement>("th, td"),
  )
    .filter((cell) => !cell.classList.contains(DIFF_CELL_REMOVED_CLASS))
    .map(readCurrentTableCellText);
  return alignTableColumns(originalHeaders, currentHeaders);
}

function readCurrentTableCellText(cell: HTMLElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(`.${WORD_REMOVED_CLASS}, .${DIFF_METADATA_CLASS}`)
    .forEach((element) => element.remove());
  /* v8 ignore next -- cloned table cells always have textContent */
  return clone.textContent?.trim() ?? "";
}

function renderTableSourceTexts(
  row: string,
  renderInline: (md: string) => string,
): string[] {
  const scratch = document.createElement("div");
  return splitTableRow(row).map((source) => {
    scratch.innerHTML = renderInline(source);
    const content = scratch.querySelector("p") ?? scratch;
    /* v8 ignore next -- rendered fragments always have textContent */
    return (content.textContent ?? "").trim();
  });
}

function attachTableBeforeDisclosure(
  row: HTMLElement,
  range: ChangeRange,
  renderInline: (md: string) => string,
): void {
  /* v8 ignore next -- caller invokes disclosure only for ranges carrying original text */
  if (range.originalText == null) return;
  row.dataset.diffAmberMode = "comparison";
  const table = row.closest<HTMLTableElement>("table");
  let parent = table!.parentElement!;
  if (!parent.classList.contains(DIFF_TABLE_COMPARISON_CLASS)) {
    const wrapper = table!.ownerDocument.createElement("div");
    wrapper.className = DIFF_TABLE_COMPARISON_CLASS;
    parent.insertBefore(wrapper, table!);
    wrapper.appendChild(table!);
    parent = wrapper;
  }
  const key = `${range.start}:${range.end}`;
  if (
    Array.from(
      parent.querySelectorAll<HTMLElement>(".emr-diff-before-control"),
    ).some((control) => control.dataset.diffBeforeKey === key)
  ) {
    return;
  }

  const control = document.createElement("div");
  control.className = "emr-diff-before-control";
  control.dataset.diffBeforeKey = key;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "emr-diff-before-trigger";
  trigger.textContent = "Before";
  trigger.setAttribute("aria-label", "Show previous version");
  trigger.setAttribute("aria-expanded", "false");
  const panel = document.createElement("div");
  panel.className = "emr-diff-before-panel markdown-body";
  panel.id = `emr-diff-before-table-${range.start}-${range.end}`;
  panel.hidden = true;
  trigger.setAttribute("aria-controls", panel.id);
  const label = document.createElement("span");
  label.className = "emr-diff-before-label";
  label.textContent = "Before";
  const content = document.createElement("div");
  content.className = "emr-diff-before-content";
  content.appendChild(
    buildBeforeTableContent(
      range.originalText,
      renderInline,
      row.ownerDocument,
    ),
  );
  panel.append(label, content);
  trigger.addEventListener("click", () => {
    const open = panel.hidden === true;
    panel.hidden = !open;
    trigger.textContent = open ? "Hide" : "Before";
    trigger.setAttribute(
      "aria-label",
      open ? "Hide previous version" : "Show previous version",
    );
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  control.appendChild(trigger);
  parent.insertBefore(control, table);
  parent.insertBefore(panel, table);
}

function buildBeforeTableContent(
  markdown: string,
  renderInline: (md: string) => string,
  doc: Document,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const rendered = doc.createElement("div");
  rendered.innerHTML = renderInline(markdown);
  if (rendered.querySelector("table")) {
    while (rendered.firstChild) fragment.appendChild(rendered.firstChild);
    return fragment;
  }

  const lines = markdown.split(/\r\n|\r|\n/);
  const rows = lines.map(splitTableRow);
  const columnCount = rows[0]!.length;
  const isRowFragment =
    columnCount >= 2 &&
    lines.every((line) => /^\s*\|.*\|\s*$/.test(line)) &&
    rows.every((cells) => cells.length === columnCount);
  if (!isRowFragment) {
    while (rendered.firstChild) fragment.appendChild(rendered.firstChild);
    return fragment;
  }

  const delimiter = `| ${Array(columnCount).fill("---").join(" | ")} |`;
  rendered.innerHTML = renderInline(
    [lines[0]!, delimiter, ...lines.slice(1)].join("\n"),
  );
  const table = rendered.querySelector<HTMLTableElement>("table")!;
  const headerRow = table.querySelector<HTMLTableRowElement>("thead tr")!;
  for (const header of Array.from(headerRow.querySelectorAll("th"))) {
    const cell = doc.createElement("td");
    cell.innerHTML = header.innerHTML;
    header.replaceWith(cell);
  }
  const body = table.tBodies[0] ?? table.createTBody();
  body.prepend(headerRow);
  table.tHead?.remove();
  fragment.appendChild(table);
  return fragment;
}

export function reconstructOriginalBlock(
  blockStart: number,
  blockEnd: number,
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

  if (!originalSource) return null;
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

function attachBlockBeforeDisclosure(
  block: HTMLElement,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): void {
  block.dataset.diffAmberMode = "comparison";
  const control = document.createElement("div");
  control.className = "emr-diff-before-control emr-diff-before-control--block";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "emr-diff-before-trigger";
  trigger.textContent = "Before";
  trigger.setAttribute("aria-label", "Show previous version");
  trigger.setAttribute("aria-expanded", "false");
  /* v8 ignore next 2 -- callers only pass source-position-stamped rendered blocks */
  const blockStart = numAttr(block, "data-source-line") ?? 0;
  /* v8 ignore next -- source-position-stamped rendered blocks always carry an end line */
  const blockEnd = numAttr(block, "data-source-end-line") ?? blockStart;
  const panel = document.createElement("div");
  panel.className =
    "emr-diff-before-panel emr-diff-before-panel--block markdown-body";
  panel.id = `emr-diff-before-${block.tagName.toLowerCase()}-${blockStart}-${blockEnd}`;
  panel.hidden = true;
  trigger.setAttribute("aria-controls", panel.id);
  const label = document.createElement("span");
  label.className = "emr-diff-before-label";
  label.textContent = "Before";
  const content = document.createElement("div");
  content.className = "emr-diff-before-content";
  const scratch = document.createElement("div");
  scratch.innerHTML = renderInline(originalMarkdown);
  const originalBlock = scratch.querySelector<HTMLElement>(block.tagName);
  if (originalBlock) {
    if (block.tagName === "LI") {
      while (originalBlock.firstChild) {
        content.appendChild(originalBlock.firstChild);
      }
    } else {
      content.appendChild(originalBlock);
    }
  } else {
    while (scratch.firstChild) content.appendChild(scratch.firstChild);
  }
  panel.append(label, content);
  trigger.addEventListener("click", () => {
    const open = panel.hidden === true;
    panel.hidden = !open;
    trigger.textContent = open ? "Hide" : "Before";
    trigger.setAttribute(
      "aria-label",
      open ? "Hide previous version" : "Show previous version",
    );
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  control.appendChild(trigger);

  if (block.tagName === "LI") {
    block.prepend(panel);
    block.prepend(control);
  } else {
    block.parentElement!.insertBefore(control, block);
    block.parentElement!.insertBefore(panel, block);
  }
}

function buildSourceOnlyMarker(
  range: ChangeRange,
  currentText: string,
  doc: Document,
): HTMLElement {
  const marker = doc.createElement("div");
  marker.className = `${DIFF_SOURCE_ONLY_CLASS} emr-diff-block--${range.kind}`;
  marker.dataset.diffKind = range.kind;
  marker.dataset.sourceLine = String(range.start);
  marker.dataset.sourceEndLine = String(range.end);

  const label = doc.createElement("span");
  label.className = "emr-diff-source-only-label";
  label.textContent =
    range.kind === "added" ? "Source added" : "Source changed";
  const source = doc.createElement("pre");
  source.className = "emr-diff-source-only-current";
  const code = doc.createElement("code");
  code.textContent = currentText;
  source.appendChild(code);

  if (range.kind === "modified" && range.originalText != null) {
    const control = doc.createElement("div");
    control.className =
      "emr-diff-before-control emr-diff-before-control--source";
    const trigger = doc.createElement("button");
    trigger.type = "button";
    trigger.className = "emr-diff-before-trigger";
    trigger.textContent = "Before";
    trigger.setAttribute("aria-label", "Show previous source");
    trigger.setAttribute("aria-expanded", "false");
    const panel = doc.createElement("div");
    panel.className =
      "emr-diff-before-panel emr-diff-before-panel--source markdown-body";
    panel.id = `emr-diff-before-source-${range.start}-${range.end}`;
    panel.hidden = true;
    trigger.setAttribute("aria-controls", panel.id);
    const previous = doc.createElement("pre");
    const previousCode = doc.createElement("code");
    previousCode.textContent = range.originalText;
    previous.appendChild(previousCode);
    panel.appendChild(previous);
    trigger.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      trigger.textContent = open ? "Hide" : "Before";
      trigger.setAttribute(
        "aria-label",
        open ? "Hide previous source" : "Show previous source",
      );
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    control.appendChild(trigger);
    marker.append(control, panel);
  }

  marker.append(label, source);
  return marker;
}

/**
 * Highlight only the CHANGED cells of an edited table row by comparing the
 * rendered original row against the live one. `originalRow` is the row's
 * Markdown source (`| a | b |`); each original cell is rendered to plain text
 * (so `` `code` ``/formatting never reads as a spurious change) and compared
 * with the matching live `<td>`/`<th>`. Marks each differing cell and returns
 * true when at least one cell was marked (so the caller can suppress the
 * whole-row tint). Unequal rows align around unchanged cells; a row with no
 * trustworthy anchor falls back to the whole-row tint.
 */
function diffTableRowCells(
  tr: HTMLElement,
  originalRow: string,
  renderInline: (md: string) => string,
  columnAlignment?: TableCellAlignment[] | null,
): "precise" | "unchanged" | "ambiguous" {
  const cells = Array.from(tr.children).filter(
    (c): c is HTMLElement => c.tagName === "TD" || c.tagName === "TH",
  );
  const doc = tr.ownerDocument;
  const scratch = doc.createElement("div");
  const originalSignatures: string[] = [];
  const originalRenderedCells: HTMLElement[] = [];
  const originalCells = splitTableRow(originalRow).map((source) => {
    scratch.innerHTML = renderInline(source);
    const content = scratch.querySelector("p") ?? scratch;
    originalSignatures.push(tableCellStructureSignature(content));
    originalRenderedCells.push(content.cloneNode(true) as HTMLElement);
    /* v8 ignore next -- textContent is never null on an element */
    return (content.textContent ?? "").trim();
  });
  const currentCells = cells.map((cell) => {
    /* v8 ignore next -- textContent is never null on an element */
    return (cell.textContent ?? "").trim();
  });
  const rawAlignment =
    columnAlignment === undefined
      ? alignTableCells(originalCells, currentCells)
      : columnAlignment;
  if (!rawAlignment) return "ambiguous";
  /* v8 ignore start -- column alignments are constructed from the same header widths; guard remains defensive */
  if (
    rawAlignment.some((item) => {
      if (item.kind === "added") {
        return item.currentIndex >= currentCells.length;
      }
      if (item.kind === "removed") {
        return (
          item.originalIndex >= originalCells.length ||
          item.currentIndex > currentCells.length
        );
      }
      return (
        item.originalIndex >= originalCells.length ||
        item.currentIndex >= currentCells.length
      );
    })
  ) {
    return "ambiguous";
  }
  /* v8 ignore stop */
  const alignment = rawAlignment.map((item): TableCellAlignment => {
    if (item.kind === "added" || item.kind === "removed") return item;
    return {
      ...item,
      kind:
        originalCells[item.originalIndex] === currentCells[item.currentIndex]
          ? "equal"
          : "modified",
    };
  });

  let marked = 0;
  for (const item of alignment) {
    if (item.kind === "equal") {
      const cell = cells[item.currentIndex]!;
      const contentDiff = diffInlineContent(
        originalRenderedCells[item.originalIndex]!,
        cell,
      );
      if (contentDiff.handled) {
        cell.classList.add(DIFF_CELL_CLASS);
        if (contentDiff.formattingChanged) {
          cell.classList.add(DIFF_CELL_INLINE_CLASS);
        }
        if (contentDiff.metadataChanged) {
          cell.classList.add(DIFF_CELL_METADATA_CLASS);
        }
        marked++;
      } else if (
        originalSignatures[item.originalIndex] !==
        tableCellStructureSignature(cell)
      ) {
        cell.classList.add(DIFF_CELL_CLASS);
        applyDiffTooltip(
          cell,
          `Rendered structure changed from ${describeRenderedStructure(originalRenderedCells[item.originalIndex]!)} to ${describeRenderedStructure(cell)}`,
        );
        marked++;
      }
      continue;
    }
    if (item.kind === "removed") {
      /* v8 ignore next -- a rendered table row reaching this path always has at least one td/th */
      const removedCell = doc.createElement(cells[0]?.tagName ?? "td");
      removedCell.classList.add(
        DIFF_CELL_CLASS,
        DIFF_CELL_INLINE_CLASS,
        DIFF_CELL_REMOVED_CLASS,
      );
      applyInlineWordDiff(
        removedCell,
        diffWords(originalCells[item.originalIndex]!, ""),
      );
      tr.insertBefore(removedCell, cells[item.currentIndex] ?? null);
      marked++;
      continue;
    }

    const cell = cells[item.currentIndex]!;
    if (item.kind === "added") {
      cell.classList.add(DIFF_CELL_CLASS, DIFF_CELL_ADDED_CLASS);
      marked++;
      continue;
    }
    const contentDiff = diffInlineContent(
      originalRenderedCells[item.originalIndex]!,
      cell,
    );
    cell.classList.add(DIFF_CELL_CLASS);
    marked++;
    cell.classList.add(DIFF_CELL_INLINE_CLASS);
    if (contentDiff.metadataChanged) {
      cell.classList.add(DIFF_CELL_METADATA_CLASS);
    }
  }
  if (marked > 0 || columnAlignment !== undefined) return "precise";
  return "unchanged";
}

/**
 * Text-independent shape of rich cell content. Keeps element names and the
 * attributes that change meaning/navigation, while ignoring renderer-only
 * source-position metadata and the words handled by the word diff itself.
 */
function tableCellStructureSignature(root: Element): string {
  const parts: string[] = [];
  const visit = (element: Element): void => {
    const semanticAttributes = ["href", "src", "title"]
      .map((name) => [name, element.getAttribute(name)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] != null)
      .map(([name, value]) => `${name}=${value}`)
      .join(",");
    parts.push(`<${element.tagName.toLowerCase()}${semanticAttributes}>`);
    for (const child of Array.from(element.children)) visit(child);
    parts.push(`</${element.tagName.toLowerCase()}>`);
  };
  for (const child of Array.from(root.children)) visit(child);
  return parts.join("");
}

function describeRenderedStructure(root: Element): string {
  const nameByTag: Record<string, string> = {
    A: "link",
    CODE: "inline code",
    DEL: "strikethrough",
    EM: "italic",
    IMG: "image",
    SPAN: "span",
    STRONG: "bold",
  };
  const names = Array.from(
    root.querySelectorAll("strong, em, code, del, a, img, span"),
  ).map((element) => nameByTag[element.tagName]!);
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return "plain text";
  if (unique.length === 1) return unique[0]!;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

interface LinkTargetChange {
  index: number;
  before: string;
  after: string;
  hostChanged: boolean;
}

interface FormattingRange {
  tag: string;
  start: number;
  end: number;
  detail?: string;
}

interface ExplainedTextRange {
  start: number;
  end: number;
  label: string;
}

const INLINE_FORMAT_TAGS = new Set(["STRONG", "EM", "CODE", "DEL", "A"]);
const FORMAT_NAME_BY_TAG: Record<string, string> = {
  A: "link",
  CODE: "inline code",
  DEL: "strikethrough",
  EM: "italic",
  STRONG: "bold",
};

function formattingRanges(root: Element): FormattingRange[] {
  const ranges: FormattingRange[] = [];
  let offset = 0;
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      /* v8 ignore next -- Text.textContent is never null */
      offset += node.textContent?.length ?? 0;
      return;
    }
    /* v8 ignore next -- rendered content traversal only encounters text and element nodes */
    if (!(node instanceof Element)) return;
    const start = offset;
    for (const child of Array.from(node.childNodes)) visit(child);
    if (INLINE_FORMAT_TAGS.has(node.tagName) && offset > start) {
      ranges.push({
        tag: node.tagName,
        start,
        end: offset,
        detail: node.tagName === "A" ? node.getAttribute("href")! : undefined,
      });
    }
  };
  for (const child of Array.from(root.childNodes)) visit(child);
  return ranges;
}

function formattingRangeKey(range: FormattingRange): string {
  return `${range.tag}:${range.start}:${range.end}`;
}

function formattingName(tag: string): string {
  return FORMAT_NAME_BY_TAG[tag]!;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function compactTooltipValue(value: string, limit = 96): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function formatDescription(ranges: readonly FormattingRange[]): string {
  const link = ranges.find((range) => range.tag === "A");
  const parts = Array.from(
    new Set(
      ranges
        .filter((range) => range.tag !== "A")
        .map((range) => formattingName(range.tag)),
    ),
  );
  if (link) {
    parts.push(`link to ${compactTooltipValue(link.detail!)}`);
  }
  if (parts.length < 2) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function describeFormattingChange(
  beforeRanges: readonly FormattingRange[],
  afterRanges: readonly FormattingRange[],
): string {
  const before = formatDescription(beforeRanges);
  const after = formatDescription(afterRanges);
  const beforeLink = beforeRanges.find((range) => range.tag === "A");
  const afterLink = afterRanges.find((range) => range.tag === "A");
  if (beforeRanges.length === 0) {
    return afterLink && afterRanges.length === 1
      ? `Link added: ${compactTooltipValue(afterLink.detail!)}`
      : `${capitalize(after)} formatting added`;
  }
  if (afterRanges.length === 0) {
    return beforeLink && beforeRanges.length === 1
      ? `Link removed: ${compactTooltipValue(beforeLink.detail!)}`
      : `${capitalize(before)} formatting removed`;
  }
  return `Formatting changed from ${before} to ${after}`;
}

function formattingChangeRanges(
  originalRanges: readonly FormattingRange[],
  currentRanges: readonly FormattingRange[],
): ExplainedTextRange[] {
  const originalKeys = new Set(originalRanges.map(formattingRangeKey));
  const currentKeys = new Set(currentRanges.map(formattingRangeKey));
  const removed = originalRanges.filter(
    (range) => !currentKeys.has(formattingRangeKey(range)),
  );
  const added = currentRanges.filter(
    (range) => !originalKeys.has(formattingRangeKey(range)),
  );
  const sorted = [...removed, ...added]
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged.map(({ start, end }) => ({
    start,
    end,
    label: describeFormattingChange(
      removed.filter((range) => range.start < end && start < range.end),
      added.filter((range) => range.start < end && start < range.end),
    ),
  }));
}

function applyDiffTooltip(target: HTMLElement, label: string): void {
  target.dataset.diffTooltipHadTitle = String(target.hasAttribute("title"));
  target.dataset.diffTooltipPreviousTitle = target.getAttribute("title") ?? "";
  target.dataset.diffTooltipHadTabindex = String(
    target.hasAttribute("tabindex"),
  );
  target.dataset.diffTooltipPreviousTabindex =
    target.getAttribute("tabindex") ?? "";
  target.dataset.diffTooltipHadDescription = String(
    target.hasAttribute("aria-description"),
  );
  target.dataset.diffTooltipPreviousDescription =
    target.getAttribute("aria-description") ?? "";
  target.classList.add(DIFF_TOOLTIP_CLASS);
  target.dataset.diffTooltip = label;
  target.dataset.diffAmberMode = "explained";
  target.setAttribute("aria-description", label);
  target.removeAttribute("title");
  if (!target.hasAttribute("tabindex")) target.tabIndex = 0;
  target.addEventListener("pointerenter", alignDiffTooltip);
  target.addEventListener("focus", alignDiffTooltip);
}

function alignDiffTooltip(event: Event): void {
  const target = event.currentTarget as HTMLElement;
  const article = target.closest<HTMLElement>(".emr-rendered");
  /* v8 ignore next -- explained changes are always rendered inside the article */
  if (!article) return;
  const targetRect = target.getBoundingClientRect();
  const articleRect = article.getBoundingClientRect();
  const targetCenter = targetRect.left + targetRect.width / 2;
  const articleCenter = articleRect.left + articleRect.width / 2;
  target.classList.toggle(
    DIFF_TOOLTIP_RIGHT_CLASS,
    targetCenter > articleCenter,
  );
}

function suppressNativeTitle(target: HTMLElement): void {
  target.classList.add(DIFF_SUPPRESSED_TITLE_CLASS);
  target.dataset.diffTooltipPreviousTitle = target.getAttribute("title")!;
  target.removeAttribute("title");
}

function wrapFormattingRanges(
  root: HTMLElement,
  ranges: readonly ExplainedTextRange[],
): void {
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  const titledAncestors = new Set<HTMLElement>();
  let offset = 0;
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    nodes.push({ node: text, start: offset, end: offset + text.data.length });
    offset += text.data.length;
    node = walker.nextNode();
  }
  for (const entry of nodes) {
    const overlaps = ranges.filter(
      (range) => range.start < entry.end && entry.start < range.end,
    );
    if (overlaps.length === 0) continue;
    const fragment = root.ownerDocument.createDocumentFragment();
    let cursor = 0;
    for (const range of overlaps) {
      const start = Math.max(range.start, entry.start) - entry.start;
      const end = Math.min(range.end, entry.end) - entry.start;
      if (start > cursor) {
        fragment.append(entry.node.data.slice(cursor, start));
      }
      const mark = root.ownerDocument.createElement("span");
      mark.className = DIFF_FORMAT_CLASS;
      applyDiffTooltip(mark, range.label);
      mark.append(entry.node.data.slice(start, end));
      fragment.append(mark);
      cursor = end;
    }
    if (cursor < entry.node.data.length) {
      fragment.append(entry.node.data.slice(cursor));
    }
    const parent = entry.node.parentElement;
    entry.node.replaceWith(fragment);
    for (const mark of Array.from(
      parent!.querySelectorAll<HTMLElement>(`.${DIFF_FORMAT_CLASS}`),
    )) {
      const titledAncestor = mark.closest<HTMLElement>("[title]");
      if (titledAncestor) titledAncestors.add(titledAncestor);
    }
  }
  for (const titledAncestor of titledAncestors) {
    suppressNativeTitle(titledAncestor);
  }
}

function applyFormattingDiff(
  target: HTMLElement,
  originalText: string,
  originalRanges: readonly FormattingRange[],
): boolean {
  /* v8 ignore next -- callers invoke formatting comparison only after proving equal rendered text */
  if (target.textContent !== originalText) return false;
  const currentRanges = formattingRanges(target);
  const changed = formattingChangeRanges(originalRanges, currentRanges);
  if (changed.length === 0) return false;
  wrapFormattingRanges(target, changed);
  return true;
}

function applyLeafStructureDiff(
  original: HTMLElement,
  target: HTMLElement,
): boolean {
  if (target.tagName !== "LI" || original.tagName !== "LI") return false;
  let changed = false;
  const originalList = original.parentElement?.tagName;
  const currentList = target.parentElement?.tagName;
  const markerChanged =
    (originalList === "UL" || originalList === "OL") &&
    (currentList === "UL" || currentList === "OL") &&
    originalList !== currentList;
  const originalTask = original.querySelector<HTMLInputElement>(
    ':scope input[type="checkbox"]',
  );
  const currentTask = target.querySelector<HTMLInputElement>(
    ':scope input[type="checkbox"]',
  );
  const taskChanged =
    originalTask != null &&
    currentTask != null &&
    originalTask.checked !== currentTask.checked;
  const markerLabel = markerChanged
    ? `marker ${originalList === "OL" ? "numbered" : "bulleted"} to ${currentList === "OL" ? "numbered" : "bulleted"}`
    : null;
  const checklistLabel = taskChanged
    ? `checklist item ${originalTask.checked ? "checked" : "unchecked"} to ${currentTask.checked ? "checked" : "unchecked"}`
    : null;

  if (markerChanged) {
    target.classList.add(DIFF_LIST_MARKER_CLASS);
    changed = true;
  }
  if (taskChanged) {
    currentTask.classList.add(DIFF_TASK_STATE_CLASS);
    changed = true;
  }
  if (!changed) return false;
  if (markerLabel) {
    if (checklistLabel) {
      applyDiffTooltip(
        target,
        `List item changed: ${markerLabel}; ${checklistLabel}`,
      );
      return true;
    }
    applyDiffTooltip(
      target,
      `List marker changed from ${markerLabel.slice("marker ".length)}`,
    );
    return true;
  }
  const wrapper = currentTask!.ownerDocument.createElement("span");
  wrapper.className = DIFF_TASK_TOOLTIP_CLASS;
  currentTask!.before(wrapper);
  wrapper.appendChild(currentTask!);
  applyDiffTooltip(
    wrapper,
    `Checklist item changed from ${checklistLabel!.slice("checklist item ".length)}`,
  );
  return true;
}

function applyBlockStructureDiff(
  original: HTMLElement,
  target: HTMLElement,
  text: string,
): boolean {
  if (original.tagName === target.tagName || text.length === 0) return false;
  const describeBlock = (tag: string): string => {
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) return `heading level ${heading[1]}`;
    return {
      BLOCKQUOTE: "quote",
      LI: "list item",
      P: "paragraph",
    }[tag]!;
  };
  wrapFormattingRanges(target, [
    {
      start: 0,
      end: text.length,
      label: `Block changed from ${describeBlock(original.tagName)} to ${describeBlock(target.tagName)}`,
    },
  ]);
  return true;
}

function linkHost(value: string): string {
  try {
    return new URL(value, "https://relative.invalid").host;
  } catch {
    /* v8 ignore next -- rendered links are URL-sanitized before decoration */
    return "";
  }
}

function readLinkTargets(root: Element): string[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>("a")).map(
    /* v8 ignore next -- rendered anchors selected here always carry href */
    (link) => link.getAttribute("href") ?? "",
  );
}

function findLinkTargetChanges(
  before: readonly string[],
  after: readonly string[],
): LinkTargetChange[] {
  if (before.length !== after.length) return [];
  const changes: LinkTargetChange[] = [];
  for (let index = 0; index < before.length; index++) {
    if (before[index] !== after[index]) {
      changes.push({
        index,
        before: before[index]!,
        after: after[index]!,
        hostChanged: linkHost(before[index]!) !== linkHost(after[index]!),
      });
    }
  }
  return changes;
}

function applyLinkTargetIndicators(
  root: Element,
  changes: readonly LinkTargetChange[],
): void {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>("a"));
  for (const change of changes) {
    const link = links[change.index];
    /* v8 ignore next -- changes are built only when before/after link counts match */
    if (!link) continue;
    const indicator = document.createElement("span");
    indicator.className = `${DIFF_METADATA_CLASS} emr-diff-metadata--link`;
    indicator.classList.toggle("is-warning", change.hostChanged);
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "emr-diff-metadata-trigger";
    trigger.setAttribute(
      "aria-label",
      change.hostChanged
        ? "Show link hostname change"
        : "Show link target change",
    );
    trigger.title = trigger.getAttribute("aria-label")!;
    trigger.appendChild(buildLinkChangeIcon());
    trigger.setAttribute("aria-expanded", "false");
    const panel = document.createElement("span");
    panel.className = "emr-diff-metadata-panel";
    panel.id = `emr-diff-metadata-panel-${root.ownerDocument.querySelectorAll(".emr-diff-metadata-panel").length + 1}`;
    panel.setAttribute("popover", "auto");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Link target change");
    trigger.setAttribute("aria-controls", panel.id);
    const targetDiff = document.createElement("span");
    targetDiff.className = "emr-diff-metadata-target-diff";
    targetDiff.textContent = change.after;
    applyInlineWordDiff(targetDiff, diffWords(change.before, change.after));
    panel.appendChild(targetDiff);
    const setOpen = (open: boolean): void => {
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        trigger.ownerDocument.defaultView!.requestAnimationFrame(() => {
          positionMetadataPanel(trigger, panel);
        });
      }
    };
    panel.addEventListener("toggle", (event) => {
      const state = (event as Event & { newState?: string }).newState;
      setOpen(state === "open");
    });
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      positionMetadataPanel(trigger, panel);
      const popover = panel as unknown as HTMLElement & {
        togglePopover?: (force?: boolean) => boolean;
      };
      const hasNativePopover = typeof popover.togglePopover === "function";
      const open = trigger.getAttribute("aria-expanded") !== "true";
      if (hasNativePopover) popover.togglePopover(open);
      else {
        indicator.classList.toggle("is-open", open);
        setOpen(open);
      }
      if (hasNativePopover) setOpen(open);
    });
    indicator.append(trigger, panel);
    link.after(indicator);
  }
}

function appendMetadataRow(
  row: HTMLElement,
  labelText: string,
  valueText: string,
): void {
  const label = document.createElement("span");
  label.className = "emr-diff-metadata-label";
  label.textContent = `${labelText} `;
  const value = document.createElement("span");
  value.className = "emr-diff-metadata-value";
  value.textContent = valueText;
  row.append(label, value);
}

function buildLinkChangeIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const first = document.createElementNS("http://www.w3.org/2000/svg", "path");
  first.setAttribute(
    "d",
    "M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93",
  );
  const second = document.createElementNS("http://www.w3.org/2000/svg", "path");
  second.setAttribute(
    "d",
    "M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13 19.07",
  );
  svg.append(first, second);
  return svg;
}

function positionMetadataPanel(trigger: HTMLElement, panel: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const view = trigger.ownerDocument.defaultView!;
  const viewportWidth = view.innerWidth;
  const viewportHeight = view.innerHeight;
  const desiredWidth = Math.min(440, viewportWidth - 16);
  const measuredHeight = panel.getBoundingClientRect().height;
  const panelHeight =
    measuredHeight > 0 ? measuredHeight : Math.min(320, viewportHeight - 16);
  const maximumTop = Math.max(8, viewportHeight - panelHeight - 8);
  panel.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - desiredWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, maximumTop))}px`;
}

function applySimpleMetadataIndicator(
  root: Element,
  label: string,
  beforeValue: string,
  afterValue: string,
): void {
  const indicator = document.createElement("span");
  indicator.className = `${DIFF_METADATA_CLASS} emr-diff-metadata--structure`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "emr-diff-metadata-trigger";
  trigger.textContent = label;
  trigger.setAttribute("aria-expanded", "false");
  const panel = document.createElement("span");
  panel.className = "emr-diff-metadata-panel";
  panel.setAttribute("role", "tooltip");
  const before = document.createElement("span");
  before.className = "emr-diff-metadata-row emr-diff-metadata-row--before";
  appendMetadataRow(before, "Before", beforeValue);
  const after = document.createElement("span");
  after.className = "emr-diff-metadata-row emr-diff-metadata-row--after";
  appendMetadataRow(after, "After", afterValue);
  panel.append(before, after);
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = !indicator.classList.contains("is-open");
    indicator.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  indicator.append(trigger, panel);
  if (root.tagName === "IMG") root.after(indicator);
  else root.appendChild(indicator);
}

interface RenderedCodeMetadata {
  language: string;
  options: string;
}

function codeMetadata(pre: Element): RenderedCodeMetadata {
  const code = pre.querySelector("code")!;
  const languageClass = Array.from(code.classList)
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  return {
    language: languageClass || "plain text",
    options:
      pre.getAttribute("data-code-meta") ??
      code.getAttribute("data-code-meta") ??
      "",
  };
}

function imageDescription(image: Element): string {
  /* v8 ignore next -- rendered images always carry a sanitized src */
  const src = image.getAttribute("src") ?? "no source";
  /* v8 ignore next -- Markdown images always carry alt (possibly empty) */
  const alt = image.getAttribute("alt") ?? "no alt text";
  const title = image.getAttribute("title");
  return title
    ? `${src} (alt: ${alt}; title: ${title})`
    : `${src} (alt: ${alt})`;
}

interface ImageMetadataChange {
  index: number;
  before: string;
  after: string;
}

function findImageMetadataChanges(
  beforeRoot: Element,
  afterRoot: Element,
): ImageMetadataChange[] {
  const before = Array.from(beforeRoot.querySelectorAll("img")).map(
    imageDescription,
  );
  const after = Array.from(afterRoot.querySelectorAll("img")).map(
    imageDescription,
  );
  if (before.length !== after.length) return [];
  return before.flatMap((description, index) =>
    description === after[index]
      ? []
      : [{ index, before: description, after: after[index]! }],
  );
}

function applyImageMetadataIndicators(
  root: Element,
  changes: readonly ImageMetadataChange[],
): void {
  const images = Array.from(root.querySelectorAll("img"));
  for (const change of changes) {
    const image = images[change.index]!;
    applySimpleMetadataIndicator(
      image,
      "Image changed",
      change.before,
      change.after,
    );
  }
}

interface InlineContentDiffOptions {
  minimumUnchangedRatio?: number;
}

interface InlineContentDiffResult {
  handled: boolean;
  formattingChanged: boolean;
  metadataChanged: boolean;
  tooDivergent: boolean;
}

function diffInlineContent(
  original: HTMLElement,
  target: HTMLElement,
  options: InlineContentDiffOptions = {},
): InlineContentDiffResult {
  /* v8 ignore next 2 -- rendered elements always carry textContent */
  const originalText = original.textContent ?? "";
  /* v8 ignore next -- rendered elements always carry textContent */
  const currentText = target.textContent ?? "";
  const linkChanges = findLinkTargetChanges(
    readLinkTargets(original),
    readLinkTargets(target),
  );
  const imageChanges = findImageMetadataChanges(original, target);
  const metadataChanged = linkChanges.length > 0 || imageChanges.length > 0;
  const applyMetadata = (): void => {
    if (linkChanges.length > 0) applyLinkTargetIndicators(target, linkChanges);
    if (imageChanges.length > 0) {
      applyImageMetadataIndicators(target, imageChanges);
    }
  };

  if (originalText === currentText) {
    const formattingChanged = applyFormattingDiff(
      target,
      originalText,
      formattingRanges(original),
    );
    applyMetadata();
    return {
      handled: formattingChanged || metadataChanged,
      formattingChanged,
      metadataChanged,
      tooDivergent: false,
    };
  }

  const operations = diffWords(originalText, currentText);
  if (
    options.minimumUnchangedRatio != null &&
    unchangedRatio(operations) < options.minimumUnchangedRatio
  ) {
    return {
      handled: false,
      formattingChanged: false,
      metadataChanged,
      tooDivergent: true,
    };
  }

  const wordDiff = applyInlineWordDiff(target, operations);
  applyMetadata();
  /* v8 ignore next -- operations were produced from target's own rendered text */
  const inlineApplied =
    wordDiff != null && wordDiff.added + wordDiff.removed > 0;
  return {
    handled: inlineApplied,
    formattingChanged: false,
    metadataChanged,
    tooDivergent: false,
  };
}
interface CodeMetadataChange {
  label: string;
  before: string;
  after: string;
  contentUnchanged: boolean;
}

function readCodeMetadataChange(
  block: HTMLElement,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): CodeMetadataChange | null {
  const scratch = document.createElement("div");
  scratch.innerHTML = renderInline(originalMarkdown);
  const original = scratch.querySelector("pre");
  if (!original) return null;
  const before = codeMetadata(original);
  const after = codeMetadata(block);
  /* v8 ignore next -- this path is entered only for a source-level code metadata change */
  if (before.language === after.language && before.options === after.options) {
    return null;
  }
  const languageChanged = before.language !== after.language;
  const optionsChanged = before.options !== after.options;
  return {
    label:
      languageChanged && optionsChanged
        ? "Code fence changed"
        : languageChanged
          ? "Language changed"
          : "Code options changed",
    before: languageChanged
      ? optionsChanged
        ? `${before.language}; options: ${before.options || "none"}`
        : before.language
      : before.options || "none",
    after: languageChanged
      ? optionsChanged
        ? `${after.language}; options: ${after.options || "none"}`
        : after.language
      : after.options || "none",
    contentUnchanged: original.textContent === block.textContent,
  };
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
function decorateFrontmatterValue(
  el: HTMLElement,
  kind: "added" | "modified",
  start: number,
  end: number,
  changeRanges: readonly ChangeRange[],
): boolean {
  const valueEl = el.querySelector<HTMLElement>(".emr-frontmatter-value");
  if (!valueEl) return false;

  /* v8 ignore next -- a value cell's textContent is never null */
  const modifiedText = valueEl.textContent ?? "";

  // Resolve the pre-edit value text. A wholly-added row has no "before", so we
  // diff against an empty string — every word reads as added (green).
  let originalText = "";
  if (kind === "modified") {
    const key = el.querySelector(".emr-frontmatter-key")?.textContent?.trim();
    if (!key) return false;
    const resolved = resolveFrontmatterOriginalValue(
      key,
      modifiedText,
      start,
      end,
      changeRanges,
    );
    if (resolved == null) return false;
    originalText = resolved;
  }

  if (originalText === modifiedText) return false;

  // Word-diff the value against its pre-edit text. Unlike the prose blocks we
  // apply NO unchanged-ratio threshold: metadata values are short and a full
  // replacement (e.g. `Draft` → `Published`) still reads best as struck-old +
  // green-new rather than a flat wash.
  const ops = diffWords(originalText, modifiedText);
  const res = applyInlineWordDiff(valueEl, ops);
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
 *      row is `key:` on `rowStart` and items on `rowStart+1…rowEnd`.
 * Returns null when no overlapping modified range carries usable original text.
 */
function resolveFrontmatterOriginalValue(
  key: string,
  currentText: string,
  rowStart: number,
  rowEnd: number,
  ranges: readonly ChangeRange[],
): string | null {
  const overlapping = ranges.filter(
    (r) =>
      r.kind === "modified" &&
      r.originalText != null &&
      overlaps(rowStart, rowEnd, r.start, r.end),
  );
  if (overlapping.length === 0) return null;

  // Shape 1: a fragment that carries the `key:` line resolves the value whole.
  for (const r of overlapping) {
    const values = frontmatterValuesForKey(r.originalText!, key);
    if (values) return frontmatterValueText(values);
  }

  // Shape 2: block-list item fragments — substitute the original item(s) back
  // at their line position. Items sit on `rowStart+1…`, so a range starting at
  // line L maps to current item index `L - (rowStart + 1)`. Apply back-to-front
  // so earlier indices stay valid when item counts differ.
  const firstItemLine = rowStart + 1;
  const originalItems = currentText === "" ? [] : currentText.split(", ");
  const sorted = [...overlapping].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    const startIdx = r.start - firstItemLine;
    if (startIdx < 0) return null; // Can't map the fragment onto an item slot.
    const modifiedCount = r.end - r.start + 1;
    originalItems.splice(
      startIdx,
      modifiedCount,
      ...parseFrontmatterListItems(r.originalText!),
    );
  }
  return frontmatterValueText(originalItems);
}

/**
 * Strip the fenced-code markers around a Mermaid source block so the modal
 * can diff the raw diagram definitions. Handles both GitHub triple-backtick
 * fences and Azure DevOps `:::mermaid` colon fences. Returns "" when the input
 * has no recognisable diagram body.
 */
export function stripMermaidFence(text: string): string {
  const lines = text.replace(/\s+$/, "").split(/\r\n|\r|\n/);
  if (lines.length > 0 && /^\s*(?:`{3,}|:{3,})\s*mermaid\b/i.test(lines[0]!)) {
    lines.shift();
    if (
      lines.length > 0 &&
      /^\s*(?:`{3,}|:{3,})\s*$/.test(lines[lines.length - 1]!)
    ) {
      lines.pop();
    }
  }
  return lines.join("\n").trim();
}

/**
 * Tag each decorated block with its position in a run of contiguous
 * same-kind sibling blocks via `data-diff-group` = start|mid|end|single.
 * The CSS uses this to render a run as ONE continuous card, squaring the inner
 * corners and collapsing the inter-block gap. Inline (word-diffed) blocks and
 * granular list-item / table-row leaves have no card, so they never
 * participate in a group.
 */
function markContiguousGroups(els: readonly HTMLElement[]): void {
  const groupable = (el: Element | null, kind: string | undefined): boolean =>
    el instanceof HTMLElement &&
    el.classList.contains(DIFF_BLOCK_CLASS) &&
    !el.classList.contains(DIFF_INLINE_CLASS) &&
    !isGranularLeaf(el) &&
    el.dataset.diffKind === kind;

  for (const el of els) {
    if (el.classList.contains(DIFF_INLINE_CLASS) || isGranularLeaf(el)) {
      delete el.dataset.diffGroup;
      continue;
    }
    const kind = el.dataset.diffKind;
    const samePrev = groupable(el.previousElementSibling, kind);
    const sameNext = groupable(el.nextElementSibling, kind);
    el.dataset.diffGroup =
      samePrev && sameNext
        ? "mid"
        : samePrev
          ? "end"
          : sameNext
            ? "start"
            : "single";
  }
}

/**
 * Return the single MODIFIED change range that overlaps [start,end], or null
 * when zero or more than one do. Requiring exactly one keeps the inline word
 * diff to the unambiguous single-block-per-hunk case; multi-range or
 * multi-block hunks safely fall back to the block wash.
 */
function soleModifiedRange(
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

/**
 * Render the original Markdown source to plain text and word-diff it against
 * the block's CURRENT rendered text, then overlay the result inline. Returns
 * true when an inline diff was applied.
 *
 * Comparing RENDERED plain text on both sides (not raw Markdown vs rendered
 * DOM) is what keeps the diff honest: `**bold**`/`` `code` ``/`[link](url)`
 * syntax never leaks in as spurious word changes, and a pure formatting change
 * correctly yields no word delta.
 */
/**
 * The element to run the inline word-diff against. A LOOSE list item (one whose
 * list has blank lines or nested blocks) wraps its prose in a `<p>`, with
 * whitespace text nodes sitting BETWEEN the `<li>` and that `<p>`. Diffing the
 * whole `<li>` would fold those inter-block newlines into the word diff and wrap
 * them in stray `<ins>`/`<del>` marks that render as blank lines above and below
 * the item. Targeting the inner prose `<p>` keeps the diff to the item's actual
 * text. Tight items (direct text, no `<p>`) and non-list prose blocks are
 * returned unchanged.
 */
function inlineProseTarget(block: HTMLElement): HTMLElement {
  if (block.tagName === "BLOCKQUOTE") {
    const body = Array.from(block.children).find(
      (child) =>
        child.tagName === "P" &&
        !child.classList.contains("markdown-alert-title"),
    );
    if (body) return body as HTMLElement;
  }
  if (block.tagName === "LI") {
    const first = block.firstElementChild;
    if (first?.tagName === "P") return first as HTMLElement;
  }
  return block;
}

function tryInlineWordDiff(
  block: HTMLElement,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): boolean {
  const doc = block.ownerDocument;
  const scratch = doc.createElement("div");
  scratch.innerHTML = renderInline(originalMarkdown);
  // Compare the ORIGINAL's matching element, not the whole scratch wrapper.
  // Rendering a list-item source (`- foo`) standalone wraps it in a `<ul>`,
  // whose inter-tag whitespace pollutes `scratch.textContent` ("\nfoo\n") and
  // would make the whole item read as changed. Drilling into the same tag as
  // the block (`<li>`, `<p>`, `<h2>`, …) yields the clean text that lines up
  // with the in-document block.
  const matchingOriginal = scratch.querySelector<HTMLElement>(block.tagName);
  const semanticOriginal = scratch.querySelector<HTMLElement>(
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt",
  );
  /* v8 ignore next -- Markdown rendering always emits at least one element */
  const originalEl =
    (block.tagName === "PRE" ? matchingOriginal : semanticOriginal) ??
    matchingOriginal ??
    (scratch.firstElementChild as HTMLElement | null) ??
    scratch;
  // For a LOOSE list item, diff (and mark) the inner `<p>` on BOTH sides so the
  // whitespace between the `<li>` and its `<p>` never becomes stray word marks.
  const originalProse = inlineProseTarget(originalEl);
  const target = inlineProseTarget(block);
  /* v8 ignore next -- element/block textContent is never null */
  const originalPlain = originalProse.textContent ?? "";
  /* v8 ignore next -- element/block textContent is never null */
  const modifiedPlain = target.textContent ?? "";
  const contentDiff = diffInlineContent(originalProse, target, {
    minimumUnchangedRatio: INLINE_MIN_UNCHANGED_RATIO,
  });
  if (contentDiff.tooDivergent) return false;
  if (originalPlain === modifiedPlain) {
    const structureChanged = applyLeafStructureDiff(originalEl, block);
    const blockStructureChanged = applyBlockStructureDiff(
      originalEl,
      block,
      originalPlain,
    );
    if (!contentDiff.handled && !structureChanged && !blockStructureChanged) {
      return false;
    }
    return true;
  }
  return contentDiff.handled;
}

/** First block whose source range starts at/after `line` (document order). */
function firstBlockAtOrAfter(
  blocks: readonly HTMLElement[],
  line: number,
): HTMLElement | null {
  for (const el of blocks) {
    const start = numAttr(el, "data-source-line");
    /* v8 ignore next -- blocks reaching here always have a numeric source line */
    if (start != null && start >= line) return el;
  }
  return null;
}

function buildDeletedMarker(
  r: DiffRange,
  renderInline?: (md: string) => string,
): HTMLElement {
  const count = r.linesDeleted ?? 0;
  const marker = document.createElement("div");
  marker.className = DIFF_DELETED_MARKER_CLASS;
  marker.setAttribute("role", "note");
  const label = `${count} line${count === 1 ? "" : "s"} removed`;
  marker.setAttribute("aria-label", label);

  const rail = document.createElement("span");
  rail.className = "emr-diff-deleted-rail";
  rail.setAttribute("aria-hidden", "true");

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "emr-diff-deleted-chip";
  chip.textContent = label;
  chip.setAttribute("aria-expanded", "false");

  const removedMarkdown = (r.deletedContent ?? "").replace(/\n+$/, "");
  // Render the removed source as Markdown so headings/code/lists read like the
  // document they came from — not raw `##`/backtick syntax. Falls back to a
  // preformatted plain block when no renderer is supplied (pure jsdom tests).
  let body: HTMLElement;
  if (renderInline && removedMarkdown) {
    body = document.createElement("div");
    body.className = "emr-diff-deleted-body markdown-body";
    body.innerHTML = renderInline(removedMarkdown);
  } else {
    body = document.createElement("pre");
    body.className = "emr-diff-deleted-body";
    body.textContent = removedMarkdown;
  }
  body.hidden = true;

  chip.addEventListener("click", () => {
    const open = body.hidden === true;
    body.hidden = !open;
    chip.setAttribute("aria-expanded", open ? "true" : "false");
    marker.classList.toggle("is-open", open);
  });

  marker.appendChild(rail);
  marker.appendChild(chip);
  marker.appendChild(body);
  return marker;
}

interface DeletedTableRows {
  parent: HTMLElement;
  before: ChildNode | null;
  rows: HTMLTableRowElement[];
}

function buildDeletedTableRows(
  range: DiffRange,
  anchor: HTMLElement | null,
  anchors: readonly HTMLElement[],
  renderInline: (md: string) => string,
): DeletedTableRows | null {
  /* v8 ignore next -- table-row reconstruction is attempted only for ranges carrying deleted content */
  if (!range.deletedContent) return null;
  const markdown = range.deletedContent.replace(/\n+$/, "");
  const lines = markdown.split(/\r\n|\r|\n/);
  const rows = lines.map(splitTableRow);
  const columnCount = rows[0]!.length;
  if (
    lines.some((line) => !/^\s*\|.*\|\s*$/.test(line)) ||
    lines.some((line) =>
      splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell)),
    ) ||
    columnCount < 2 ||
    rows.some((cells) => cells.length !== columnCount)
  ) {
    return null;
  }

  const previousRow = [...anchors]
    .reverse()
    .find(
      (candidate) =>
        candidate.tagName === "TR" &&
        numAttr(candidate, "data-source-end-line")! < range.startLine,
    );
  const previousRowEnd =
    previousRow == null ? null : numAttr(previousRow, "data-source-end-line");
  const immediatelyAfterPreviousTable =
    previousRowEnd != null && previousRowEnd + 1 === range.startLine;
  const referenceRow =
    anchor?.tagName === "TR"
      ? anchor
      : immediatelyAfterPreviousTable
        ? previousRow
        : undefined;
  const parent = referenceRow?.parentElement;
  if (
    !referenceRow ||
    !parent ||
    parent.tagName !== "TBODY" ||
    referenceRow.children.length !== columnCount
  ) {
    return null;
  }

  const delimiter = `| ${Array(columnCount).fill("---").join(" | ")} |`;
  const scratch = document.createElement("div");
  scratch.innerHTML = renderInline(
    [lines[0]!, delimiter, ...lines.slice(1)].join("\n"),
  );
  const table = scratch.querySelector<HTMLTableElement>("table");
  const headerRow = table?.querySelector<HTMLTableRowElement>("thead tr");
  /* v8 ignore next -- the validated rows plus synthesized delimiter always render a table/head row */
  if (!table || !headerRow) return null;

  for (const header of Array.from(headerRow.querySelectorAll("th"))) {
    const cell = document.createElement("td");
    for (const attribute of Array.from(header.attributes)) {
      cell.setAttribute(attribute.name, attribute.value);
    }
    cell.innerHTML = header.innerHTML;
    header.replaceWith(cell);
  }
  const body = table.tBodies[0] ?? table.createTBody();
  body.prepend(headerRow);
  const removedRows = Array.from(body.rows);
  for (const row of removedRows) {
    row.className = `${DIFF_DELETED_MARKER_CLASS} emr-diff-deleted-table-row`;
    row.setAttribute("role", "note");
    row.setAttribute("aria-label", "Removed table row");
  }

  const before =
    anchor?.tagName === "TR" && anchor.parentElement === parent
      ? anchor
      : referenceRow.nextSibling;
  return { parent, before, rows: removedRows };
}

/**
 * True when `node` sits inside a deleted-diff marker — removed content shown
 * for reference only. That text is not part of the live document, so it must
 * never be offered as a comment anchor (the anchor would orphan immediately).
 */
function isWithinDeletedDiff(node: Node | null): boolean {
  const el =
    node == null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
  return (
    el?.closest(
      `.${DIFF_DELETED_MARKER_CLASS}, .emr-diff-before-panel, .${DIFF_SOURCE_ONLY_CLASS}`,
    ) != null
  );
}

/**
 * True when a selection touches a deleted-diff marker, so the caller can
 * withhold the "add comment" affordance for removed content. This fires when
 * either endpoint lands inside a marker *or* the selection spans across one — a
 * selection that starts before a marker and ends after it has both endpoints
 * outside the removed block, so the endpoint check alone would miss it and
 * leave the comment bubble available over deleted content.
 */
export function selectionTouchesDeletedDiff(
  anchorNode: Node | null,
  focusNode: Node | null,
): boolean {
  if (isWithinDeletedDiff(anchorNode) || isWithinDeletedDiff(focusNode)) {
    return true;
  }
  if (!anchorNode || !focusNode) return false;

  // Both endpoints sit outside every marker. The selection still covers a
  // marker when one lies between the endpoints in document order — i.e. exactly
  // one endpoint precedes it. Scope the scan to the nodes' shared tree so it
  // works whether the article is live in the document or a detached fixture.
  const scope = anchorNode.getRootNode() as ParentNode;
  for (const marker of scope.querySelectorAll(
    `.${DIFF_DELETED_MARKER_CLASS}, .${DIFF_SOURCE_ONLY_CLASS}`,
  )) {
    const markerAfterAnchor =
      (anchorNode.compareDocumentPosition(marker) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    const markerAfterFocus =
      (focusNode.compareDocumentPosition(marker) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    if (markerAfterAnchor !== markerAfterFocus) return true;
  }
  return false;
}
