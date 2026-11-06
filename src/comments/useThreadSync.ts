// useThreadSync — visibility-aware polling for remote thread snapshots.
//
// ADO's PR overview pushes thread events over a SignalR channel that the
// extension SDK doesn't expose, so we gently poll `gitClient.getThreads(...)`
// and feed results into a `MERGE_REMOTE_THREADS` reducer action that diffs
// them into local state without clobbering optimistic writes.
//
// Behavior:
//   - Fetches on mount, then re-polls `intervalMs` (default 30s) after each
//     fetch settles while the tab is visible. Hidden tabs pause polling and
//     refresh immediately on `visibilitychange → visible`; `window.focus` also
//     triggers a refresh.
//   - A generation counter discards stale responses on unmount / visibility
//     loss so an old poll can't overwrite newer state.
//   - `refreshNow` drives a manual button; concurrent calls dedupe.
//   - Failures back off instead of hammering: consecutive failures double the
//     delay (capped at `maxBackoffMs`), and an error that says when it can
//     next succeed (`recoverAtMs`, e.g. the ADO token dead window's
//     `SessionRefreshingError`) pauses polling until then. Automatic triggers
//     (focus / reveal) wait out the backoff; a manual `refreshNow` does not,
//     and neither does a host `subscribeRecovered` signal (e.g. the ADO
//     session was re-minted), which resumes polling immediately.
//   - Errors go to `onError` every time, but are reported to telemetry once per
//     failure streak — production saw one long-lived tab emit a 401 every 30s
//     for 88 hours. A background poll reports only once the streak reaches
//     {@link BACKGROUND_REPORT_STREAK}: a lone failed poll is invisible (the
//     next one heals it) and was most of the reported network blips. A failure
//     the user is waiting on — a manual `refreshNow`, or before any snapshot
//     has loaded — reports at once. A host may `claimFailure` to own the
//     reporting of failures it understands better (the ADO dead window).

import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { CommentThread } from "../types";
import { trackUserFacingError } from "../telemetry";

/** Default ceiling for the exponential failure backoff (5 minutes). */
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
/**
 * Ceiling for a `recoverAtMs`-driven pause. Slightly above the widest observed
 * ADO token dead window (~10.5 min) so the wait is never cut short of recovery.
 */
export const MAX_RECOVER_WAIT_MS = 11 * 60_000;
/** Grace added after `recoverAtMs` so the host has re-minted before we ask. */
export const RECOVER_BUFFER_MS = 2_000;
/** Consecutive background-poll failures before the streak is reported. */
const BACKGROUND_REPORT_STREAK = 2;

/** The `recoverAtMs` hint carried by an error, when it has a finite one. */
function recoverAtMsOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as { recoverAtMs?: unknown }).recoverAtMs;

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Delay before the next poll. Healthy polling uses `intervalMs`; the Nth
 * consecutive failure waits `intervalMs * 2^(N-1)` (capped at `maxBackoffMs`),
 * or — when the error carries `recoverAtMs` — at least until just after that
 * instant (capped at {@link MAX_RECOVER_WAIT_MS}).
 */
export function nextPollDelayMs(opts: {
  failureStreak: number;
  error?: unknown;
  nowMs: number;
  intervalMs: number;
  maxBackoffMs?: number;
}): number {
  const {
    failureStreak,
    error,
    nowMs,
    intervalMs,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  } = opts;

  if (failureStreak <= 0) return intervalMs;

  const backoffMs = Math.min(
    Math.max(intervalMs, maxBackoffMs),
    intervalMs * 2 ** (failureStreak - 1),
  );

  // `recoverAtMs` is a floor on top of the backoff, not a replacement: once it
  // has passed and the host still serves the dead token (bursts of up to 76 min
  // were seen), the streak must keep backing off rather than poll every 30s.
  const recoverAtMs = recoverAtMsOf(error);
  if (recoverAtMs === undefined) return backoffMs;
  const untilRecovery = recoverAtMs + RECOVER_BUFFER_MS - nowMs;

  return Math.min(MAX_RECOVER_WAIT_MS, Math.max(backoffMs, untilRecovery));
}

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
  /** Ceiling for the failure backoff. Default {@link DEFAULT_MAX_BACKOFF_MS}. */
  maxBackoffMs?: number;
  /**
   * Optional host signal that a failure condition has cleared (e.g. the ADO
   * session was re-minted). Subscribes a listener and returns an unsubscribe.
   * When it fires during a failure backoff, polling resumes immediately rather
   * than waiting out the backoff.
   */
  subscribeRecovered?: (listener: () => void) => () => void;
  /**
   * Optional host policy for a failed fetch. Return true to take ownership of
   * the user-facing report (the hook still backs off and calls `onError`).
   * `userWaiting` is true for a manual refresh or before any snapshot loaded.
   */
  claimFailure?: (err: unknown, userWaiting: boolean) => boolean;
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

