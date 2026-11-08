// Tests for the visibility-aware polling hook `useThreadSync`. We mount
// a tiny React host that calls the hook with a controllable fake
// fetcher, then drive it with fake timers + jsdom event dispatch.
//
// @vitest-environment jsdom

import { act, createElement, type ReactElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    MAX_RECOVER_WAIT_MS,
    RECOVER_BUFFER_MS,
    nextPollDelayMs,
    useThreadSync,
} from "../src/comments/useThreadSync";
import { SessionRefreshingError } from "../src/shell/adoAuthToken";
import type { CommentThread } from "../src/types";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

// React 18 sets this so `act` can run synchronously in jsdom.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface HarnessOpts {
    enabled: boolean;
    fetchThreads: (signal: AbortSignal) => Promise<CommentThread[]>;
    onThreads: (threads: CommentThread[]) => void;
    onError?: (err: unknown) => void;
    intervalMs?: number;
    maxBackoffMs?: number;
    subscribeRecovered?: (listener: () => void) => () => void;
    claimFailure?: (err: unknown, userWaiting: boolean) => boolean;
}

// Exposed via the harness so tests can inspect / call `refreshNow`.
interface HarnessHandle {
    controls: ReturnType<typeof useThreadSync> | null;
}

function Harness(
    props: Readonly<
        HarnessOpts & {
            onControls: (controls: ReturnType<typeof useThreadSync>) => void;
        }
    >,
): null {
    const controls = useThreadSync({
        enabled: props.enabled,
        fetchThreads: props.fetchThreads,
        onThreads: props.onThreads,
        onError: props.onError,
        intervalMs: props.intervalMs,
        maxBackoffMs: props.maxBackoffMs,
        subscribeRecovered: props.subscribeRecovered,
        claimFailure: props.claimFailure,
    });

    const { onControls } = props;
    // Publish the latest controls after every commit so tests read the
    // committed `refreshNow` / `isRefreshing` once `act` returns.
    useLayoutEffect(() => {
        onControls(controls);
    });

    return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function harnessElement(opts: HarnessOpts, handle: HarnessHandle): ReactElement {
    return createElement(Harness, {
        ...opts,
        onControls: (controls) => {
            handle.controls = controls;
        },
    });
}

function mount(opts: HarnessOpts): HarnessHandle {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const handle: HarnessHandle = { controls: null };
    act(() => {
        root!.render(harnessElement(opts, handle));
    });

    return handle;
}

function unmount(): void {
    if (root) {
        act(() => {
            root!.unmount();
        });
        root = null;
    }

    if (container) {
        container.remove();
        container = null;
    }
}

/**
 * Force jsdom's `document.visibilityState` to a given value by defining
 * the property on the document instance. jsdom defaults to "visible"
 * and ignores `Object.defineProperty` on the prototype, so we redefine
 * the instance property.
 */
function setVisibility(value: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => value,
    });
}

// Deferred-promise helper so the test controls when fetchThreads resolves.
interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
}

function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

// Flushes both microtasks (so .then callbacks run) and pending React
// state updates triggered by them.
async function flush(): Promise<void> {
    await act(async () => {
        // Two ticks: one for the awaited fetch, one for the .finally.
        await Promise.resolve();
        await Promise.resolve();
    });
}

// Advance fake time and let the resulting fetch settle.
async function tick(ms: number): Promise<void> {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
    await flush();
}

beforeEach(() => {
    setVisibility("visible");
});

afterEach(() => {
    unmount();
    vi.useRealTimers();
    setVisibility("visible");
});

describe("useThreadSync — gating", () => {
    it("is a no-op when enabled=false", () => {
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({ enabled: false, fetchThreads, onThreads });
        expect(fetchThreads).not.toHaveBeenCalled();
        expect(onThreads).not.toHaveBeenCalled();
    });

    it("calls fetchThreads on mount when enabled", async () => {
        const threads: CommentThread[] = [];
        const fetchThreads = vi.fn(async () => threads);
        const onThreads = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        expect(onThreads).toHaveBeenCalledWith(threads);
    });
});

