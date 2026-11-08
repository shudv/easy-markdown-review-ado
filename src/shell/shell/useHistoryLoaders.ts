// Shell: loading review history and historical document versions.

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";

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
} from "../shellHelpers";
import { historicalContentKeys } from "./derive";

function isNonEmpty(s: string | null | undefined): s is string {
    // Stryker disable next-line ConditionalExpression,StringLiteral: dead code: the `!== ""` half never decides anything — cache keys always carry the `path\u0000` prefix, the active commit only yields a key when non-empty (historicalContentKeys), and native-update mode requires a non-empty base commit (historyModes); the null half is pinned by the "fetches no past version while the current version is shown" scenario; candidate for removal
    return s != null && s !== "";
}

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
    loadThreadsForPr: ((prId: number, path: string) => Promise<CommentThread[]>) | undefined;
    loadFileSourceAt: ((path: string, commitId: string) => Promise<string>) | undefined;
    setHistoryByPath: Dispatch<SetStateAction<Record<string, DocPrRef[]>>>;
    setCompletedHistoryStopIndex: Dispatch<SetStateAction<number>>;
    setIterationRange: Dispatch<SetStateAction<ReviewIterationRange>>;
}

/**
 * Loads what the comment-history stepper shows: each document's review
 * history, and the historical content + threads of the selected stop(s).
 */
export function useHistoryLoaders(opts: HistoryLoadersOptions) {
    const { selectedPath, nativeIterationMode, viewingHistorical, activeStop } = opts;

    // Historical content/threads caches (keyed by `path\u0000commit` and
    // `path\u0000prId` respectively).
    const [historicalHtmlByKey, setHistoricalHtmlByKey] = useState<Record<string, string>>({});

    const [historicalSourceByKey, setHistoricalSourceByKey] = useState<Record<string, string>>({});

    const [historicalErrorByKey, setHistoricalErrorByKey] = useState<Record<string, string>>({});

    // PR-update endpoints where the file doesn't exist (added later / already
    // deleted). Native-iteration mode only: a normal state, not an error.
    const [historicalAbsentByKey, setHistoricalAbsentByKey] = useState<Record<string, true>>({});

    // Keyed by `path\u0000prId` (not PR id alone): one PR can change several
    // documents and `loadThreadsForPr` returns threads filtered to a path, so a
    // PR-id-only key would leak one document's threads onto another at the same PR.
    const [historicalThreadsByKey, setHistoricalThreadsByKey] = useState<
        Record<string, CommentThread[]>
    >({});

    useStepperResets(opts);
    useDocHistoryLoad(opts);

    // Load source + rendered HTML for every historical endpoint needed by the
    // current selection. A range may need two commits; single selection needs one.
    const keys = historicalContentKeys(opts);

    const historicalLoadTargets = useHistoricalLoadTargets(keys, activeStop.commitId);

    useHistoricalContentLoad({
        loadFileSourceAt: opts.loadFileSourceAt,
        selectedPath,
        historicalLoadTargets,
        nativeIterationMode,
        caches: {
            historicalErrorByKey,
            historicalAbsentByKey,
            historicalHtmlByKey,
            historicalSourceByKey,
        },
        setters: {
            setHistoricalHtmlByKey,
            setHistoricalSourceByKey,
            setHistoricalErrorByKey,
            setHistoricalAbsentByKey,
        },
    });

    // Load the active historical stop PR's threads (read-only).
    const activeHistoricalPrId = viewingHistorical && !nativeIterationMode ? activeStop.prId : null;

    useHistoricalThreadsLoad({
        activeHistoricalPrId,
        loadThreadsForPr: opts.loadThreadsForPr,
        selectedPath,
        historicalThreadsByKey,
        setHistoricalThreadsByKey,
    });

    return {
        historicalContentKey: keys.historicalContentKey,
        baselineContentKey: keys.baselineContentKey,
        historicalLoadTargets,
        historicalHtmlByKey,
        historicalSourceByKey,
        historicalErrorByKey,
        historicalAbsentByKey,
        historicalThreadsByKey,
    };
}

/** Where each stepper selection starts when the document or updates change. */
function useStepperResets(opts: HistoryLoadersOptions): void {
    const { selectedPath, nativeUpdateCount, setCompletedHistoryStopIndex, setIterationRange } =
        opts;

    // ---- comment-history stepper effects ----
    // Always start a freshly-opened document at its live "Current" head: a
    // Documents-hub history is per document.
    useEffect(() => {
        setCompletedHistoryStopIndex(0);
    }, [selectedPath, setCompletedHistoryStopIndex]);
    // A PR's updates are PR-wide, so the chosen comparison (e.g. "Update 4 → 5")
    // carries across files — reviewers step through a PR's files at one update.
    // It only resets if the set of updates itself changes (not on mount, which
    // would discard a comparison opened from a shared link).
    const updateCountRef = useRef(nativeUpdateCount);
    useEffect(() => {
        if (updateCountRef.current === nativeUpdateCount) return;
        updateCountRef.current = nativeUpdateCount;
        setIterationRange(allReviewIterations(nativeUpdateCount));
    }, [nativeUpdateCount, setIterationRange]);
}

