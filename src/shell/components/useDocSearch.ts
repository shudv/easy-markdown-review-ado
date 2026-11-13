// File-finder search for the document navigation rail. Combines an instant
// local substring pass over the in-memory file list with a debounced,
// cancellable remote ADO Code Search (when wired), merging and deduping the
// two. Also owns the collapsible search-box open/close + focus behaviour.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FileInfo } from "../../types";
import type { FileSearchOutcome } from "../almSearch";
import { events, track, trackUserFacingError } from "../../telemetry";

const SEARCH_DEBOUNCE_MS = 250;

type SearchFiles = (query: string, signal?: AbortSignal) => Promise<FileSearchOutcome>;

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
        // Stryker disable next-line ObjectLiteral: the merge only shows remote hits whose query equals the current one, and an empty hits object matches no query, just like an empty list
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

        if (outcome.reason !== "extension-missing" && outcome.reason !== "no-config") {
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
function applySearchFailure(err: unknown, query: string, set: RemoteSearchSetters): void {
    // Stryker disable next-line ObjectLiteral: the merge only shows remote hits whose query equals the current one, and an empty hits object matches no query, just like an empty list
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
function useSearchBox(searchQuery: string, setSearchQuery: (query: string) => void) {
    // Stryker disable next-line ConditionalExpression: dead code: the query is always empty when the box mounts, so it always starts closed; candidate for removal
    const [searchOpen, setSearchOpen] = useState<boolean>(() => searchQuery.length > 0);

    const searchInputRef = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        if (searchOpen) searchInputRef.current?.focus();
    }, [searchOpen]);
    // Re-open if the query gets set externally while collapsed (adjusted during
    // render so the collapsed state never paints with a query set).
    if (searchQuery && !searchOpen) setSearchOpen(true);

    // Stryker disable ArrayDeclaration: setSearchQuery is a useState setter, stable for the hook's lifetime
    const closeSearch = useCallback(() => {
        setSearchQuery("");
        setSearchOpen(false);
    }, [setSearchQuery]);

    // Stryker restore ArrayDeclaration
    return { searchOpen, setSearchOpen, closeSearch, searchInputRef };
}

/** Debounced, cancellable remote Code Search for `trimmedQuery`. */
function useRemoteSearch(trimmedQuery: string, onSearchFiles?: SearchFiles) {
    // Stryker disable ObjectLiteral,StringLiteral,ArrayDeclaration: the initial hits are only merged for a query equal to theirs, which no real search has before the first result arrives
    const [remoteHits, setRemoteHits] = useState<RemoteHits>(() => ({
        query: "",
        files: [],
    }));
    // Stryker restore ObjectLiteral,StringLiteral,ArrayDeclaration

    const [remoteLoading, setRemoteLoading] = useState<boolean>(false);

    // Sticky once the search service is known unavailable; held until a later
    // call succeeds.
    const [searchUnavailable, setSearchUnavailable] = useState<SearchUnavailable | null>(null);

    useEffect(() => {
        if (!onSearchFiles) return;

        if (trimmedQuery.length < 2) {
            // Stryker disable next-line ObjectLiteral,StringLiteral,ArrayDeclaration: below two characters no remote hits are merged unless their query equals the typed one, which a reset placeholder never does
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

/**
 * Whether `path` matches a typed document search: every word of the query
 * appears in the path, in any order, with `-`, `_`, `.` and `/` read as spaces
 * — so "release notes" finds `docs/Release-Notes.md`, which a plain substring
 * check missed.
 */
export function pathMatchesQuery(path: string, query: string): boolean {
    const words = (s: string) =>
        s
            .toLowerCase()
            .split(/[\s\-_./\\]+/)
            .filter((word) => word !== "");

    const haystack = words(path).join(" ");
    const needles = words(query);

    // Only separators typed (e.g. "/"): fall back to a plain substring check.
    if (needles.length === 0) return path.toLowerCase().includes(query.toLowerCase());

    return needles.every((word) => haystack.includes(word));
}

export function useDocSearch(files: FileInfo[], onSearchFiles?: SearchFiles) {
    const [searchQuery, setSearchQuery] = useState<string>("");
    const trimmedQuery = searchQuery.trim();
    const isSearching = trimmedQuery.length > 0;

    const { searchOpen, setSearchOpen, closeSearch, searchInputRef } = useSearchBox(
        searchQuery,
        setSearchQuery,
    );

    const { remoteHits, remoteLoading, searchUnavailable } = useRemoteSearch(
        trimmedQuery,
        onSearchFiles,
    );

    /** Local word filter over the loaded file list — runs every keystroke. */
    const localHits = useMemo<FileInfo[]>(() => {
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: dead code: not searching, the results below are gated to [] anyway and these local hits are never shown; candidate for removal
        if (!isSearching) return [];

        return files.filter((f) => pathMatchesQuery(f.path, trimmedQuery));
    }, [files, isSearching, trimmedQuery]);

    /** Combined search results: local hits first (instant), then unique remote
     *  hits, deduped by path. */
    const searchResults = useMemo<FileInfo[]>(() => {
        // Stryker disable next-line ConditionalExpression: dead code: not searching, local hits are already empty and the remote hits were reset to the empty query, so the merge yields [] anyway; candidate for removal
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