describe("useThreadSync — interval polling", () => {
    it("polls at intervalMs while visible", async () => {
        vi.useFakeTimers();
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
            intervalMs: 1_000,
        });
        // Initial mount fetch.
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // Two intervals tick → two more fetches.
        await act(async () => {
            vi.advanceTimersByTime(1_000);
        });
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(1_000);
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(3);
    });

    it("does not start the interval when mounted hidden, but still does an initial fetch", async () => {
        vi.useFakeTimers();
        setVisibility("hidden");
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
            intervalMs: 1_000,
        });
        await flush();
        // The hook does the initial load eagerly so data is ready when
        // the user returns.
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        // No interval should tick.
        await act(async () => {
            vi.advanceTimersByTime(5_000);
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);
    });
});

describe("useThreadSync — visibility transitions", () => {
    it("pauses polling on tab hide", async () => {
        vi.useFakeTimers();
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
            intervalMs: 1_000,
        });
        await flush();
        // After one tick the count is 2 (initial + 1 interval).
        await act(async () => {
            vi.advanceTimersByTime(1_000);
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);

        // Hide → interval stops, no more fetches.
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(5_000);
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("fires an immediate refresh on visibilitychange→visible", async () => {
        vi.useFakeTimers();
        setVisibility("hidden");
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
            intervalMs: 1_000,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // Reveal → immediate refresh + interval starts.
        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);

        // And the interval now ticks.
        await act(async () => {
            vi.advanceTimersByTime(1_000);
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(3);
    });

    it("fires an immediate refresh on window focus when visible", async () => {
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new Event("focus"));
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("ignores window focus while hidden", async () => {
        setVisibility("hidden");
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new Event("focus"));
        });
        await flush();
        // Focus while hidden is a no-op.
        expect(fetchThreads).toHaveBeenCalledTimes(1);
    });

    it("aborts a still-pending fetch when the tab is revealed", async () => {
        setVisibility("hidden");
        const d = defer<CommentThread[]>();
        let firstSignal: AbortSignal | null = null;

        const fetchThreads = vi.fn(async (signal: AbortSignal) => {
            firstSignal ??= signal;

            return d.promise;
        });

        const onThreads = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads });
        // The eager mount fetch is in flight and not yet aborted.
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        expect(firstSignal!.aborted).toBe(false);

        // Reveal while that request is still pending: it must be aborted and a
        // fresh fetch kicked off immediately.
        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(firstSignal!.aborted).toBe(true);
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });
});

