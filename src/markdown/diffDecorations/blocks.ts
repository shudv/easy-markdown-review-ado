// Per-block decoration: classify a source-mapped block, then pick the richest
// presentation for its change (inline word diff, cell diff, metadata, wash).

import {
  applyLineWash,
  type ChangedBlock,
  classifyBlock,
  coveredByDecoratedAncestor,
  type DecorationPass,
  findInteriorEdit,
  markChangedBlock,
  markInlined,
  ownSpanEnd,
  reconstructBlockOriginal,
  unmarkChangedBlock,
} from "./pass";
import { diffTableRowCells, resolveTableColumnAlignment } from "./tableCells";
import {
  attachBlockBeforeDisclosure,
  attachTableBeforeDisclosure,
} from "./beforeDisclosure";
import { soleModifiedRange } from "./reconstruct";
import { applyDiffTooltip } from "./tooltip";
import { explainLeadText } from "./structure";
import {
  compareRendering,
  listNestingChange,
  type RenderComparison,
  renderOriginalStandalone,
  renderSource,
} from "./rendering";
import {
  applySimpleMetadataIndicator,
  readCodeMetadataChange,
} from "./metadata";
import { tryInlineWordDiff } from "./inlineDiff";
import { decorateFrontmatterValue } from "./frontmatterValue";
import {
  DIFF_IMAGE_CLASS,
  DIFF_INLINE_CLASS,
  DIFF_LIST_MARKER_CLASS,
  DIFF_MATH_CLASS,
  DIFF_TOOLTIP_CLASS,
  FRONTMATTER_ROW_CLASS,
  PROSE_TAGS,
  readSourceSpan,
} from "./shared";

export function decorateBlock(pass: DecorationPass, el: HTMLElement): void {
  const span = readSourceSpan(el);
  if (!span) return;
  const { start, end } = span;
  // Avoid stacking paint: skip a block only when a decorated ancestor's
  // paint actually covers it (e.g. the lead <p> of a washed <li>).
  if (coveredByDecoratedAncestor(el)) return;
  // A list item or quote owns only its lead content; its child blocks
  // decorate themselves (see ownSpanEnd).
  const ownEnd = ownSpanEnd(el, start, end, pass.currentLines);
  if (ownEnd < start) return;
  const interiorEdit =
    ownEnd === end ? findInteriorEdit(pass, el, start, end) : null;
  const kind = interiorEdit
    ? "modified"
    : classifyBlock(start, ownEnd, pass.changeRanges);
  if (!kind) return;
  markChangedBlock(pass, el, kind);
  const block: ChangedBlock = { el, kind, start, end, ownEnd, interiorEdit };
  if (!decorateBlockContent(pass, block)) return;

  if (kind === "modified" && pass.renderInline && lacksOwnComparison(el)) {
    attachOriginalComparison(pass, block, pass.renderInline);
  }
  if (kind === "modified" && needsUnavailableTooltip(el)) {
    applyDiffTooltip(
      el,
      "Previous content unavailable; exact comparison cannot be shown",
    );
  }
  if (canLineWash(el)) applyLineWash(el);
}

/**
 * Apply the tag-specific precise diff to a changed block. Returns false when a
 * modified block turned out to read the same and was undecorated.
 */
function decorateBlockContent(
  pass: DecorationPass,
  block: ChangedBlock,
): boolean {
  const { el, kind } = block;
  if (kind === "modified" && pass.renderInline) {
    // For a reworded prose block, overlay an inline word-level diff so only
    // the changed words are coloured. Requires the caller's `renderInline` so
    // we can compare RENDERED-plain-text (not raw Markdown) on both sides.
    if (
      PROSE_TAGS.has(el.tagName) &&
      !decorateModifiedProse(pass, block, pass.renderInline)
    ) {
      return false;
    }
    // For an edited TABLE ROW, highlight only the CELLS that changed rather
    // than the whole row. The line-based diff can't isolate a cell on its own,
    // but the original row's source is available, so we split both rows into
    // cells and compare them — turning a "single cell edit" or "column edit"
    // into precise per-cell highlights.
    if (el.tagName === "TR") {
      decorateModifiedTableRow(pass, block, pass.renderInline);
    }
    if (el.tagName === "PRE") {
      decorateModifiedCode(pass, block, pass.renderInline);
    }
  }

  // For a frontmatter row, express the value change as a simple inline
  // word-diff of its (comma-joined) value text: added words green, removed
  // words struck red, unchanged neutral. This never washes the value cell
  // (so a list never paints a bar stretching to the right) and reuses the
  // same word-diff machinery as prose blocks.
  if (
    el.classList.contains(FRONTMATTER_ROW_CLASS) &&
    decorateFrontmatterValue(
      el,
      kind,
      { start: block.start, end: block.ownEnd },
      pass.changeRanges,
    )
  ) {
    el.dataset.diffInline = "true";
  }
  return true;
}