/** Refs shared between the hook and its polling session. */
interface ThreadSyncRefs {
  fetchRef: MutableRefObject<UseThreadSyncOptions["fetchThreads"]>;
  onThreadsRef: MutableRefObject<UseThreadSyncOptions["onThreads"]>;
  onErrorRef: MutableRefObject<UseThreadSyncOptions["onError"]>;
  subscribeRecoveredRef: MutableRefObject<
    UseThreadSyncOptions["subscribeRecovered"]
  >;
  claimFailureRef: MutableRefObject<UseThreadSyncOptions["claimFailure"]>;
  generationRef: MutableRefObject<number>;
  inFlightRef: MutableRefObject<AbortController | null>;
  refreshNowRef: MutableRefObject<() => void>;
}

/** Mutable state of one polling session (one run of the polling effect). */
interface PollSession {
  refs: ThreadSyncRefs;
  setIsRefreshing: (value: boolean) => void;
  intervalMs: number;
  maxBackoffMs: number;
  cancelled: boolean;
  timerId: number | null;
  // Consecutive failed polls; 0 while healthy. Drives backoff and the
  // once-per-streak telemetry.
  failureStreak: number;
  // The current failure streak has been reported (or claimed by the host).
  streakReported: boolean;
  // A snapshot has landed in this session, so the user has comments on screen.
  hasLoaded: boolean;
  // Wall-clock time the next automatic poll is due. Kept while hidden so a
  // reveal mid-backoff resumes the wait instead of polling immediately.
  nextDueAtMs: number | null;
}

const isVisible = (): boolean => document.visibilityState === "visible";

function abortInFlight(refs: ThreadSyncRefs): void {
  if (refs.inFlightRef.current) {
    refs.inFlightRef.current.abort();
    refs.inFlightRef.current = null;
  }
}

function clearTimer(session: PollSession): void {
  if (session.timerId !== null) {
    window.clearTimeout(session.timerId);
    session.timerId = null;
  }
}

// Arm the next automatic poll `delayMs` from now. While hidden only the
// due time is recorded; the reveal handler re-arms from it.
function scheduleNext(session: PollSession, delayMs: number): void {
  clearTimer(session);
  session.nextDueAtMs = Date.now() + delayMs;

  if (isVisible()) {
    session.timerId = window.setTimeout(() => runFetch(session), delayMs);
  }
}

function handleFetchFailure(
  session: PollSession,
  err: unknown,
  manual: boolean,
): void {
  session.failureStreak += 1;
  scheduleNext(
    session,
    nextPollDelayMs({
      failureStreak: session.failureStreak,
      error: err,
      nowMs: Date.now(),
      intervalMs: session.intervalMs,
      maxBackoffMs: session.maxBackoffMs,
    }),
  );
  reportFailure(session, err, manual);

  (
    session.refs.onErrorRef.current ??
    ((e: unknown) => console.warn("[useThreadSync] fetch failed", e))
  )(err);
}

// Once per streak, and only once it is user-visible (see the header). A
// claimed failure is the host's to report; it is offered every failure since
// the user may only start waiting partway through the streak.
function reportFailure(
  session: PollSession,
  err: unknown,
  manual: boolean,
): void {
  const userWaiting = manual || !session.hasLoaded;
  if (session.refs.claimFailureRef.current?.(err, userWaiting) === true) return;
  if (session.streakReported) return;
  if (!userWaiting && session.failureStreak < BACKGROUND_REPORT_STREAK) return;
  session.streakReported = true;
  trackUserFacingError({
    error: err,
    source: "ThreadSync.poll",
    operation: "comments-refresh",
    impact: "degraded",
  });
}

function runFetch(session: PollSession, manual = false): void {
  const { refs } = session;
  // refreshNowRef still targets this session after `enabled` turns off.
  if (session.cancelled) return;
  // Dedupe: if a request is already in flight, skip — its result
  // (when it lands) is just as fresh as starting a new one would
  // be, and it re-arms the schedule when it settles.
  if (refs.inFlightRef.current) return;
  clearTimer(session);
  const myGeneration = refs.generationRef.current;
  const controller = new AbortController();
  refs.inFlightRef.current = controller;
  session.setIsRefreshing(true);
  refs.fetchRef
    .current(controller.signal)
    .then((threads) => {
      // Teardown and every abort also bump the generation, so this one check
      // drops results from cancelled sessions and aborted requests too.
      if (myGeneration !== refs.generationRef.current) return;
      session.failureStreak = 0;
      session.streakReported = false;
      session.hasLoaded = true;
      scheduleNext(session, session.intervalMs);
      refs.onThreadsRef.current(threads);
    })
    .catch((err: unknown) => {
      if (myGeneration !== refs.generationRef.current) return;
      handleFetchFailure(session, err, manual);
    })
    .finally(() => {
      if (refs.inFlightRef.current === controller) {
        refs.inFlightRef.current = null;
      }

      // A torn-down session must not clear a newer session's spinner.
      if (!session.cancelled) session.setIsRefreshing(false);
    });
}