describe("useThreadSync — abort + generation safety", () => {
    it("aborts the in-flight request when the tab hides and discards its result", async () => {
        const d = defer<CommentThread[]>();
        let observedSignal: AbortSignal | null = null;

        const fetchThreads = vi.fn(async (signal: AbortSignal) => {
            observedSignal = signal;

            return d.promise;
        });

        const onThreads = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads });
        // Initial fetch is now pending.
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        expect(observedSignal!.aborted).toBe(false);

        // Hide → controller.abort fires, generation bumps.
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(observedSignal!.aborted).toBe(true);

        // Even if the original promise resolves now, onThreads must not
        // be called — generation mismatch.
        await act(async () => {
            d.resolve([{ id: "stale" } as unknown as CommentThread]);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(onThreads).not.toHaveBeenCalled();
    });

    it("discards a slow response from before a tab switch once the fresh one has landed", async () => {
        const slow = defer<CommentThread[]>();
        const fresh = defer<CommentThread[]>();

        const fetchThreads = vi
            .fn<(signal: AbortSignal) => Promise<CommentThread[]>>()
            .mockReturnValueOnce(slow.promise)
            .mockReturnValueOnce(fresh.promise);

        const onThreads = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads });
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        const staleThreads = [{ id: "stale" } as unknown as CommentThread];
        const freshThreads = [{ id: "fresh" } as unknown as CommentThread];
        await act(async () => {
            fresh.resolve(freshThreads);
            // The host's fetch ignored the abort and answers late.
            slow.resolve(staleThreads);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onThreads).toHaveBeenCalledWith(freshThreads);
        expect(onThreads).not.toHaveBeenCalledWith(staleThreads);
    });

    it("keeps one request at a time when focus follows a return to the tab", async () => {
        const fetchThreads = vi.fn(
            (signal: AbortSignal) =>
                new Promise<CommentThread[]>((_resolve, reject) => {
                    signal.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError")),
                    );
                }),
        );

        mount({ enabled: true, fetchThreads, onThreads: vi.fn() });
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        // Let the aborted first request finish settling.
        await flush();

        act(() => {
            window.dispatchEvent(new Event("focus"));
        });

        // The mount fetch plus the one started on reveal, which is still loading.
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("dedupes concurrent refreshNow calls into a single fetch", async () => {
        const d = defer<CommentThread[]>();
        const fetchThreads = vi.fn(async () => d.promise);
        const onThreads = vi.fn();
        const handle = mount({ enabled: true, fetchThreads, onThreads });
        // Initial fetch is in flight.
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // While in flight, refreshNow is a no-op.
        act(() => {
            handle.controls!.refreshNow();
            handle.controls!.refreshNow();
            handle.controls!.refreshNow();
        });
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // Resolve the original → now refreshNow can start a fresh fetch.
        await act(async () => {
            d.resolve([]);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(onThreads).toHaveBeenCalledTimes(1);
    });
});

describe("useThreadSync — refreshNow + isRefreshing", () => {
    it("flips isRefreshing true→false around a fetch", async () => {
        const d = defer<CommentThread[]>();
        const fetchThreads = vi.fn(async () => d.promise);
        const onThreads = vi.fn();
        const handle = mount({ enabled: true, fetchThreads, onThreads });
        // The hook synchronously sets isRefreshing=true; the React commit
        // for it runs during mount's act block.
        expect(handle.controls!.isRefreshing).toBe(true);

        await act(async () => {
            d.resolve([]);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(handle.controls!.isRefreshing).toBe(false);
    });

    it("shows no refresh in progress while sync is off", () => {
        const handle = mount({
            enabled: false,
            fetchThreads: vi.fn(async () => [] as CommentThread[]),
            onThreads: vi.fn(),
        });

        expect(handle.controls!.isRefreshing).toBe(false);
    });

    it("clears the refreshing indicator when the tab is hidden mid-refresh", () => {
        const pending = defer<CommentThread[]>();

        const handle = mount({
            enabled: true,
            fetchThreads: () => pending.promise,
            onThreads: vi.fn(),
        });

        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(handle.controls!.isRefreshing).toBe(false);
    });

    it("clears the refreshing indicator when sync is turned off mid-refresh", () => {
        const pending = defer<CommentThread[]>();
        const opts = { enabled: true, fetchThreads: () => pending.promise, onThreads: vi.fn() };
        const handle = mount(opts);

        act(() => {
            root!.render(harnessElement({ ...opts, enabled: false }, handle));
        });

        expect(handle.controls!.isRefreshing).toBe(false);
    });

    it("hands each snapshot to the host's latest onThreads callback", async () => {
        const snapshot = [{ id: "t1" } as unknown as CommentThread];
        const fetchThreads = vi.fn(async () => snapshot);
        const firstHandler = vi.fn();
        const latestHandler = vi.fn();
        const handle = mount({ enabled: true, fetchThreads, onThreads: firstHandler });
        await flush();

        act(() => {
            root!.render(
                harnessElement({ enabled: true, fetchThreads, onThreads: latestHandler }, handle),
            );
        });
        await act(async () => {
            handle.controls!.refreshNow();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(latestHandler).toHaveBeenCalledWith(snapshot);
    });

    it("triggers an additional fetch via refreshNow() after the first settles", async () => {
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        const handle = mount({ enabled: true, fetchThreads, onThreads });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        await act(async () => {
            handle.controls!.refreshNow();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });
});

describe("useThreadSync — error handling", () => {
    it("hands a failed first load to onError and reports the degraded refresh", async () => {
        const onError = vi.fn();
        const boom = new Error("network down");

        const fetchThreads = vi.fn(async () => {
            throw boom;
        });

        const onThreads = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads, onError });
        await flush();
        expect(onThreads).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(boom);
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: boom,
                source: "ThreadSync.poll",
                operation: "comments-refresh",
                impact: "degraded",
            }),
        ]);
    });

    it("falls back to console.warn when onError is not provided", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const fetchThreads = vi.fn(async () => {
            throw new Error("boom");
        });

        const onThreads = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads });
        await flush();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("fetch failed"),
            expect.any(Error),
        );
        warn.mockRestore();
    });
});