/**
 * The original Markdown to compare a modified prose or code block against, or
 * null when it can't be recovered.
 */
function resolveOriginalMarkdown(
  pass: DecorationPass,
  block: ChangedBlock,
): string | null {
  const { start, end } = block;
  const range = soleModifiedRange(start, end, pass.changeRanges);
  // The change range must COVER the block's whole source span. Otherwise
  // `originalText` (only the changed lines) is a fragment of the block's
  // text, and word-diffing it against the full rendered block would mark
  // the unchanged remainder as "added". When only part of a multi-line
  // block changed, fall back to the block wash.
  const coversBlock = range != null && range.start <= start && range.end >= end;
  const reconstructed = reconstructBlockOriginal(
    pass,
    block.interiorEdit,
    start,
    end,
  );
  if (reconstructed == null && coversBlock) {
    return range!.originalText ?? null;
  }
  return reconstructed;
}

function originalDocumentOf(
  pass: DecorationPass,
  renderInline: (md: string) => string,
): HTMLElement | null {
  pass.originalDocument ??= renderSource(
    pass.root.ownerDocument,
    pass.originalSource,
    renderInline,
  );
  return pass.originalDocument;
}

function compareProseRendering(
  pass: DecorationPass,
  block: ChangedBlock,
  originalMarkdown: string | null,
  renderInline: (md: string) => string,
): RenderComparison | null {
  if (originalMarkdown == null) return null;
  const comparison = compareRendering(block.el, originalMarkdown, renderInline);
  if (comparison.kind === "different") return comparison;
  // The item reads the same, but may now sit at a different list depth.
  const nesting = listNestingChange(
    block.el,
    block.start,
    pass.changeRanges,
    () => originalDocumentOf(pass, renderInline),
  );
  return nesting ?? comparison;
}

/** Returns false when the block reads the same and was undecorated. */
function decorateModifiedProse(
  pass: DecorationPass,
  block: ChangedBlock,
  renderInline: (md: string) => string,
): boolean {
  const { el } = block;
  const originalMarkdown = resolveOriginalMarkdown(pass, block);
  const rendering = compareProseRendering(
    pass,
    block,
    originalMarkdown,
    renderInline,
  );
  if (rendering?.kind === "identical") {
    // A source-only edit — a renumbered list item, re-wrapped lines,
    // `*a*` → `_a_` — changes nothing a reader can see, so it isn't shown
    // as an edit.
    unmarkChangedBlock(pass, el, DIFF_IMAGE_CLASS, DIFF_MATH_CLASS);
    return false;
  }
  if (rendering?.kind === "nesting") {
    // Same text, different structure: tint the item's own text amber and
    // explain it, as a heading-level change does. The bullet stays amber.
    el.classList.add(DIFF_LIST_MARKER_CLASS, DIFF_INLINE_CLASS);
    explainLeadText(
      el,
      `List nesting changed from level ${rendering.before} to level ${rendering.after}`,
    );
    markInlined(pass, el);
  } else if (rendering?.kind === "numbering") {
    // Only the list's start number changed: mark just the number.
    el.classList.add(DIFF_LIST_MARKER_CLASS, DIFF_INLINE_CLASS);
    applyDiffTooltip(
      el,
      `List numbering changed from ${rendering.before} to ${rendering.after}`,
    );
    markInlined(pass, el);
  } else if (
    originalMarkdown != null &&
    tryInlineWordDiff(el, originalMarkdown, renderInline)
  ) {
    el.classList.add(DIFF_INLINE_CLASS);
    markInlined(pass, el);
  }
  return true;
}

