// PrShell: loading review history and historical document versions.

import * as React from "react";

import type { CommentThread } from "../../types";
import { renderMarkdown } from "../../markdown/render";
import { trackUserFacingError } from "../../telemetry";
import {
  allReviewIterations,
  errorMessage,
  isItemNotFoundError,
  type DocPrRef,
  type HistoryStop,
  type ReviewIterationRange,
} from "../prShellHelpers";
import { historicalContentKeys } from "./derive";

interface HistoryLoadersOptions {
  selectedPath: string;
  completedPrHistoryEnabled: boolean;
  nativeIterationMode: boolean;
  nativeUpdateCount: number;
  viewingHistorical: boolean;
  comparingIterations: boolean;
  activeStop: HistoryStop;
  baselineStop: HistoryStop | undefined;
  reviewIterationBaseCommit: string | undefined;
  loadDocHistory: ((path: string) => Promise<DocPrRef[]>) | undefined;
  loadThreadsForPr:
    | ((prId: number, path: string) => Promise<CommentThread[]>)
    | undefined;
  loadFileSourceAt:
    | ((path: string, commitId: string) => Promise<string>)
    | undefined;
  setHistoryByPath: React.Dispatch<
    React.SetStateAction<Record<string, DocPrRef[]>>
  >;
  setCompletedHistoryStopIndex: React.Dispatch<React.SetStateAction<number>>;
  setIterationRange: React.Dispatch<React.SetStateAction<ReviewIterationRange>>;
}

/**
 * Loads what the comment-history stepper shows: each document's review
 * history, and the historical content + threads of the selected stop(s).
 */