describe("useThreadSync — failure backoff", () => {
    const authError = () => Object.assign(new Error("TF400813: not authorized"), { status: 401 });

    // Production regression: a 401 every 30s for hours (one tab: 88h), each
    // poll reported to telemetry. Failures must back off and report once.
    it("doubles the delay on consecutive failures and reports once per streak", async () => {
        vi.useFakeTimers();

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            throw authError();
        });

        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 1_000,
            maxBackoffMs: 4_000,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // Streak 1 → wait 1s, streak 2 → 2s, streak 3 → 4s, then capped at 4s.
        await tick(999);
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(fetchThreads).toHaveBeenCalledTimes(2);
        await tick(1_999);
        expect(fetchThreads).toHaveBeenCalledTimes(2);
        await tick(1);
        expect(fetchThreads).toHaveBeenCalledTimes(3);
        await tick(4_000);
        expect(fetchThreads).toHaveBeenCalledTimes(4);
        await tick(4_000);
        expect(fetchThreads).toHaveBeenCalledTimes(5);

        expect(telemetry.current.userFacingErrors()).toHaveLength(1);
    });

    it("returns to the normal cadence after a success and reports a new streak again", async () => {
        vi.useFakeTimers();
        let fail = true;

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            if (fail) throw authError();

            return [];
        });

        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
            onError: vi.fn(),
            intervalMs: 1_000,
        });
        await flush();
        await tick(1_000); // 2nd failure → next wait 2s
        expect(fetchThreads).toHaveBeenCalledTimes(2);

        fail = false;
        await tick(2_000);
        expect(fetchThreads).toHaveBeenCalledTimes(3);
        expect(onThreads).toHaveBeenCalledTimes(1);

        // Healthy again → plain interval.
        await tick(1_000);
        expect(fetchThreads).toHaveBeenCalledTimes(4);

        // A new background streak reports on its second failure, not its first.
        fail = true;
        await tick(1_000);
        expect(telemetry.current.userFacingErrors()).toHaveLength(1);
        await tick(1_000);
        expect(telemetry.current.userFacingErrors()).toHaveLength(2);
    });

    // Production: lone `TF400893` network blips on a background poll were
    // reported although the next poll healed them and nothing was visible.
    it("does not report a lone background failure the next poll heals", async () => {
        vi.useFakeTimers();
        let fail = false;

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            if (fail) {
                throw new Error("TF400893: Unable to contact the server.");
            }

            return [];
        });

        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 1_000,
        });
        await flush();
        fail = true;
        await tick(1_000);
        fail = false;
        await tick(1_000);
        expect(fetchThreads).toHaveBeenCalledTimes(3);
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("reports a failed manual refresh at once, even mid-healthy", async () => {
        vi.useFakeTimers();
        let fail = false;

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            if (fail) throw authError();

            return [];
        });

        const handle = mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 60_000,
        });

        await flush();
        fail = true;
        await act(async () => {
            handle.controls!.refreshNow();
        });
        await flush();
        expect(telemetry.current.userFacingErrors()).toHaveLength(1);
    });

    describe("claimFailure", () => {
        const deadWindow = () => new SessionRefreshingError("refreshing", Date.now() + 4 * 60_000);

        it("lets the host own a failure it claims, and says whether the user waits", async () => {
            vi.useFakeTimers();
            let fail = false;

            const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
                if (fail) throw deadWindow();

                return [];
            });

            const claimFailure = vi.fn(() => true);

            const handle = mount({
                enabled: true,
                fetchThreads,
                onThreads: vi.fn(),
                onError: vi.fn(),
                intervalMs: 1_000,
                claimFailure,
            });

            await flush();

            // Background: offered on every failure, never reported here.
            fail = true;
            await tick(1_000);
            await tick(5 * 60_000);
            expect(claimFailure).toHaveBeenCalledTimes(2);
            expect(claimFailure).toHaveBeenLastCalledWith(
                expect.any(SessionRefreshingError),
                false,
            );

            // The user starts waiting partway through the streak.
            await act(async () => {
                handle.controls!.refreshNow();
            });
            await flush();
            expect(claimFailure).toHaveBeenLastCalledWith(expect.any(SessionRefreshingError), true);
            expect(telemetry.current.userFacingErrors()).toEqual([]);
        });

        it("treats a failure before anything has loaded as one the user waits on", async () => {
            const claimFailure = vi.fn(() => false);
            const boom = new Error("boom");

            mount({
                enabled: true,
                fetchThreads: vi.fn(async () => {
                    throw boom;
                }),
                onThreads: vi.fn(),
                onError: vi.fn(),
                claimFailure,
            });
            await flush();
            expect(claimFailure).toHaveBeenCalledWith(boom, true);
            // Not claimed → the poller reports it as usual.
            expect(telemetry.current.userFacingErrors()).toHaveLength(1);
        });
    });

    it("pauses until recoverAtMs for a session-refreshing error, then resumes", async () => {
        vi.useFakeTimers();
        const now = Date.now();
        let refreshing = true;

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            if (refreshing) {
                // The real error the PR tab's loader throws in the dead window.
                throw new SessionRefreshingError("refreshing", now + 4 * 60_000);
            }

            return [];
        });

        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 30_000,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // No futile polls through the dead window…
        await tick(4 * 60_000);
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        // …then one poll just after the host re-mints.
        refreshing = false;
        await tick(2_000);
        expect(fetchThreads).toHaveBeenCalledTimes(2);
        await tick(30_000);
        expect(fetchThreads).toHaveBeenCalledTimes(3);
    });

    it("does not let focus or reveal cut a backoff short", async () => {
        vi.useFakeTimers();

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            throw authError();
        });

        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 10_000,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new Event("focus"));
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        // Hide for 4s, then reveal: the remaining 6s of backoff still applies.
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await tick(4_000);
        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        await tick(5_999);
        expect(fetchThreads).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("polls immediately on reveal once a backoff has elapsed while hidden", async () => {
        vi.useFakeTimers();

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            throw authError();
        });

        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 1_000,
        });
        await flush();
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await tick(60_000);
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("lets a manual refreshNow bypass the backoff", async () => {
        vi.useFakeTimers();

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            throw authError();
        });

        const handle = mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 60_000,
        });

        await flush();
        await act(async () => {
            handle.controls!.refreshNow();
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("arms the first poll only after the tab becomes visible when a hidden mount fails", async () => {
        vi.useFakeTimers();
        setVisibility("hidden");

        const fetchThreads = vi.fn(async (): Promise<CommentThread[]> => {
            throw authError();
        });

        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 1_000,
        });
        await flush();
        await tick(10_000);
        expect(fetchThreads).toHaveBeenCalledTimes(1);
    });
});

