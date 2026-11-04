// Inline word-level content diffs overlaid onto rendered blocks and cells.

import { diffWords, unchangedRatio } from "../wordDiff";
import { applyInlineWordDiff } from "../wordDiffDom";
import {
  applyFormattingDiff,
  explainWhitespaceSwaps,
  formattingRanges,
  wrapFormattingRanges,
} from "./formatting";
import { applyBlockStructureDiff, applyLeafStructureDiff } from "./structure";
import { renderOriginalStandalone } from "./rendering";
import {
  applyImageMetadataIndicators,
  applyLinkTargetIndicators,
  findImageMetadataChanges,
  findLinkTargetChanges,
  readLinkTargets,
} from "./metadata";
import { inlineProseTarget } from "./shared";

/**
 * Minimum fraction of a modified block that must stay unchanged for the inline
 * word diff to be worth showing. Below this the block was essentially
 * rewritten, and a sea of red/green words reads worse than the block wash.
 */
const INLINE_MIN_UNCHANGED_RATIO = 0.3;

interface InlineContentDiffOptions {
  minimumUnchangedRatio?: number;
}

interface InlineContentDiffResult {
  handled: boolean;
  formattingChanged: boolean;
  metadataChanged: boolean;
  tooDivergent: boolean;
}

export function diffInlineContent(
  original: HTMLElement,
  target: HTMLElement,
  options: InlineContentDiffOptions = {},
): InlineContentDiffResult {
  const originalText = original.textContent;
  const currentText = target.textContent;
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

  // In code, a whitespace swap with no shared run (a tab for spaces) reads as
  // one explained amber run rather than a struck-and-added pair.
  const swaps =
    target.tagName === "PRE"
      ? explainWhitespaceSwaps(operations)
      : { operations, ranges: [] };
  wrapFormattingRanges(target, swaps.ranges);
  const wordDiff = applyInlineWordDiff(target, swaps.operations);
  applyMetadata();
  const inlineApplied =
    wordDiff != null && wordDiff.added + wordDiff.removed > 0;
  return {
    handled: inlineApplied || swaps.ranges.length > 0,
    formattingChanged: false,
    metadataChanged,
    tooDivergent: false,
  };
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
export function tryInlineWordDiff(
  block: HTMLElement,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): boolean {
  const scratch = renderOriginalStandalone(
    block,
    originalMarkdown,
    renderInline,
  );
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
  const originalEl =
    (block.tagName === "PRE" ? matchingOriginal : semanticOriginal) ??
    matchingOriginal ??
    (scratch.firstElementChild as HTMLElement | null) ??
    scratch;
  // For a LOOSE list item, diff (and mark) the inner `<p>` on BOTH sides so the
  // whitespace between the `<li>` and its `<p>` never becomes stray word marks.
  const originalProse = inlineProseTarget(originalEl);
  const target = inlineProseTarget(block);
  const originalPlain = originalProse.textContent;
  const modifiedPlain = target.textContent;
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
  // A reworded item can also have been ticked off or re-marked; the word diff
  // alone would hide that.
  /* v8 ignore next -- differing, not-too-divergent text always yields a word mark or (in code) an explained whitespace swap, since diffWords ops rebuild the target's own text */
  if (!contentDiff.handled) return false;
  applyLeafStructureDiff(originalEl, block);
  return true;
}
