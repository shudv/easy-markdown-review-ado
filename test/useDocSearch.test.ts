// Behavioural tests for the `useDocSearch` file-finder hook. We mount a tiny
// React host that runs the hook with a controllable fake remote searcher,
// then drive it through query changes and assert only on the hook's public
// return surface (results, loading, unavailability, open/close) — never on
// how it computes them.
//
// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocSearch } from "../src/shell/components/useDocSearch";
import type { FileInfo } from "../src/types";
import type { FileSearchOutcome } from "../src/shell/almSearch";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function file(path: string): FileInfo {
    return { path, changeType: "modified", linesAdded: 0, linesDeleted: 0 };
}

type Hook = ReturnType<typeof useDocSearch>;

interface Handle {
    current: Hook | null;
}

function Harness(props: {
    files: FileInfo[];
    onSearchFiles?: (query: string, signal?: AbortSignal) => Promise<FileSearchOutcome>;
    handle: Handle;
}): null {
    const { handle: resultRef } = props;
    const search = useDocSearch(props.files, props.onSearchFiles);
    useLayoutEffect(() => {
        resultRef.current = search;
    });

    return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: {
    files: FileInfo[];
    onSearchFiles?: (query: string, signal?: AbortSignal) => Promise<FileSearchOutcome>;
}): Handle {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const handle: Handle = { current: null };
    act(() => {
        root!.render(createElement(Harness, { ...props, handle }));
    });

    return handle;
}

afterEach(() => {
    if (root) {
        act(() => root!.unmount());
        root = null;
    }

    container?.remove();
    container = null;
    vi.useRealTimers();
});