/** Loads the selected document's review history the first time it's opened. */
function useDocHistoryLoad(opts: HistoryLoadersOptions): void {
    const { selectedPath, completedPrHistoryEnabled, loadDocHistory, setHistoryByPath } = opts;

    // Load the selected document's review history the first time it's opened.
    const loadedHistoryPathsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!completedPrHistoryEnabled || !loadDocHistory || !selectedPath) {
            return;
        }

        if (loadedHistoryPathsRef.current.has(selectedPath)) return;
        loadedHistoryPathsRef.current.add(selectedPath);
        let cancelled = false;
        loadDocHistory(selectedPath)
            .then((refs) => {
                if (cancelled) return;
                setHistoryByPath((prev) => ({ ...prev, [selectedPath]: refs }));
            })
            .catch((err: unknown) => {
                // Allow a retry on the next selection of this path.
                loadedHistoryPathsRef.current.delete(selectedPath);

                // Stryker disable next-line StringLiteral: developer-console text only; the failure reaches telemetry via trackUserFacingError below
                console.warn("[Shell] loadDocHistory failed:", err);
                trackUserFacingError({
                    error: err,
                    source: "Shell.history",
                    operation: "history-list-load",
                    impact: "degraded",
                });
            });

        return () => {
            cancelled = true;
        };
    }, [completedPrHistoryEnabled, loadDocHistory, selectedPath, setHistoryByPath]);
}

type HistoricalContentKeys = ReturnType<typeof historicalContentKeys>;

/** The distinct historical endpoints (cache key + commit) to load. */
function useHistoricalLoadTargets(
    keys: HistoricalContentKeys,
    activeCommitId: string | null | undefined,
) {
    const { historicalContentKey, baselineCommitId, baselineContentKey } = keys;

    return useMemo(() => {
        const targets = new Map<string, string>();

        // Stryker disable next-line LogicalOperator: dead code: historicalContentKey is non-null exactly when the active commit is non-empty (historicalContentKeys), so `||` and `&&` always agree; candidate for removal
        if (isNonEmpty(historicalContentKey) && isNonEmpty(activeCommitId)) {
            targets.set(historicalContentKey, activeCommitId);
        }

        if (isNonEmpty(baselineContentKey) && isNonEmpty(baselineCommitId)) {
            targets.set(baselineContentKey, baselineCommitId);
        }

        return [...targets].map(([key, commitId]) => ({ key, commitId }));
    }, [historicalContentKey, activeCommitId, baselineContentKey, baselineCommitId]);
}

interface HistoricalContentCaches {
    historicalErrorByKey: Partial<Record<string, string>>;
    historicalAbsentByKey: Partial<Record<string, true>>;
    historicalHtmlByKey: Partial<Record<string, string>>;
    historicalSourceByKey: Partial<Record<string, string>>;
}

interface HistoricalContentSetters {
    setHistoricalHtmlByKey: Dispatch<SetStateAction<Record<string, string>>>;
    setHistoricalSourceByKey: Dispatch<SetStateAction<Record<string, string>>>;
    setHistoricalErrorByKey: Dispatch<SetStateAction<Record<string, string>>>;
    setHistoricalAbsentByKey: Dispatch<SetStateAction<Record<string, true>>>;
}