// Poll now, unless a failure backoff is still pending — then just re-arm
// the remaining wait. Used by the automatic triggers (reveal / focus).
function pollUnlessBackingOff(session: PollSession): void {
  const remainingMs =
    session.failureStreak > 0 && session.nextDueAtMs !== null
      ? session.nextDueAtMs - Date.now()
      : 0;

  if (remainingMs > 0) scheduleNext(session, remainingMs);
  else runFetch(session);
}

function handleVisibilityChange(session: PollSession): void {
  const { refs } = session;

  if (isVisible()) {
    // Coming back to the tab — abort any stale in-flight, then fetch
    // immediately (or resume a pending backoff).
    abortInFlight(refs);
    refs.generationRef.current += 1;
    pollUnlessBackingOff(session);
  } else {
    // Going hidden — bump the generation so any in-flight result
    // is discarded and pause the timer to save round-trips.
    refs.generationRef.current += 1;
    abortInFlight(refs);
    session.setIsRefreshing(false);
    clearTimer(session);
  }
}

// The host says the failure condition cleared (e.g. a fresh ADO token):
// drop any backoff and poll now — or on the next reveal when hidden.
function handleRecovered(session: PollSession): void {
  if (session.failureStreak === 0) return;
  session.nextDueAtMs = Date.now();
  if (isVisible()) runFetch(session);
}

/** Start one polling session; returns its teardown. */
function startThreadPolling(
  refs: ThreadSyncRefs,
  options: Pick<PollSession, "setIsRefreshing" | "intervalMs" | "maxBackoffMs">,
): () => void {
  const session: PollSession = {
    refs,
    ...options,
    cancelled: false,
    timerId: null,
    failureStreak: 0,
    streakReported: false,
    hasLoaded: false,
    nextDueAtMs: null,
  };

  refs.refreshNowRef.current = () => runFetch(session, true);

  const onVisibilityChange = (): void => handleVisibilityChange(session);

  const onFocus = (): void => {
    if (isVisible()) pollUnlessBackingOff(session);
  };

  const unsubscribeRecovered = refs.subscribeRecoveredRef.current?.(() =>
    handleRecovered(session),
  );

  // Kick off the initial load. If the tab is hidden at mount we still do
  // one fetch so Shell has data when the user comes back; the follow-up
  // poll is armed only once visible.
  runFetch(session);

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);

  return () => {
    session.cancelled = true;
    refs.generationRef.current += 1;
    abortInFlight(refs);
    clearTimer(session);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
    unsubscribeRecovered?.();
    session.setIsRefreshing(false);
  };
}

export function useThreadSync(opts: UseThreadSyncOptions): ThreadSyncControls {
  const {
    enabled,
    fetchThreads,
    onThreads,
    onError,
    intervalMs = 30_000,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  } = opts;

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refs let the listeners see the latest callbacks without
  // re-subscribing every render.
  const fetchRef = useRef(fetchThreads);
  const onThreadsRef = useRef(onThreads);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    fetchRef.current = fetchThreads;
    onThreadsRef.current = onThreads;
    onErrorRef.current = onError;
  }, [fetchThreads, onThreads, onError]);
  // Read once per polling session (the effect below); a host passes a stable
  // subscribe function, so its identity must not restart polling. Synced in an
  // effect declared before the polling effect so a new session sees it.
  const subscribeRecovered = opts.subscribeRecovered;
  const subscribeRecoveredRef = useRef(subscribeRecovered);
  useEffect(() => {
    subscribeRecoveredRef.current = subscribeRecovered;
  }, [subscribeRecovered]);
  const claimFailure = opts.claimFailure;
  const claimFailureRef = useRef(claimFailure);
  useEffect(() => {
    claimFailureRef.current = claimFailure;
  }, [claimFailure]);

  // Generation counter increments on each visibility loss / unmount.
  // Responses from older generations are discarded so a slow request
  // begun before a tab-hide can't overwrite state after a fresh
  // request finishes.
  const generationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);
  // No-op until the first polling session installs its trigger.
  const refreshNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;

    return startThreadPolling(
      {
        fetchRef,
        onThreadsRef,
        onErrorRef,
        subscribeRecoveredRef,
        claimFailureRef,
        generationRef,
        inFlightRef,
        refreshNowRef,
      },
      { setIsRefreshing, intervalMs, maxBackoffMs },
    );
  }, [enabled, intervalMs, maxBackoffMs]);

  const refreshNow = useCallback(() => {
    refreshNowRef.current();
  }, []);

  return { refreshNow, isRefreshing };
}