/** Advance fake timers inside act() and flush the resulting microtasks. */
async function flush(ms: number): Promise<void> {
    await act(async () => {
        vi.advanceTimersByTime(ms);
        // Let the awaited onSearchFiles promise settle.
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe("useDocSearch — local filtering", () => {
    const files = [file("docs/intro.md"), file("docs/guide.md"), file("api.md")];

    it("returns no results and is not searching while the query is empty", () => {
        const h = mount({ files });
        expect(h.current!.isSearching).toBe(false);
        expect(h.current!.searchResults).toEqual([]);
    });

    it("filters files by case-insensitive substring on the path", () => {
        const h = mount({ files });
        act(() => h.current!.setSearchQuery("GUIDE"));
        expect(h.current!.isSearching).toBe(true);
        expect(h.current!.searchResults.map((f) => f.path)).toEqual(["docs/guide.md"]);
    });

    it("treats a whitespace-only query as not searching", () => {
        const h = mount({ files });
        act(() => h.current!.setSearchQuery("   "));
        expect(h.current!.isSearching).toBe(false);
        expect(h.current!.searchResults).toEqual([]);
    });
});

describe("useDocSearch — open/close affordance", () => {
    it("opens automatically once a query is typed and closes via closeSearch", () => {
        const h = mount({ files: [file("a.md")] });
        expect(h.current!.searchOpen).toBe(false);
        act(() => h.current!.setSearchQuery("a"));
        expect(h.current!.searchOpen).toBe(true);

        act(() => h.current!.closeSearch());
        expect(h.current!.searchOpen).toBe(false);
        expect(h.current!.isSearching).toBe(false);
        expect(h.current!.searchResults).toEqual([]);
    });
});

describe("useDocSearch — focusing the search box", () => {
    afterEach(() => {
        document.querySelectorAll("body > input").forEach((input) => input.remove());
    });

    function withInput(h: Handle): HTMLInputElement {
        const input = document.body.appendChild(document.createElement("input"));
        (h.current!.searchInputRef as { current: HTMLInputElement | null }).current = input;

        return input;
    }

    it("focuses the search box when it opens", () => {
        const h = mount({ files: [] });
        const input = withInput(h);
        act(() => h.current!.setSearchOpen(true));
        expect(document.activeElement).toBe(input);
    });

    it("doesn't pull focus back to the search box when it closes", () => {
        const h = mount({ files: [] });
        const input = withInput(h);
        act(() => h.current!.setSearchOpen(true));
        input.blur();
        act(() => h.current!.closeSearch());
        expect(document.activeElement).not.toBe(input);
    });
});

describe("useDocSearch — without Code Search", () => {
    beforeEach(() => vi.useFakeTimers());

    it("filters locally and never shows a remote search in progress", async () => {
        const h = mount({ files: [file("docs/guide.md")] });
        act(() => h.current!.setSearchQuery("guide"));
        await flush(1000);
        expect(h.current!.remoteLoading).toBe(false);
        expect(h.current!.searchResults.map((f) => f.path)).toEqual(["docs/guide.md"]);
    });
});

describe("useDocSearch — remote merge", () => {
    beforeEach(() => vi.useFakeTimers());

    it("does not call the remote searcher for queries shorter than 2 chars", async () => {
        const onSearchFiles = vi.fn();
        const h = mount({ files: [file("a.md")], onSearchFiles });
        act(() => h.current!.setSearchQuery("a"));
        await flush(1000);
        expect(onSearchFiles).not.toHaveBeenCalled();
        expect(h.current!.remoteLoading).toBe(false);
    });

    it("merges remote hits after local ones, deduped by path", async () => {
        const onSearchFiles = vi.fn(
            async (): Promise<FileSearchOutcome> => ({
                kind: "ok",
                files: [file("docs/guide.md"), file("remote/only.md")],
            }),
        );

        const h = mount({
            files: [file("docs/guide.md"), file("local.md")],
            onSearchFiles,
        });

        act(() => h.current!.setSearchQuery("o"));
        // 1-char query: local-only ("o" matches docs and local), no remote.
        act(() => h.current!.setSearchQuery("do"));
        await flush(300);

        expect(onSearchFiles).toHaveBeenCalledWith("do", expect.anything());
        expect(h.current!.searchResults.map((f) => f.path)).toEqual([
            "docs/guide.md", // local hit, kept once despite also being a remote hit
            "remote/only.md", // remote-only hit appended
        ]);
        expect(h.current!.remoteLoading).toBe(false);
        expect(h.current!.searchUnavailable).toBeNull();
    });

    it("surfaces an unavailable outcome and drops remote hits", async () => {
        const onSearchFiles = vi.fn(
            async (): Promise<FileSearchOutcome> => ({
                kind: "unavailable",
                reason: "extension-missing",
                message: "Code Search not installed",
            }),
        );

        const h = mount({ files: [file("local.md")], onSearchFiles });
        act(() => h.current!.setSearchQuery("loc"));
        await flush(300);

        expect(h.current!.searchUnavailable).toEqual({
            reason: "extension-missing",
            message: "Code Search not installed",
        });
        // Only the local hit remains.
        expect(h.current!.searchResults.map((f) => f.path)).toEqual(["local.md"]);
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("treats a rejected remote search as an unknown unavailability", async () => {
        const onSearchFiles = vi.fn(async (): Promise<FileSearchOutcome> => {
            throw new Error("boom");
        });

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("query"));
        await flush(300);

        expect(h.current!.searchUnavailable).toEqual({ reason: "unknown" });
        expect(h.current!.searchResults).toEqual([]);
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ message: "boom" }),
                source: "DocNav.search",
                operation: "code-search",
                impact: "degraded",
            }),
        ]);
    });

    it("recovers from unavailable back to ok on a later successful query", async () => {
        let outcome: FileSearchOutcome = {
            kind: "unavailable",
            reason: "network",
        };

        const onSearchFiles = vi.fn(async (): Promise<FileSearchOutcome> => outcome);

        const h = mount({ files: [], onSearchFiles });

        act(() => h.current!.setSearchQuery("aa"));
        await flush(300);
        expect(h.current!.searchUnavailable).not.toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({
                    message: "Code Search request failed",
                }),
                source: "DocNav.search",
                operation: "code-search",
                impact: "degraded",
            }),
        ]);

        outcome = { kind: "ok", files: [file("found.md")] };
        act(() => h.current!.setSearchQuery("aaa"));
        await flush(300);
        expect(h.current!.searchUnavailable).toBeNull();
        expect(h.current!.searchResults.map((f) => f.path)).toEqual(["found.md"]);
    });

    it("shows remote loading while the code search is in flight", async () => {
        let resolveOutcome: (o: FileSearchOutcome) => void = () => {};

        const onSearchFiles = vi.fn(
            () =>
                new Promise<FileSearchOutcome>((res) => {
                    resolveOutcome = res;
                }),
        );

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("abc"));
        await act(async () => {
            vi.advanceTimersByTime(250);
            await Promise.resolve();
        });
        expect(h.current!.remoteLoading).toBe(true);
        await act(async () => {
            resolveOutcome({ kind: "ok", files: [] });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(h.current!.remoteLoading).toBe(false);
    });

    it("searches remotely once, for the final query, after the user stops typing", async () => {
        const onSearchFiles = vi.fn(
            async (_query: string): Promise<FileSearchOutcome> => ({ kind: "ok", files: [] }),
        );

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("ab"));
        await flush(100);
        act(() => h.current!.setSearchQuery("abc"));
        await flush(100);
        act(() => h.current!.setSearchQuery("abcd"));
        await flush(300);
        expect(onSearchFiles).toHaveBeenCalledExactlyOnceWith("abcd", expect.anything());
    });

    it("reports a successful search with its result count", async () => {
        const onSearchFiles = vi.fn(
            async (): Promise<FileSearchOutcome> => ({
                kind: "ok",
                files: [file("r/one.md"), file("r/two.md")],
            }),
        );

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("abcd"));
        await flush(300);
        expect(telemetry.current.events).toContainEqual(
            expect.objectContaining({
                name: "search.performed",
                properties: expect.objectContaining({ succeeded: true }),
                measurements: { queryLength: 4, resultCount: 2 },
            }),
        );
    });

    it("reports an unavailable search with its reason, without counting it as an error", async () => {
        const onSearchFiles = vi.fn(
            async (): Promise<FileSearchOutcome> => ({
                kind: "unavailable",
                reason: "extension-missing",
            }),
        );

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("abcd"));
        await flush(300);
        expect(telemetry.current.events).toContainEqual(
            expect.objectContaining({
                name: "search.performed",
                properties: expect.objectContaining({
                    succeeded: false,
                    failureReason: "extension-missing",
                }),
                measurements: expect.objectContaining({ resultCount: 0 }),
            }),
        );
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("does not count no-config as a reliability failure", async () => {
        const onSearchFiles = vi.fn(
            async (): Promise<FileSearchOutcome> => ({
                kind: "unavailable",
                reason: "no-config",
            }),
        );

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("abcd"));
        await flush(300);
        expect(h.current!.searchUnavailable?.reason).toBe("no-config");
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });
});