/** Fetches + renders each historical endpoint not yet cached (or failed). */
function useHistoricalContentLoad(args: {
    loadFileSourceAt: HistoryLoadersOptions["loadFileSourceAt"];
    selectedPath: string;
    historicalLoadTargets: ReadonlyArray<{ key: string; commitId: string }>;
    nativeIterationMode: boolean;
    caches: HistoricalContentCaches;
    setters: HistoricalContentSetters;
}): void {
    const { loadFileSourceAt, selectedPath, historicalLoadTargets } = args;
    const { nativeIterationMode } = args;

    const {
        historicalErrorByKey,
        historicalAbsentByKey,
        historicalHtmlByKey,
        historicalSourceByKey,
    } = args.caches;

    const {
        setHistoricalHtmlByKey,
        setHistoricalSourceByKey,
        setHistoricalErrorByKey,
        setHistoricalAbsentByKey,
    } = args.setters;

    useEffect(() => {
        // Stryker disable next-line ConditionalExpression: with no targets the loop below does nothing, so skipping the empty-list early return changes no outcome
        if (!loadFileSourceAt || historicalLoadTargets.length === 0) return;
        let cancelled = false;

        for (const target of historicalLoadTargets) {
            if (
                historicalErrorByKey[target.key] !== undefined ||
                historicalAbsentByKey[target.key] ||
                // Stryker disable next-line ConditionalExpression,LogicalOperator: dead code: a successful load writes the source and HTML caches together in one batch, so either one being cached implies the other; candidate for removal
                (historicalHtmlByKey[target.key] !== undefined &&
                    // Stryker disable next-line ConditionalExpression: dead code: a successful load writes the source and HTML caches together in one batch, so the HTML being cached implies the source is; candidate for removal
                    historicalSourceByKey[target.key] !== undefined)
            ) {
                continue;
            }

            loadHistoricalTarget({
                load: loadFileSourceAt(selectedPath, target.commitId),
                key: target.key,
                isCancelled: () => cancelled,
                nativeIterationMode,
                setters: {
                    setHistoricalHtmlByKey,
                    setHistoricalSourceByKey,
                    setHistoricalErrorByKey,
                    setHistoricalAbsentByKey,
                },
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
        setHistoricalHtmlByKey,
        setHistoricalSourceByKey,
        setHistoricalErrorByKey,
        setHistoricalAbsentByKey,
    ]);
}

/** Settles one historical endpoint's source load into the content caches. */
function loadHistoricalTarget(args: {
    load: Promise<string>;
    key: string;
    isCancelled: () => boolean;
    nativeIterationMode: boolean;
    setters: HistoricalContentSetters;
}): void {
    const { load, key, isCancelled, nativeIterationMode, setters } = args;
    void load
        .then(async (source) => {
            // Stryker disable next-line ConditionalExpression: a cancelled load is re-checked after rendering (next check), so skipping this early exit only wastes a render
            if (isCancelled()) return;
            const html = await renderMarkdown(source);
            if (isCancelled()) return;
            setters.setHistoricalSourceByKey((prev) => ({
                ...prev,
                [key]: source,
            }));
            setters.setHistoricalHtmlByKey((prev) => ({
                ...prev,
                [key]: html,
            }));
        })
        .catch((err: unknown) => {
            if (isCancelled()) return;

            // Comparing PR updates: the file legitimately may not exist at an
            // endpoint (the PR adds it later, or deleted it already).
            if (nativeIterationMode && isItemNotFoundError(err)) {
                setters.setHistoricalAbsentByKey((prev) => ({
                    ...prev,
                    [key]: true,
                }));

                return;
            }

            // Stryker disable next-line StringLiteral: developer-console text only; the failure reaches telemetry via trackUserFacingError below
            console.warn("[Shell] loadFileSourceAt failed:", err);
            trackUserFacingError({
                error: err,
                source: "Shell.history",
                operation: "history-content-load",
                impact: "action-failed",
            });
            setters.setHistoricalErrorByKey((prev) => ({
                ...prev,
                [key]: errorMessage(err),
            }));
        });
}

/** Loads the active historical stop PR's threads (read-only), once per key. */
function useHistoricalThreadsLoad(args: {
    activeHistoricalPrId: number | null;
    loadThreadsForPr: HistoryLoadersOptions["loadThreadsForPr"];
    selectedPath: string;
    historicalThreadsByKey: Partial<Record<string, CommentThread[]>>;
    setHistoricalThreadsByKey: Dispatch<SetStateAction<Record<string, CommentThread[]>>>;
}): void {
    const {
        activeHistoricalPrId,
        loadThreadsForPr,
        selectedPath,
        historicalThreadsByKey,
        setHistoricalThreadsByKey,
    } = args;

    useEffect(() => {
        if (activeHistoricalPrId == null || !loadThreadsForPr) return;
        const key = `${selectedPath}\u0000${activeHistoricalPrId}`;
        if (historicalThreadsByKey[key] !== undefined) return;
        let cancelled = false;
        loadThreadsForPr(activeHistoricalPrId, selectedPath)
            .then((threads) => {
                if (cancelled) return;
                setHistoricalThreadsByKey((prev) => ({
                    ...prev,
                    [key]: threads,
                }));
            })
            .catch((err: unknown) => {
                // Stryker disable next-line StringLiteral: developer-console text only; the failure reaches telemetry via trackUserFacingError below
                console.warn("[Shell] loadThreadsForPr failed:", err);
                trackUserFacingError({
                    error: err,
                    source: "Shell.history",
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
        setHistoricalThreadsByKey,
    ]);
}