describe("nextPollDelayMs", () => {
    const base = { nowMs: 1_000_000, intervalMs: 30_000 };

    it("uses the interval while healthy", () => {
        expect(nextPollDelayMs({ ...base, failureStreak: 0 })).toBe(30_000);
    });

    it("backs off exponentially and caps at maxBackoffMs", () => {
        const delays = [1, 2, 3, 4, 5, 6, 20].map((failureStreak) =>
            nextPollDelayMs({ ...base, failureStreak }),
        );

        expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    });

    it("never caps below the interval", () => {
        expect(nextPollDelayMs({ ...base, failureStreak: 3, maxBackoffMs: 1_000 })).toBe(30_000);
    });

    it.each([
        {
            name: "just after a recovery 4 minutes away",
            offsetMs: 4 * 60_000,
            delay: 4 * 60_000 + RECOVER_BUFFER_MS,
        },
        {
            name: "the normal interval when recovery already passed",
            offsetMs: -60_000,
            delay: 30_000,
        },
        {
            name: "at most the cap for a recovery an hour away",
            offsetMs: 60 * 60_000,
            delay: MAX_RECOVER_WAIT_MS,
        },
    ])("waits $name", ({ offsetMs, delay }) => {
        expect(
            nextPollDelayMs({
                ...base,
                failureStreak: 1,
                error: { recoverAtMs: base.nowMs + offsetMs },
            }),
        ).toBe(delay);
    });

    // Review finding: when the host never re-mints, the token is past its AAD
    // `exp` and `recoverAtMs` lies in the past on every failure. The streak must
    // keep backing off instead of pinning the delay to the 30s interval.
    it("keeps backing off when recoverAtMs has already passed", () => {
        const delays = [1, 2, 3, 4, 5, 6].map((failureStreak) =>
            nextPollDelayMs({
                ...base,
                failureStreak,
                error: { recoverAtMs: base.nowMs - 10_000 },
            }),
        );

        expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    });

    it("waits for a later recoverAtMs even deep into a streak", () => {
        expect(
            nextPollDelayMs({
                ...base,
                failureStreak: 2,
                error: { recoverAtMs: base.nowMs + 8 * 60_000 },
            }),
        ).toBe(8 * 60_000 + RECOVER_BUFFER_MS);
    });

    it.each([
        ["a non-numeric recoverAtMs", { recoverAtMs: "soon" }],
        ["a NaN recoverAtMs", { recoverAtMs: NaN }],
        ["a null error", null],
        ["a string error", "x"],
    ])("ignores the recovery hint on %s and keeps backing off", (_label, error) => {
        expect(nextPollDelayMs({ ...base, failureStreak: 2, error })).toBe(60_000);
    });
});