function decorateModifiedTableRow(
  pass: DecorationPass,
  block: ChangedBlock,
  renderInline: (md: string) => string,
): void {
  const { el, start } = block;
  const range = soleModifiedRange(start, block.ownEnd, pass.changeRanges);
  // `soleModifiedRange`/`overlaps` guarantees the range covers this row's
  // line, so `start - range.start` indexes the row's original source. A
  // range without `originalText` (or an out-of-range index) yields a falsy
  // `originalRow` and simply falls back to the whole-row tint.
  const originalRow =
    range?.originalText != null
      ? range.originalText.split(/\r\n|\r|\n/)[start - range.start]
      : undefined;
  if (originalRow === undefined || originalRow === "" || !range) return;
  const columnAlignment = el.closest("thead")
    ? undefined
    : resolveTableColumnAlignment(el, range, renderInline);
  const tableDiff = diffTableRowCells(
    el,
    originalRow,
    renderInline,
    columnAlignment,
  );
  if (tableDiff === "precise") {
    el.dataset.diffCells = "true";
  } else if (tableDiff === "unchanged") {
    unmarkChangedBlock(pass, el);
  } else {
    attachTableBeforeDisclosure(el, range, renderInline);
  }
}

function decorateModifiedCode(
  pass: DecorationPass,
  block: ChangedBlock,
  renderInline: (md: string) => string,
): void {
  const { el } = block;
  const originalMarkdown = resolveOriginalMarkdown(pass, block);
  const metadataChange =
    originalMarkdown != null
      ? readCodeMetadataChange(el, originalMarkdown, renderInline)
      : null;
  const hasInlineDiff =
    originalMarkdown != null &&
    tryInlineWordDiff(el, originalMarkdown, renderInline);
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
    markInlined(pass, el);
  }
}

/** True when no precise diff already shows how a modified block changed. */
function lacksOwnComparison(el: HTMLElement): boolean {
  return (
    el.tagName !== "TR" &&
    !el.classList.contains(FRONTMATTER_ROW_CLASS) &&
    !el.classList.contains(DIFF_IMAGE_CLASS) &&
    !el.classList.contains(DIFF_INLINE_CLASS) &&
    el.dataset.diffInline !== "true"
  );
}

function attachOriginalComparison(
  pass: DecorationPass,
  block: ChangedBlock,
  renderInline: (md: string) => string,
): void {
  const { el } = block;
  const originalBlock = reconstructBlockOriginal(
    pass,
    block.interiorEdit,
    block.start,
    block.end,
  );
  if (originalBlock === null || originalBlock === "") return;
  if (el.classList.contains(DIFF_MATH_CLASS)) {
    const encoded = renderOriginalStandalone(el, originalBlock, renderInline)
      .querySelector<HTMLElement>(".emr-math[data-math-src]")
      ?.getAttribute("data-math-src");
    if (encoded != null && encoded !== "") {
      el.dataset.diffOriginal = decodeURIComponent(encoded);
    }
  } else {
    attachBlockBeforeDisclosure(
      el,
      { start: block.start, end: block.end },
      originalBlock,
      renderInline,
    );
  }
}

/** True when a modified block shows no comparison and no explanation. */
function needsUnavailableTooltip(el: HTMLElement): boolean {
  return (
    el.classList.contains("emr-diff-block--modified") &&
    !el.classList.contains(DIFF_IMAGE_CLASS) &&
    !el.classList.contains(DIFF_INLINE_CLASS) &&
    el.dataset.diffInline !== "true" &&
    el.dataset.diffCells !== "true" &&
    el.dataset.diffAmberMode == null &&
    el.dataset.diffOriginal == null &&
    !el.querySelector(`.${DIFF_TOOLTIP_CLASS}`)
  );
}

function canLineWash(el: HTMLElement): boolean {
  return (
    !el.classList.contains(DIFF_IMAGE_CLASS) &&
    !el.classList.contains(DIFF_MATH_CLASS) &&
    !el.classList.contains(DIFF_INLINE_CLASS) &&
    el.dataset.diffCells !== "true"
  );
}
