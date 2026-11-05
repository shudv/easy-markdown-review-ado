// File-finder search for the document navigation rail. Combines an instant
// local substring pass over the in-memory file list with a debounced,
// cancellable remote ADO Code Search (when wired), merging and deduping the
// two. Also owns the collapsible search-box open/close + focus behaviour.

import * as React from "react";

import type { FileInfo } from "../../types";
import type { FileSearchOutcome } from "../almSearch";
import { events, track, trackUserFacingError } from "../../telemetry";

const SEARCH_DEBOUNCE_MS = 250;

type SearchFiles = (
  query: string,
  signal?: AbortSignal,
) => Promise<FileSearchOutcome>;

interface RemoteHits {
  query: string;
  files: FileInfo[];
}

interface SearchUnavailable {
  reason: string;
  message?: string;
}

interface RemoteSearchSetters {
  setRemoteHits: (hits: RemoteHits) => void;
  setSearchUnavailable: (unavailable: SearchUnavailable | null) => void;
}

/** Record a settled Code Search outcome for `query` (hits or the hint). */
function applySearchOutcome(
  outcome: FileSearchOutcome,
  query: string,
  set: RemoteSearchSetters,
): void {
  if (outcome.kind === "ok") {
    set.setRemoteHits({ query, files: outcome.files });
    set.setSearchUnavailable(null);
    track(
      events.searchPerformed({
        queryLength: query.length,
        resultCount: outcome.files.length,
        succeeded: true,
      }),
    );
  } else {
    // Clear remote hits for this query; the list shows the hint.
    set.setRemoteHits({ query, files: [] });
    set.setSearchUnavailable({
      reason: outcome.reason,
      message: outcome.message,
    });
    track(
      events.searchPerformed({
        queryLength: query.length,
        resultCount: 0,
        succeeded: false,
        failureReason: outcome.reason,
      }),
    );
    if (
      outcome.reason !== "extension-missing" &&
      outcome.reason !== "no-config"
    ) {
      trackUserFacingError({
        error: new Error("Code Search request failed"),
        source: "DocNav.search",
        operation: "code-search",
        impact: "degraded",
      });
    }
  }
}

/** Record a rejected Code Search request for `query`. */
function applySearchFailure(
  err: unknown,
  query: string,
  set: RemoteSearchSetters,
): void {
  set.setRemoteHits({ query, files: [] });
  set.setSearchUnavailable({ reason: "unknown" });
  trackUserFacingError({
    error: err,
    source: "DocNav.search",
    operation: "code-search",
    impact: "degraded",
  });
}

/** Local hits first (instant), then unique remote hits, deduped by path. */
function mergeSearchResults(
  localHits: readonly FileInfo[],
  remoteHits: RemoteHits,
  trimmedQuery: string,
): FileInfo[] {
  const seen = new Set<string>();
  const out: FileInfo[] = [];
  for (const f of localHits) {
    seen.add(f.path);
    out.push(f);
  }
  // Only merge remote hits when they match the current query (else they'd
  // be stale between keystrokes).
  if (remoteHits.query === trimmedQuery) {
    for (const f of remoteHits.files) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

/**
 * Inline search affordance — collapsed by default; activating it takes over
 * the title slot with the search input.
 */
function useSearchBox(
  searchQuery: string,
  setSearchQuery: (query: string) => void,
) {
  const [searchOpen, setSearchOpen] = React.useState<boolean>(
    () => searchQuery.length > 0,
  );
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  React.useLayoutEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  // Re-open if the query gets set externally while collapsed (adjusted during
  // render so the collapsed state never paints with a query set).
  if (searchQuery && !searchOpen) setSearchOpen(true);
  const closeSearch = React.useCallback(() => {
    setSearchQuery("");
    setSearchOpen(false);
  }, [setSearchQuery]);
  return { searchOpen, setSearchOpen, closeSearch, searchInputRef };
}

/** Debounced, cancellable remote Code Search for `trimmedQuery`. */
function useRemoteSearch(trimmedQuery: string, onSearchFiles?: SearchFiles) {
  const [remoteHits, setRemoteHits] = React.useState<RemoteHits>(() => ({
    query: "",
    files: [],
  }));
  const [remoteLoading, setRemoteLoading] = React.useState<boolean>(false);
  // Sticky once the search service is known unavailable; held until a later
  // call succeeds.
  const [searchUnavailable, setSearchUnavailable] =
    React.useState<SearchUnavailable | null>(null);

  React.useEffect(() => {
    if (!onSearchFiles) return;
    if (trimmedQuery.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- This effect owns the external debounced, abortable Code Search request; its loading/result state is reset and set in the same step that cancels or starts that request.
      setRemoteHits({ query: "", files: [] });
      setRemoteLoading(false);
      return;
    }
    let cancelled = false;
    // AbortController cancels the in-flight fetch on cleanup; the `cancelled`
    // flag additionally guards against stale-query state updates.
    const controller = new AbortController();
    const setters = { setRemoteHits, setSearchUnavailable };
    setRemoteLoading(true);
    const handle = window.setTimeout(() => {
      onSearchFiles(trimmedQuery, controller.signal)
        .then((outcome) => {
          if (cancelled) return;
          applySearchOutcome(outcome, trimmedQuery, setters);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          applySearchFailure(err, trimmedQuery, setters);
        })
        .finally(() => {
          if (cancelled) return;
          setRemoteLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [trimmedQuery, onSearchFiles]);

  return { remoteHits, remoteLoading, searchUnavailable };
}

export function useDocSearch(files: FileInfo[], onSearchFiles?: SearchFiles) {
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const { searchOpen, setSearchOpen, closeSearch, searchInputRef } =
    useSearchBox(searchQuery, setSearchQuery);
  const { remoteHits, remoteLoading, searchUnavailable } = useRemoteSearch(
    trimmedQuery,
    onSearchFiles,
  );

  /** Local substring filter — runs synchronously every keystroke. */
  const localHits = React.useMemo<FileInfo[]>(() => {
    if (!isSearching) return [];
    const q = trimmedQuery.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, isSearching, trimmedQuery]);

  /** Combined search results: local hits first (instant), then unique remote
   *  hits, deduped by path. */
  const searchResults = React.useMemo<FileInfo[]>(() => {
    if (!isSearching) return [];
    return mergeSearchResults(localHits, remoteHits, trimmedQuery);
  }, [isSearching, localHits, remoteHits, trimmedQuery]);

  return {
    searchQuery,
    setSearchQuery,
    trimmedQuery,
    isSearching,
    searchOpen,
    setSearchOpen,
    closeSearch,
    searchInputRef,
    remoteLoading,
    searchUnavailable,
    searchResults,
  };
}
