// useThreadSync — visibility-aware polling for remote thread snapshots.
//
// ADO's PR overview pushes thread events over a SignalR channel that the
// extension SDK doesn't expose, so we gently poll `gitClient.getThreads(...)`
// and feed results into a `MERGE_REMOTE_THREADS` reducer action that diffs
// them into local state without clobbering optimistic writes.
//
// Behavior:
//   - Fetches on mount, then polls every `intervalMs` (default 30s) while the
//     tab is visible. Hidden tabs pause polling and refresh immediately on
//     `visibilitychange → visible`; `window.focus` also triggers a refresh.
//   - A generation counter discards stale responses on unmount / visibility
//     loss so an old poll can't overwrite newer state.
//   - `refreshNow` drives a manual button; concurrent calls dedupe.
//   - Errors go to `onError`; the poll loop keeps running after a blip.

import * as React from "react";

import type { CommentThread } from "../types";
import { trackUserFacingError } from "../telemetry";

export interface UseThreadSyncOptions {
  /**
   * Master switch. When false, no fetch is performed and no
   * listeners are wired up. Use to gate on "do we have a target PR
   * yet?" without conditionally calling the hook.
   */
  enabled: boolean;
  /**
   * The async loader. Receives an `AbortSignal` and should pass it
   * through to the underlying fetch / SDK call. The hook aborts the
   * signal when the component unmounts or visibility is lost.
   */
  fetchThreads: (signal: AbortSignal) => Promise<CommentThread[]>;
  /**
   * Called with each fresh snapshot. Wire this to a
   * `dispatch({ type: "MERGE_REMOTE_THREADS", threads })` in the
   * owning component.
   */
  onThreads: (threads: CommentThread[]) => void;
  /** Optional error sink. Default: `console.warn`. */
  onError?: (err: unknown) => void;
  /** Visible-tab poll cadence in milliseconds. Default 30_000. */
  intervalMs?: number;
}

export interface ThreadSyncControls {
  /** Force an immediate refresh. Dedupes against an in-flight poll. */
  refreshNow: () => void;
  /**
   * True while a refresh is in flight. Drives the spinning state of
   * any manual "Refresh" button.
   */
  isRefreshing: boolean;
}

export function useThreadSync(opts: UseThreadSyncOptions): ThreadSyncControls {
  const {
    enabled,
    fetchThreads,
    onThreads,
    onError,
    intervalMs = 30_000,
  } = opts;

  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Refs let the listeners see the latest callbacks without
  // re-subscribing every render.
  const fetchRef = React.useRef(fetchThreads);
  const onThreadsRef = React.useRef(onThreads);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    fetchRef.current = fetchThreads;
    onThreadsRef.current = onThreads;
    onErrorRef.current = onError;
  }, [fetchThreads, onThreads, onError]);

  // Generation counter increments on each visibility loss / unmount.
  // Responses from older generations are discarded so a slow request
  // begun before a tab-hide can't overwrite state after a fresh
  // request finishes.
  const generationRef = React.useRef(0);
  const inFlightRef = React.useRef<AbortController | null>(null);
  /* v8 ignore next -- placeholder ref, replaced by runFetch before any call */
  const refreshNowRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let intervalId: number | null = null;

    const runFetch = (): void => {
      /* v8 ignore next -- defensive: cancelled before the effect re-runs */
      if (cancelled) return;
      // Dedupe: if a request is already in flight, skip — its result
      // (when it lands) is just as fresh as starting a new one would
      // be.
      if (inFlightRef.current) return;
      const myGeneration = generationRef.current;
      const controller = new AbortController();
      inFlightRef.current = controller;
      setIsRefreshing(true);
      fetchRef
        .current(controller.signal)
        .then((threads) => {
          /* v8 ignore next -- defensive: unmounted while the fetch was in flight */
          if (cancelled) return;
          if (myGeneration !== generationRef.current) return;
          onThreadsRef.current(threads);
        })
        .catch((err: unknown) => {
          /* v8 ignore start -- defensive cancel/abort/stale-generation guards */
          if (cancelled) return;
          if (controller.signal.aborted) return;
          if (myGeneration !== generationRef.current) return;
          /* v8 ignore stop */
          trackUserFacingError({
            error: err,
            source: "ThreadSync.poll",
            operation: "comments-refresh",
            impact: "degraded",
          });
          (
            onErrorRef.current ??
            ((e: unknown) => console.warn("[useThreadSync] fetch failed", e))
          )(err);
        })
        .finally(() => {
          if (inFlightRef.current === controller) {
            inFlightRef.current = null;
          }
          /* v8 ignore next -- defensive: cancelled during teardown */
          if (!cancelled) setIsRefreshing(false);
        });
    };

    refreshNowRef.current = runFetch;

    const startInterval = (): void => {
      stopInterval();
      intervalId = window.setInterval(runFetch, intervalMs);
    };
    const stopInterval = (): void => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        // Coming back to the tab — abort any stale in-flight, fetch
        // immediately, and resume the interval.
        if (inFlightRef.current) {
          inFlightRef.current.abort();
          inFlightRef.current = null;
        }
        generationRef.current += 1;
        runFetch();
        startInterval();
      } else {
        // Going hidden — bump the generation so any in-flight result
        // is discarded and pause the interval to save round-trips.
        generationRef.current += 1;
        if (inFlightRef.current) {
          inFlightRef.current.abort();
          inFlightRef.current = null;
        }
        setIsRefreshing(false);
        stopInterval();
      }
    };

    const onFocus = (): void => {
      if (document.visibilityState === "visible") runFetch();
    };

    // Kick off the initial load and the interval. If the tab is
    // hidden at mount we still do one fetch so PrShell has data when
    // the user comes back; the interval starts paused.
    runFetch();
    if (document.visibilityState === "visible") startInterval();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      generationRef.current += 1;
      if (inFlightRef.current) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      setIsRefreshing(false);
    };
  }, [enabled, intervalMs]);

  const refreshNow = React.useCallback(() => {
    refreshNowRef.current();
  }, []);

  return { refreshNow, isRefreshing };
}
