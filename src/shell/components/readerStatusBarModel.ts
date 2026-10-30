// Pure view-model helpers for ReaderStatusBar: which status-bar regions show,
// and the derived labels / adjacent comparisons of the PR update picker.

import {
  allReviewIterations,
  formatWordDelta,
  oneReviewUpdate,
  resolveReviewIterationRange,
  reviewRangeLabel,
  type ResolvedReviewIterationRange,
  type ReviewIterationRange,
  type WordCountDelta,
  type WordDeltaPart,
} from "../prShellHelpers";

export interface StatusBarVisibilityInput {
  wordCount?: number;
  wordDelta?: WordCountDelta;
  changesAvailable: boolean;
  changesShown: boolean;
  commentsAvailable: boolean;
  showComments: boolean;
  commentThreadIds?: readonly string[];
  onCycleComment?: (threadId: string) => void;
  iterationCount?: number;
  hasIterationRange: boolean;
  onIterationRangeChange?: (range: ReviewIterationRange) => void;
}

export interface StatusBarVisibility {
  hasCount: boolean;
  deltaParts: WordDeltaPart[];
  showCommentStepper: boolean;
  showIterationPicker: boolean;
  showContextControls: boolean;
}

function showsCommentStepper(input: StatusBarVisibilityInput): boolean {
  return !!(
    input.commentsAvailable &&
    input.showComments &&
    input.commentThreadIds &&
    input.commentThreadIds.length > 1 &&
    input.onCycleComment
  );
}

function showsIterationPicker(input: StatusBarVisibilityInput): boolean {
  return !!(
    input.iterationCount &&
    input.iterationCount > 1 &&
    input.hasIterationRange &&
    input.onIterationRangeChange
  );
}

/** Which optional regions of the status bar render. */
export function statusBarVisibility(
  input: StatusBarVisibilityInput,
): StatusBarVisibility {
  const { wordCount, wordDelta, changesAvailable, changesShown } = input;
  const showIterationPicker = showsIterationPicker(input);
  return {
    hasCount: typeof wordCount === "number" && wordCount > 0,
    deltaParts:
      wordDelta && changesAvailable && changesShown
        ? formatWordDelta(wordDelta)
        : [],
    showCommentStepper: showsCommentStepper(input),
    showIterationPicker,
    showContextControls: showIterationPicker || changesAvailable,
  };
}

/** The comparison one step older (-1) or newer (1), or null at an end. */
export function adjacentIterationRange(
  resolved: ResolvedReviewIterationRange,
  updateCount: number,
  direction: -1 | 1,
): ReviewIterationRange | null {
  if (resolved.isAllChanges) {
    return direction < 0 ? oneReviewUpdate(updateCount, updateCount) : null;
  }

  if (direction < 0) {
    const previousUpdate = resolved.range.fromUpdate;
    return previousUpdate >= 1
      ? oneReviewUpdate(previousUpdate, updateCount)
      : null;
  }

  const nextUpdate = resolved.range.toUpdate + 1;
  if (nextUpdate <= updateCount) {
    return oneReviewUpdate(nextUpdate, updateCount);
  }
  return allReviewIterations(updateCount);
}

interface IterationOptionLike {
  number: number;
  title: string;
}

/**
 * Every label the picker trigger can show, deduplicated, so invisible sizers
 * can reserve the widest one.
 */
function stableIterationLabels(
  options: readonly IterationOptionLike[],
): string[] {
  return [
    "All updates",
    ...options
      .filter((option) => option.number > 1)
      .map((option) =>
        reviewRangeLabel(
          oneReviewUpdate(option.number, options.length),
          options.length,
        ),
      ),
  ].filter((label, index, labels) => labels.indexOf(label) === index);
}

function rangeLabelOrNull(
  range: ReviewIterationRange | null,
  updateCount: number,
): string | null {
  return range ? reviewRangeLabel(range, updateCount) : null;
}

function iterationTitle(
  options: readonly IterationOptionLike[],
  update: number,
): string | undefined {
  return options.find((option) => option.number === update)?.title;
}

export interface IterationPickerModel {
  resolved: ResolvedReviewIterationRange;
  allChangesSelected: boolean;
  /** A "Base → Update N" comparison, drawn with the base-commit glyph. */
  baseComparison: boolean;
  firstSelectedUpdate: number;
  selectionLabel: string;
  stableLabels: string[];
  previousRange: ReviewIterationRange | null;
  nextRange: ReviewIterationRange | null;
  previousLabel: string | null;
  nextLabel: string | null;
  /** Trigger tooltip. */
  triggerTitle: string;
}

/** Derived state of the PR update picker for the current comparison. */
export function iterationPickerModel(
  options: readonly IterationOptionLike[],
  range: ReviewIterationRange,
): IterationPickerModel {
  const count = options.length;
  const resolved = resolveReviewIterationRange(range, count);
  const allChangesSelected = resolved.isAllChanges;
  const previousRange = adjacentIterationRange(resolved, count, -1);
  const nextRange = adjacentIterationRange(resolved, count, 1);
  const fromTitle =
    resolved.range.fromUpdate === 0
      ? "Pull request base"
      : iterationTitle(options, resolved.range.fromUpdate);
  const toTitle = iterationTitle(options, resolved.range.toUpdate);
  return {
    resolved,
    allChangesSelected,
    baseComparison: !allChangesSelected && resolved.range.fromUpdate === 0,
    firstSelectedUpdate: resolved.range.fromUpdate + 1,
    selectionLabel: reviewRangeLabel(range, count),
    stableLabels: stableIterationLabels(options),
    previousRange,
    nextRange,
    previousLabel: rangeLabelOrNull(previousRange, count),
    nextLabel: rangeLabelOrNull(nextRange, count),
    triggerTitle: allChangesSelected
      ? "All updates from the pull request base to the newest update"
      : `${fromTitle} to ${toTitle}`,
  };
}

/** Tooltip of the base-commit glyph. */
export function baseCommitTitle(baseCommit: string | undefined): string {
  return baseCommit ? `Base commit ${baseCommit.slice(0, 7)}` : "Base commit";
}

/** Range-edge modifier classes for an update row in the picker list. */
export function iterationOptionClassName(
  update: number,
  isSelected: boolean,
  range: { firstSelectedUpdate: number; toUpdate: number },
): string {
  const start =
    isSelected && update === range.firstSelectedUpdate ? " is-range-start" : "";
  const end = isSelected && update === range.toUpdate ? " is-range-end" : "";
  return `emr-statusbar-iteration-option${start}${end}`;
}