describe("useThreadSync — early resume on recovery", () => {
    function recoverySignal() {
        const listeners = new Set<() => void>();

        return {
            listeners,
            subscribe: (l: () => void) => {
                listeners.add(l);

                return () => listeners.delete(l);
            },
            fire: () => {
                for (const l of [...listeners]) l();
            },
        };
    }

    const failing = () =>
        vi.fn(async (): Promise<CommentThread[]> => {
            throw new SessionRefreshingError("refreshing", Date.now() + 9 * 60_000);
        });

    // The host usually re-mints minutes before the AAD `exp` the backoff waits
    // for; the recovery signal lets polling resume the moment it does.
    it("polls immediately when the host signals recovery mid-backoff", async () => {
        vi.useFakeTimers();
        const signal = recoverySignal();
        const fetchThreads = failing();
        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 30_000,
            subscribeRecovered: signal.subscribe,
        });
        await flush();
        await tick(60_000);
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        act(() => signal.fire());
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("ignores a recovery signal while healthy", async () => {
        vi.useFakeTimers();
        const signal = recoverySignal();
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            intervalMs: 30_000,
            subscribeRecovered: signal.subscribe,
        });
        await flush();
        act(() => signal.fire());
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);
    });

    it("defers a recovery seen while hidden to an immediate poll on reveal", async () => {
        vi.useFakeTimers();
        const signal = recoverySignal();
        const fetchThreads = failing();
        mount({
            enabled: true,
            fetchThreads,
            onThreads: vi.fn(),
            onError: vi.fn(),
            intervalMs: 30_000,
            subscribeRecovered: signal.subscribe,
        });
        await flush();
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        act(() => signal.fire());
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        setVisibility("visible");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(2);
    });

    it("unsubscribes on unmount", async () => {
        const signal = recoverySignal();
        mount({
            enabled: true,
            fetchThreads: vi.fn(async () => [] as CommentThread[]),
            onThreads: vi.fn(),
            subscribeRecovered: signal.subscribe,
        });
        await flush();
        expect(signal.listeners.size).toBe(1);
        unmount();
        expect(signal.listeners.size).toBe(0);
    });
});

describe("useThreadSync — unmount cleanup", () => {
    it("removes listeners and stops polling after unmount", async () => {
        vi.useFakeTimers();
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const onThreads = vi.fn();
        mount({
            enabled: true,
            fetchThreads,
            onThreads,
            intervalMs: 1_000,
        });
        await flush();
        expect(fetchThreads).toHaveBeenCalledTimes(1);

        unmount();

        // After unmount: intervals don't tick and visibilitychange/focus
        // events don't call the fetcher.
        await act(async () => {
            vi.advanceTimersByTime(10_000);
        });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
        expect(fetchThreads).toHaveBeenCalledTimes(1);
    });
});

