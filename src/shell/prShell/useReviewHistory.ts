// PrShell: the comment-history stepper / PR-update comparison state.

import * as React from "react";

import type { ChangeType } from "../../types";
import { trackUserFacingError } from "../../telemetry";
import {
  allReviewIterations,
  buildHistoryStops,
  type DocPrRef,
  type HistoryStop,
  type ReviewIterationRange,
} from "../prShellHelpers";
import {
  docNavRangeChangesFor,
  historyModes,
  resolveHistoryView,
} from "./derive";
import type { RoutedPrInfo } from "./types";

/** Stable empty history reference so the stops memo doesn't churn each render. */
const EMPTY_DOC_HISTORY: DocPrRef[] = [];

interface ReviewHistoryOptions {
  selectedPath: string;
  effectiveRoutedPr: RoutedPrInfo | undefined;
  loadDocHistory: ((path: string) => Promise<DocPrRef[]>) | undefined;
  loadThreadsForPr: unknown;
  loadFileSourceAt: unknown;
  reviewIterationStops: readonly HistoryStop[] | undefined;
  reviewIterationBaseCommit: string | undefined;
  initialIterationRange: ReviewIterationRange | undefined;
  onIterationRangeChange:
    | ((range: ReviewIterationRange | null) => void)
    | undefined;
  loadRangeChanges:
    | ((
        range: ReviewIterationRange,
      ) => Promise<Readonly<Record<string, ChangeType>>>)
    | undefined;
}

/**
 * Comment-history stepper state: the Documents hub's per-document
 * completed-PR stops, or the PR tab's native PR updates and the compared range.
 */
export function useReviewHistory(opts: ReviewHistoryOptions) {
  const { selectedPath, effectiveRoutedPr, loadRangeChanges } = opts;
  // ---- comment-history stepper ----
  // Only active when the host supplies all three loaders (Documents hub).
  const { completedPrHistoryEnabled, nativeIterationMode, nativeUpdateCount } =
    historyModes(opts);
  // Per-path review-history stops and the active stop index.
  const [historyByPath, setHistoryByPath] = React.useState<
    Record<string, DocPrRef[]>
  >({});
  const [completedHistoryStopIndex, setCompletedHistoryStopIndex] =
    React.useState(0);
  const [iterationRange, setIterationRange] =
    React.useState<ReviewIterationRange>(
      () =>
        opts.initialIterationRange ?? allReviewIterations(nativeUpdateCount),
    );

  const docHistory = completedPrHistoryEnabled
    ? (historyByPath[selectedPath] ?? EMPTY_DOC_HISTORY)
    : EMPTY_DOC_HISTORY;
  const completedPrHistoryStops = React.useMemo(
    () => buildHistoryStops(effectiveRoutedPr?.prId ?? null, docHistory),
    [effectiveRoutedPr, docHistory],
  );
  const view = resolveHistoryView({
    nativeIterationMode,
    reviewIterationStops: opts.reviewIterationStops,
    completedPrHistoryStops,
    iterationRange,
    completedHistoryStopIndex,
  });
  const { resolvedIterationRange, reportedRangeKey, rangeChangesKey } = view;

  // Report the compared PR updates up so the host can mirror them into the
  // route and shared links (`null` = All updates). Keyed on the comparison's
  // value; the callback is read through a ref so an inline host callback
  // doesn't re-fire it on every render.
  const onIterationRangeChangeRef = React.useRef(opts.onIterationRangeChange);
  onIterationRangeChangeRef.current = opts.onIterationRangeChange;
  React.useEffect(() => {
    if (reportedRangeKey === null) return;
    onIterationRangeChangeRef.current?.(
      resolvedIterationRange.isAllChanges ? null : resolvedIterationRange.range,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the comparison's value, not its object identity
  }, [reportedRangeKey]);

  // Which files the compared updates touch, so the file list can mark them and
  // dim the rest. Cached per comparison; a failed load just leaves the
  // PR-wide indicators in place.
  const [rangeChangesByKey, setRangeChangesByKey] = React.useState<
    Record<string, Readonly<Record<string, ChangeType>>>
  >({});
  React.useEffect(() => {
    if (
      !loadRangeChanges ||
      rangeChangesKey === null ||
      rangeChangesByKey[rangeChangesKey]
    ) {
      return;
    }
    loadRangeChanges(resolvedIterationRange.range)
      .then((byPath) =>
        setRangeChangesByKey((prev) => ({
          ...prev,
          [rangeChangesKey]: byPath,
        })),
      )
      .catch((err: unknown) => {
        console.warn("[PrShell] loadRangeChanges failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.updates",
          operation: "range-changes-load",
          impact: "degraded",
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the comparison's value
  }, [loadRangeChanges, rangeChangesKey, rangeChangesByKey]);
  const docNavRangeChanges = docNavRangeChangesFor(
    rangeChangesKey,
    rangeChangesByKey,
    resolvedIterationRange.range,
    view.historyStops.length,
  );

  return {
    ...view,
    completedPrHistoryEnabled,
    nativeIterationMode,
    nativeUpdateCount,
    iterationRange,
    setIterationRange,
    setHistoryByPath,
    setCompletedHistoryStopIndex,
    docNavRangeChanges,
  };
}
