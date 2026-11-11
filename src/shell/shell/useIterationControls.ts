// Shell: history chevrons, PR-update picker and comment blocker.

import { type MutableRefObject, useCallback, useMemo } from "react";

import type { TextQuoteAnchor } from "../../types";
import { relocateAnchor } from "../../comments/anchor";
import { events, track } from "../../telemetry";
import type { ReaderIterationOption } from "../components/ReaderStatusBar";
import type { HistoryStop, ReviewIterationRange } from "../shellHelpers";
import { buildHistoryNav } from "./derive";
import { comparisonScope } from "./readerTelemetry";

interface IterationControlsOptions {
    completedPrHistoryEnabled: boolean;
    nativeIterationMode: boolean;
    viewingHistorical: boolean;
    historyStops: readonly HistoryStop[];
    clampedStopIndex: number;
    nativeUpdateCount: number;
    comparisonStart: number;
    latestHtml: string | undefined;
    setCompletedHistoryStopIndex: (index: number) => void;
    setIterationRange: (range: ReviewIterationRange) => void;
    setActiveThreadId: (threadId: string | null) => void;
    dismissEmptyDraftRef: MutableRefObject<() => void>;
}

/**
 * Controls for moving through a document's versions: the rail's history
 * chevrons, the PR-update picker, and the "compare up to the latest update"
 * offer for selections the latest version no longer has.
 */
export function useIterationControls(opts: IterationControlsOptions) {
    const {
        nativeIterationMode,
        viewingHistorical,
        historyStops,
        nativeUpdateCount,
        comparisonStart,
        latestHtml,
        setCompletedHistoryStopIndex,
        setIterationRange,
        setActiveThreadId,
        dismissEmptyDraftRef,
    } = opts;

    const historyNav = buildHistoryNav(
        opts.completedPrHistoryEnabled,
        historyStops,
        opts.clampedStopIndex,
        // eslint-disable-next-line react-hooks/refs -- buildHistoryNav only wires this into the chevrons' click handlers, so the ref is read on click, never during render.
        (stopIndex) => {
            setCompletedHistoryStopIndex(stopIndex);
            setActiveThreadId(null);
            dismissEmptyDraftRef.current();
        },
    );

    const iterationOptions = useMemo<ReaderIterationOption[]>(
        () =>
            nativeIterationMode
                ? historyStops
                      .map((stop, newestFirstIndex) => ({
                          stopIndex: newestFirstIndex,
                          number: historyStops.length - newestFirstIndex,
                          title: stop.title!,
                          dateMs: stop.dateMs,
                      }))
                      .reverse()
                : [],
        [historyStops, nativeIterationMode],
    );

    const changeIterationRange = useCallback(
        (range: ReviewIterationRange) => {
            setIterationRange(range);
            setActiveThreadId(null);
            dismissEmptyDraftRef.current();
            track(events.updatesCompared({ scope: comparisonScope(range, nativeUpdateCount) }));
        },
        [setIterationRange, setActiveThreadId, dismissEmptyDraftRef, nativeUpdateCount],
    );

    // Comparing up to an EARLIER update: comments still attach to the latest
    // version, so a selection can only be commented on if its text is still in
    // the latest version. Otherwise the selection bubble explains why and
    // offers to extend the comparison to the latest update (same start point).
    const commentBlocker = useMemo(() => {
        if (
            !nativeIterationMode ||
            !viewingHistorical ||
            latestHtml === undefined ||
            latestHtml === ""
        ) {
            return undefined;
        }

        return (anchor: TextQuoteAnchor) =>
            relocateAnchor(anchor, latestHtml)
                ? null
                : {
                      message:
                          "This text changed in a later update, so a comment can't be attached to it.",
                      actionLabel: `Compare up to Update ${nativeUpdateCount}`,
                      onAction: () =>
                          changeIterationRange({
                              fromUpdate: comparisonStart,
                              toUpdate: nativeUpdateCount,
                          }),
                  };
    }, [
        nativeIterationMode,
        viewingHistorical,
        latestHtml,
        nativeUpdateCount,
        comparisonStart,
        changeIterationRange,
    ]);

    return { historyNav, iterationOptions, changeIterationRange, commentBlocker };
}