describe("useThreadSync — torn-down and stale sessions", () => {
    function rerender(handle: HarnessHandle, opts: HarnessOpts): void {
        act(() => {
            root!.render(harnessElement(opts, handle));
        });
    }

    it("treats refreshNow as a no-op before polling ever starts", () => {
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);

        const handle = mount({
            enabled: false,
            fetchThreads,
            onThreads: vi.fn(),
        });

        act(() => handle.controls!.refreshNow());
        expect(fetchThreads).not.toHaveBeenCalled();
    });

    it("does not fetch from refreshNow once polling is disabled", async () => {
        const fetchThreads = vi.fn(async () => [] as CommentThread[]);
        const opts = { enabled: true, fetchThreads, onThreads: vi.fn() };
        const handle = mount(opts);
        await flush();
        rerender(handle, { ...opts, enabled: false });
        act(() => handle.controls!.refreshNow());
        expect(fetchThreads).toHaveBeenCalledTimes(1);
    });

    it("keeps a newer session's spinner when a torn-down fetch settles", async () => {
        const first = defer<CommentThread[]>();
        const second = defer<CommentThread[]>();

        const fetchThreads = vi
            .fn<(signal: AbortSignal) => Promise<CommentThread[]>>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const onThreads = vi.fn();
        const opts = { enabled: true, fetchThreads, onThreads };
        const handle = mount(opts);
        rerender(handle, { ...opts, enabled: false });
        rerender(handle, opts);
        expect(fetchThreads).toHaveBeenCalledTimes(2);

        await act(async () => {
            first.resolve([{ id: "stale" } as unknown as CommentThread]);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(onThreads).not.toHaveBeenCalled();
        expect(handle.controls!.isRefreshing).toBe(true);

        const fresh = [{ id: "fresh" } as unknown as CommentThread];
        await act(async () => {
            second.resolve(fresh);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(onThreads).toHaveBeenCalledWith(fresh);
        expect(handle.controls!.isRefreshing).toBe(false);
    });

    it("asks the host's latest failure claim when a poll fails", async () => {
        const firstClaim = vi.fn(() => false);
        const latestClaim = vi.fn(() => true);

        const opts = {
            enabled: true,
            fetchThreads: vi.fn(async (): Promise<CommentThread[]> => {
                throw new Error("down");
            }),
            onThreads: vi.fn(),
            onError: vi.fn(),
            claimFailure: firstClaim,
        };

        const handle = mount(opts);
        rerender(handle, { ...opts, claimFailure: latestClaim });
        await flush();

        expect(latestClaim).toHaveBeenCalled();
    });

    it("listens to the host's latest recovery signal once polling restarts", () => {
        const firstSignal = vi.fn(() => () => {});
        const latestSignal = vi.fn(() => () => {});

        const opts = {
            enabled: true,
            fetchThreads: vi.fn(async () => [] as CommentThread[]),
            onThreads: vi.fn(),
            subscribeRecovered: firstSignal,
        };

        const handle = mount(opts);
        rerender(handle, { ...opts, enabled: false, subscribeRecovered: latestSignal });
        rerender(handle, { ...opts, subscribeRecovered: latestSignal });

        expect(latestSignal).toHaveBeenCalled();
    });

    it("discards a response from before sync was paused, even after a later tab switch", async () => {
        const beforePause = defer<CommentThread[]>();
        const afterResume = defer<CommentThread[]>();

        const fetchThreads = vi
            .fn<(signal: AbortSignal) => Promise<CommentThread[]>>()
            .mockReturnValueOnce(beforePause.promise)
            .mockReturnValueOnce(afterResume.promise);

        const onThreads = vi.fn();
        const opts = { enabled: true, fetchThreads, onThreads };
        const handle = mount(opts);
        rerender(handle, { ...opts, enabled: false });
        rerender(handle, opts);
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        const stale = [{ id: "stale" } as unknown as CommentThread];
        await act(async () => {
            // The host's fetch ignored the abort and answers late.
            beforePause.resolve(stale);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onThreads).not.toHaveBeenCalledWith(stale);
    });

    it("does not report a failure from a request aborted by a tab hide", async () => {
        const d = defer<CommentThread[]>();
        const fetchThreads = vi.fn(async () => d.promise);
        const onError = vi.fn();
        mount({ enabled: true, fetchThreads, onThreads: vi.fn(), onError });
        setVisibility("hidden");
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await act(async () => {
            d.reject(new DOMException("aborted", "AbortError"));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(onError).not.toHaveBeenCalled();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });
});