describe("useDocSearch — superseded remote searches", () => {
    beforeEach(() => vi.useFakeTimers());

    /**
     * Mount with a remote searcher whose calls settle only when the test says
     * so, fire a search for "ab", then change the query while it is in flight.
     */
    async function supersedeInFlightSearch() {
        const calls: Array<{
            resolve: (outcome: FileSearchOutcome) => void;
            reject: (err: Error) => void;
        }> = [];

        const onSearchFiles = vi.fn(
            () =>
                new Promise<FileSearchOutcome>((resolve, reject) => {
                    calls.push({ resolve, reject });
                }),
        );

        const h = mount({ files: [], onSearchFiles });
        act(() => h.current!.setSearchQuery("ab"));
        await flush(250);
        act(() => h.current!.setSearchQuery("abc"));

        return { calls, h };
    }

    async function settle(run: () => void): Promise<void> {
        await act(async () => {
            run();
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it("drops hits that arrive after the query changed", async () => {
        const { calls, h } = await supersedeInFlightSearch();
        await settle(() => calls[0]!.resolve({ kind: "ok", files: [file("stale.md")] }));
        expect(h.current!.searchResults).toEqual([]);
        expect(h.current!.remoteLoading).toBe(true);

        await flush(250);
        await settle(() => calls[1]!.resolve({ kind: "ok", files: [file("fresh.md")] }));
        expect(h.current!.searchResults.map((f) => f.path)).toEqual(["fresh.md"]);
        expect(h.current!.remoteLoading).toBe(false);
    });

    it("hides the previous query's remote hits while the new query is being searched", async () => {
        const { calls, h } = await supersedeInFlightSearch();
        await flush(250);
        await settle(() => calls[1]!.resolve({ kind: "ok", files: [file("abc.md")] }));
        act(() => h.current!.setSearchQuery("abcd"));
        expect(h.current!.searchResults).toEqual([]);
    });

    it("ignores an unavailable result that arrives after the query changed", async () => {
        const { calls, h } = await supersedeInFlightSearch();
        await settle(() => calls[0]!.resolve({ kind: "unavailable", reason: "network" }));
        expect(h.current!.searchUnavailable).toBeNull();
        expect(telemetry.current.events).toEqual([]);
    });

    it("drops a failure that arrives after the query changed", async () => {
        const { calls, h } = await supersedeInFlightSearch();
        await settle(() => calls[0]!.reject(new Error("aborted")));
        expect(h.current!.searchUnavailable).toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
        expect(h.current!.remoteLoading).toBe(true);
    });
});
