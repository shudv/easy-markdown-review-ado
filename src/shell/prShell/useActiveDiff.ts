// PrShell: change highlights and word counts for the shown article.

import * as React from "react";

import type { DiffRange } from "../../types";
import { refineDiffRanges } from "../../markdown/diffRefine";
import {
  countWords,
  sourceDiffRanges,
  wordCountDelta,
} from "../prShellHelpers";
import { activeSources, diffInputs, isDiffAvailable } from "./derive";

interface ActiveDiffOptions {
  selectedPath: string;
  sourceByPath: Record<string, string>;
  historicalSourceByKey: Record<string, string>;
  historicalContentKey: string | null;
  baselineContentKey: string | null;
  usingHistoricalContent: boolean;
  comparingIterations: boolean;
  baselineAbsent: boolean;
  viewingHistorical: boolean;
  isWholeFileChange: boolean;
  currentFileDiff: DiffRange[] | undefined;
  currentOriginalSource: string | undefined;
  diffHidden: boolean;
}

/**
 * The change highlights for the shown article (against the PR base, or between
 * the compared PR updates) and the word-count badge derived from them.
 */
export function useActiveDiff(opts: ActiveDiffOptions) {
  const { comparingIterations, currentFileDiff } = opts;
  const latestSource = opts.sourceByPath[opts.selectedPath];
  const { activeSource, baselineSource } = activeSources({
    ...opts,
    latestSource,
  });
  const iterationDiff = React.useMemo(
    () =>
      comparingIterations &&
      baselineSource !== undefined &&
      activeSource !== undefined
        ? sourceDiffRanges(baselineSource, activeSource)
        : undefined,
    [comparingIterations, baselineSource, activeSource],
  );
  const { activeOriginalSource, activeDiffTarget, rawActiveDiff } = diffInputs({
    comparingIterations,
    baselineSource,
    activeSource,
    latestSource,
    currentOriginalSource: opts.currentOriginalSource,
    iterationDiff,
    currentFileDiff,
  });
  // Both line diffs (ADO's and the update comparison's) report a rewrite as
  // coarse hunks; re-align them per Markdown block so new blocks read as
  // added and only genuine edits read as edited.
  const activeDiff = React.useMemo(
    () =>
      rawActiveDiff &&
      refineDiffRanges(rawActiveDiff, activeOriginalSource, activeDiffTarget),
    [rawActiveDiff, activeOriginalSource, activeDiffTarget],
  );
  const diffAvailable = isDiffAvailable({ ...opts, iterationDiff });
  const showDiff = diffAvailable && !opts.diffHidden;

  // Subtle word-count badge for the doc-nav title. Uses the active document's
  // Markdown source; falls back to 0 (badge hidden) until the source loads.
  const docWordCount = React.useMemo(
    () => countWords(activeSource ?? ""),
    [activeSource],
  );
  // When the diff is shown, also surface how the PR grew/shrank the prose:
  // words added vs. removed, derived from the changed line ranges. `showDiff`
  // already implies a present, non-empty `currentFileDiff` (see `diffAvailable`),
  // so the delta only needs the show/hide gate here; an all-zero delta is fine —
  // the badge simply renders no `+/−` segment.
  const docWordDelta = React.useMemo(() => {
    if (!showDiff) return undefined;
    return wordCountDelta(activeSource ?? "", activeDiff!);
  }, [showDiff, activeDiff, activeSource]);

  return {
    activeSource,
    activeOriginalSource,
    activeDiff,
    diffAvailable,
    showDiff,
    docWordCount,
    docWordDelta,
  };
}
