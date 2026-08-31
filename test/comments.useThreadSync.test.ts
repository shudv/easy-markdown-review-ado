// Tests for the visibility-aware polling hook `useThreadSync`. We mount
// a tiny React host that calls the hook with a controllable fake
// fetcher, then drive it with fake timers + jsdom event dispatch.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThreadSync } from "../src/comments/useThreadSync";
import type { CommentThread } from "../src/types";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

// React 18 sets this so `act` can run synchronously in jsdom.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface HarnessOpts {
  enabled: boolean;
  fetchThreads: (signal: AbortSignal) => Promise<CommentThread[]>;
  onThreads: (threads: CommentThread[]) => void;
  onError?: (err: unknown) => void;
  intervalMs?: number;
}

// Exposed via the harness so tests can inspect / call `refreshNow`.
interface HarnessHandle {
  controls: ReturnType<typeof useThreadSync> | null;
  rerenderCount: number;
}

function Harness(props: HarnessOpts & { handle: HarnessHandle }): null {
  const controls = useThreadSync({
    enabled: props.enabled,
    fetchThreads: props.fetchThreads,
    onThreads: props.onThreads,
    onError: props.onError,
    intervalMs: props.intervalMs,
  });
  props.handle.controls = controls;
  props.handle.rerenderCount += 1;
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(opts: HarnessOpts): HarnessHandle {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const handle: HarnessHandle = { controls: null, rerenderCount: 0 };
  act(() => {
    root!.render(React.createElement(Harness, { ...opts, handle }));
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

beforeEach(() => {
  setVisibility("visible");
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  setVisibility("visible");
  trackUserFacingErrorMock.mockClear();
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
      if (!firstSignal) firstSignal = signal;
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
  it("forwards thrown errors to onError without rejecting", async () => {
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
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: boom,
      source: "ThreadSync.poll",
      operation: "comments-refresh",
      impact: "degraded",
    });
  });

  it("falls back to console.warn when onError is not provided", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchThreads = vi.fn(async () => {
      throw new Error("boom");
    });
    const onThreads = vi.fn();
    mount({ enabled: true, fetchThreads, onThreads });
    await flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