export function useHistoryLoaders(opts: HistoryLoadersOptions) {
  const {
    selectedPath,
    completedPrHistoryEnabled,
    nativeIterationMode,
    nativeUpdateCount,
    viewingHistorical,
    activeStop,
    loadDocHistory,
    loadThreadsForPr,
    loadFileSourceAt,
    setHistoryByPath,
    setCompletedHistoryStopIndex,
    setIterationRange,
  } = opts;
  // Historical content/threads caches (keyed by `path\u0000commit` and
  // `path\u0000prId` respectively).
  const [historicalHtmlByKey, setHistoricalHtmlByKey] = React.useState<
    Record<string, string>
  >({});
  const [historicalSourceByKey, setHistoricalSourceByKey] = React.useState<
    Record<string, string>
  >({});
  const [historicalErrorByKey, setHistoricalErrorByKey] = React.useState<
    Record<string, string>
  >({});
  // PR-update endpoints where the file doesn't exist (added later / already
  // deleted). Native-iteration mode only: a normal state, not an error.
  const [historicalAbsentByKey, setHistoricalAbsentByKey] = React.useState<
    Record<string, true>
  >({});
  // Keyed by `path\u0000prId` (not PR id alone): one PR can change several
  // documents and `loadThreadsForPr` returns threads filtered to a path, so a
  // PR-id-only key would leak one document's threads onto another at the same PR.
  const [historicalThreadsByKey, setHistoricalThreadsByKey] = React.useState<
    Record<string, CommentThread[]>
  >({});

  // ---- comment-history stepper effects ----
  // Always start a freshly-opened document at its live "Current" head: a
  // Documents-hub history is per document.
  React.useEffect(() => {
    setCompletedHistoryStopIndex(0);
  }, [selectedPath, setCompletedHistoryStopIndex]);
  // A PR's updates are PR-wide, so the chosen comparison (e.g. "Update 4 → 5")
  // carries across files — reviewers step through a PR's files at one update.
  // It only resets if the set of updates itself changes (not on mount, which
  // would discard a comparison opened from a shared link).
  const updateCountRef = React.useRef(nativeUpdateCount);
  React.useEffect(() => {
    if (updateCountRef.current === nativeUpdateCount) return;
    updateCountRef.current = nativeUpdateCount;
    setIterationRange(allReviewIterations(nativeUpdateCount));
  }, [nativeUpdateCount, setIterationRange]);

  // Load the selected document's review history the first time it's opened.
  const loadedHistoryPathsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!completedPrHistoryEnabled || !loadDocHistory || !selectedPath) return;
    if (loadedHistoryPathsRef.current.has(selectedPath)) return;
    loadedHistoryPathsRef.current.add(selectedPath);
    let cancelled = false;
    loadDocHistory(selectedPath)
      .then((refs) => {
        /* v8 ignore next -- cleanup races ahead of a slow resolve */
        if (cancelled) return;
        setHistoryByPath((prev) => ({ ...prev, [selectedPath]: refs }));
      })
      .catch((err: unknown) => {
        // Allow a retry on the next selection of this path.
        loadedHistoryPathsRef.current.delete(selectedPath);

        console.warn("[PrShell] loadDocHistory failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.history",
          operation: "history-list-load",
          impact: "degraded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    completedPrHistoryEnabled,
    loadDocHistory,
    selectedPath,
    setHistoryByPath,
  ]);

  // Load source + rendered HTML for every historical endpoint needed by the
  // current selection. A range may need two commits; single selection needs one.
  const { historicalContentKey, baselineCommitId, baselineContentKey } =
    historicalContentKeys(opts);
  const historicalLoadTargets = React.useMemo(() => {
    const targets = new Map<string, string>();
    if (historicalContentKey && activeStop.commitId) {
      targets.set(historicalContentKey, activeStop.commitId);
    }
    if (baselineContentKey && baselineCommitId) {
      targets.set(baselineContentKey, baselineCommitId);
    }
    return [...targets].map(([key, commitId]) => ({ key, commitId }));
  }, [
    historicalContentKey,
    activeStop.commitId,
    baselineContentKey,
    baselineCommitId,
  ]);
  React.useEffect(() => {
    if (!loadFileSourceAt || historicalLoadTargets.length === 0) return;
    let cancelled = false;
    for (const target of historicalLoadTargets) {
      if (
        historicalErrorByKey[target.key] !== undefined ||
        historicalAbsentByKey[target.key] ||
        (historicalHtmlByKey[target.key] !== undefined &&
          historicalSourceByKey[target.key] !== undefined)
      ) {
        continue;
      }
      void loadFileSourceAt(selectedPath, target.commitId)
        .then(async (source) => {
          /* v8 ignore next -- bails if the selection changed mid-load */
          if (cancelled) return;
          const html = await renderMarkdown(source);
          /* v8 ignore next -- bails if the selection changed mid-render */
          if (cancelled) return;
          setHistoricalSourceByKey((prev) => ({
            ...prev,
            [target.key]: source,
          }));
          setHistoricalHtmlByKey((prev) => ({
            ...prev,
            [target.key]: html,
          }));
        })
        .catch((err: unknown) => {
          /* v8 ignore next -- cleanup races ahead of a rejected request */
          if (cancelled) return;
          // Comparing PR updates: the file legitimately may not exist at an
          // endpoint (the PR adds it later, or deleted it already).
          if (nativeIterationMode && isItemNotFoundError(err)) {
            setHistoricalAbsentByKey((prev) => ({
              ...prev,
              [target.key]: true,
            }));
            return;
          }
          console.warn("[PrShell] loadFileSourceAt failed:", err);
          trackUserFacingError({
            error: err,
            source: "PrShell.history",
            operation: "history-content-load",
            impact: "action-failed",
          });
          setHistoricalErrorByKey((prev) => ({
            ...prev,
            [target.key]: errorMessage(err),
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [
    loadFileSourceAt,
    selectedPath,
    historicalLoadTargets,
    historicalErrorByKey,
    historicalAbsentByKey,
    historicalHtmlByKey,
    historicalSourceByKey,
    nativeIterationMode,
  ]);

  // Load the active historical stop PR's threads (read-only).
  const activeHistoricalPrId =
    viewingHistorical && !nativeIterationMode ? activeStop.prId : null;
  React.useEffect(() => {
    if (activeHistoricalPrId == null || !loadThreadsForPr) return;
    const key = `${selectedPath}\u0000${activeHistoricalPrId}`;
    if (historicalThreadsByKey[key]) return;
    let cancelled = false;
    loadThreadsForPr(activeHistoricalPrId, selectedPath)
      .then((threads) => {
        /* v8 ignore next -- cleanup races ahead of a slow resolve */
        if (cancelled) return;
        setHistoricalThreadsByKey((prev) => ({
          ...prev,
          [key]: threads,
        }));
      })
      .catch((err: unknown) => {
        console.warn("[PrShell] loadThreadsForPr failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.history",
          operation: "history-comments-load",
          impact: "degraded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeHistoricalPrId,
    loadThreadsForPr,
    selectedPath,
    historicalThreadsByKey,
  ]);

  return {
    historicalContentKey,
    baselineContentKey,
    historicalLoadTargets,
    historicalHtmlByKey,
    historicalSourceByKey,
    historicalErrorByKey,
    historicalAbsentByKey,
    historicalThreadsByKey,
  };
}
