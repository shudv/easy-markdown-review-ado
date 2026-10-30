// PrShell: the comment thread store and its remote sync.

import * as React from "react";

import type { CommentAuthor, CommentThread } from "../../types";
import { initialThreadState, threadReducer } from "../../comments/store";
import type { IdentityStore } from "../../comments/identityStore";
import { collectUserMentionIds } from "../../comments/mentions";
import { useThreadSync } from "../../comments/useThreadSync";
import { events, track, trackUserFacingError } from "../../telemetry";
import { adoSession } from "../adoSession";

interface ThreadStoreOptions {
  initialThreads: CommentThread[];
  currentUser: CommentAuthor;
  identityStore: IdentityStore;
  selectedPath: string;
  selectedPathRef: React.MutableRefObject<string>;
  fetchRemoteThreads:
    | ((signal: AbortSignal) => Promise<CommentThread[]>)
    | undefined;
  loadThreadsForPath: ((path: string) => Promise<CommentThread[]>) | undefined;
  threadSyncIntervalMs: number | undefined;
  onRefreshFiles: (() => void | Promise<void>) | undefined;
}

/**
 * The thread store plus everything that feeds it: identity seeding,
 * background remote-thread sync, the toolbar refresh, and per-document loads.
 */
export function useThreadStore(opts: ThreadStoreOptions) {
  const {
    currentUser,
    identityStore,
    selectedPath,
    selectedPathRef,
    loadThreadsForPath,
    onRefreshFiles,
  } = opts;
  const [threadState, dispatch] = React.useReducer(
    threadReducer,
    initialThreadState(opts.initialThreads),
  );

  // Seed the identity store for free from everyone we already know: the current
  // user plus every comment author. This resolves the common `@<GUID>` mentions
  // (self, PR participants) with zero network. Referenced-but-unknown mention
  // ids (people who aren't participants) are prefetched in one batch so their
  // names resolve on load, rather than flashing a raw GUID until each pill
  // happens to render.
  React.useEffect(() => {
    const people: Array<{
      id: string;
      displayName?: string;
      avatarUrl?: string;
    }> = [currentUser];
    const mentionIds: string[] = [];
    for (const id of threadState.order) {
      const t = threadState.threadsById[id];
      /* v8 ignore next -- order ids always have a thread entry */
      if (!t) continue;
      // Seed names ADO already resolved for this thread's @mentions. This is
      // the authoritative source (works even in personal-MSA orgs where the
      // by-id identities endpoint returns null), so mentions render as names on
      // load with no network call.
      if (t.mentionedIdentities) people.push(...t.mentionedIdentities);
      for (const c of t.comments) {
        people.push(c.author);
        mentionIds.push(...collectUserMentionIds(c.bodyMarkdown));
      }
    }
    identityStore.seed(people);
    // `ensure` skips ids already known (e.g. seeded authors) and coalesces the
    // rest into a single resolver call.
    if (mentionIds.length > 0) identityStore.ensure(mentionIds);
  }, [threadState, currentUser, identityStore]);

  // Background remote-thread sync; merges snapshots preserving optimistic writes.
  const onRemoteThreads = React.useCallback((threads: CommentThread[]) => {
    dispatch({ type: "MERGE_REMOTE_THREADS", threads });
  }, []);
  // A PR-wide snapshot (`fetchRemoteThreads`) holds every thread, so it lets a
  // `?comment=` deep link tell "not loaded yet" from "doesn't exist". A
  // per-document snapshot can't: it only covers whichever file was open.
  const [prThreadSnapshots, setPrThreadSnapshots] = React.useState(0);
  const onPrThreads = React.useCallback((threads: CommentThread[]) => {
    dispatch({ type: "MERGE_REMOTE_THREADS", threads });
    setPrThreadSnapshots((n) => n + 1);
  }, []);
  const noopFetch = React.useCallback(
    /* v8 ignore next -- fallback fetch, only wired up when fetchRemoteThreads is absent */
    (_signal: AbortSignal): Promise<CommentThread[]> => Promise.resolve([]),
    [],
  );
  // Per-document mode: poll the *currently selected* document's threads. The
  // closure reads `selectedPathRef` so its identity stays stable across file
  // switches while always targeting the active document.
  const perPathFetch = React.useCallback(
    /* v8 ignore start -- guard only; perPathFetch is wired solely when loadThreadsForPath is set */
    (_signal: AbortSignal): Promise<CommentThread[]> =>
      loadThreadsForPath
        ? loadThreadsForPath(selectedPathRef.current)
        : Promise.resolve([]),
    /* v8 ignore stop */
    [loadThreadsForPath, selectedPathRef],
  );
  const effectiveFetch =
    opts.fetchRemoteThreads ?? (loadThreadsForPath ? perPathFetch : undefined);
  const threadSync = useThreadSync({
    enabled: !!effectiveFetch,
    fetchThreads: effectiveFetch ?? noopFetch,
    onThreads: opts.fetchRemoteThreads ? onPrThreads : onRemoteThreads,
    intervalMs: opts.threadSyncIntervalMs,
    // Resume polling the moment the ADO session is re-minted.
    subscribeRecovered: adoSession.onRecovered,
  });

  // Unified data refresh surfaced on the reading toolbar: pull a fresh comment
  // snapshot AND (when the host provides one) reload the file list in one click
  // — replacing the separate per-header refresh buttons. Gated on comment
  // refreshability, which every reader surface has; hosts that also expose a
  // file reload pass `onRefreshFiles` to fold it into the same click.
  const canRefreshComments = !!effectiveFetch;
  // A host file reload can be async and slower than the comment poll. Track it
  // so the toolbar stays "refreshing" until BOTH settle — otherwise the button
  // re-enables the moment the poll finishes and a slow file reload could be
  // fired again while the first is still running.
  const [fileRefreshInFlight, setFileRefreshInFlight] = React.useState(false);
  const handleRefresh = React.useCallback(() => {
    // `refreshNow` is a safe no-op when thread sync is disabled, so no guard.
    threadSync.refreshNow();
    track(events.commentsRefreshed());
    if (!onRefreshFiles) return;
    setFileRefreshInFlight(true);
    // Normalize to a promise so a sync or async host reload is handled the
    // same; its rejection is logged, never left unhandled.
    void Promise.resolve(onRefreshFiles())
      .catch((err: unknown) => {
        console.warn("[PrShell] file refresh failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.refresh",
          operation: "file-refresh",
          impact: "action-failed",
        });
      })
      .finally(() => setFileRefreshInFlight(false));
  }, [threadSync, onRefreshFiles]);
  const refreshLabel = onRefreshFiles
    ? "Refresh files and comments"
    : "Refresh comments";

  // Per-document mode: load the selected file's threads the first time it's
  // opened (the poller above keeps the active file fresh thereafter).
  const loadedThreadPathsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!loadThreadsForPath || !selectedPath) return;
    if (loadedThreadPathsRef.current.has(selectedPath)) return;
    loadedThreadPathsRef.current.add(selectedPath);
    let cancelled = false;
    loadThreadsForPath(selectedPath)
      .then((threads) => {
        /* v8 ignore start -- cleanup races ahead of a slow resolve; not deterministically reproducible in tests */
        if (cancelled) {
          return;
        }
        /* v8 ignore stop */
        dispatch({ type: "MERGE_REMOTE_THREADS", threads });
      })
      .catch((err: unknown) => {
        // Allow a retry on the next selection of this path.
        loadedThreadPathsRef.current.delete(selectedPath);

        console.warn("[PrShell] loadThreadsForPath failed:", err);
        trackUserFacingError({
          error: err,
          source: "PrShell.comments",
          operation: "comments-load",
          impact: "degraded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [loadThreadsForPath, selectedPath]);

  return {
    threadState,
    dispatch,
    prThreadSnapshots,
    threadSync,
    canRefreshComments,
    fileRefreshInFlight,
    handleRefresh,
    refreshLabel,
  };
}
